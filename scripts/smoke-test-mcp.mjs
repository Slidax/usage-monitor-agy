import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const targetServer =
  process.argv[2] ||
  path.join(os.homedir(), '.gemini', 'config', 'plugins', 'usage-monitor', 'server', 'index.mjs');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'um-smoke-'));
const uiHtmlPath = path.resolve(path.dirname(targetServer), '..', 'ui', 'app.html');

const child = spawn(process.execPath, ['--no-warnings', targetServer], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    USAGE_MONITOR_DATA_DIR: tempDataDir,
    USAGE_MONITOR_UI_HTML: uiHtmlPath,
  },
});

const stderrChunks = [];
child.stderr.on('data', (d) => stderrChunks.push(d.toString('utf8')));

let stdoutBuffer = '';
const pending = new Map();

child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk.toString('utf8');
  let nl;
  while ((nl = stdoutBuffer.indexOf('\n')) !== -1) {
    const line = stdoutBuffer.slice(0, nl).trim();
    stdoutBuffer = stdoutBuffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`RPC ${msg.id} error: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    }
  }
});

let nextId = 1;
function sendRequest(method, params) {
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for ${method}`));
    }, 35_000);
    pending.set(id, {
      resolve: (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    child.stdin.write(payload);
  });
}

function sendNotification(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

try {
  const init = await sendRequest('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } },
    clientInfo: { name: 'smoke-test', version: '1.0.0' },
  });
  assert.ok(init.capabilities?.tools, 'Server must advertise tools capability');
  assert.ok(init.capabilities?.resources, 'Server must advertise resources capability');
  sendNotification('notifications/initialized', {});

  const toolsRes = await sendRequest('tools/list', {});
  const toolsByName = new Map(toolsRes.tools.map((t) => [t.name, t]));
  assert.ok(toolsByName.has('open_usage_dashboard'));
  assert.ok(toolsByName.has('get_usage_summary'));
  assert.ok(toolsByName.has('app_get_dashboard_data'));
  assert.ok(toolsByName.has('app_refresh_quota'));
  assert.ok(toolsByName.has('app_get_config'));
  assert.ok(toolsByName.has('app_save_config'));

  const openMeta = toolsByName.get('open_usage_dashboard')._meta;
  assert.equal(openMeta?.ui?.resourceUri, 'ui://usage-monitor/app.html');
  assert.equal(openMeta?.['com.google.antigravity/ui']?.entrypoints?.length, 2);

  const summaryMeta = toolsByName.get('get_usage_summary')._meta;
  assert.equal(summaryMeta?.ui?.resourceUri, 'ui://usage-monitor/app.html');
  assert.equal(summaryMeta?.['com.google.antigravity/ui'], undefined);

  assert.deepEqual(toolsByName.get('app_get_dashboard_data')._meta?.ui?.visibility, ['app']);

  const resList = await sendRequest('resources/list', {});
  assert.equal(resList.resources[0].uri, 'ui://usage-monitor/app.html');
  assert.equal(resList.resources[0].mimeType, 'text/html;profile=mcp-app');

  const resRead = await sendRequest('resources/read', { uri: 'ui://usage-monitor/app.html' });
  const html = resRead.contents[0].text;
  assert.equal(resRead.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.ok(html.includes('Usage Monitor') && html.includes('<script'), 'HTML bundle must be valid');

  const openRes = await sendRequest('tools/call', { name: 'open_usage_dashboard', arguments: {} });
  assert.equal(openRes.structuredContent.view, 'dashboard');
  assert.ok(openRes.structuredContent.kpis.totalTurns > 0, 'Should index real local transcripts');

  const summaryRes = await sendRequest('tools/call', { name: 'get_usage_summary', arguments: {} });
  assert.equal(summaryRes.structuredContent.view, 'inline_summary');
  assert.ok(summaryRes.content[0].text.includes('€'), 'Summary text must format in EUR');

  const dashRes = await sendRequest('tools/call', {
    name: 'app_get_dashboard_data',
    arguments: { period: '7d', includeLegacy: false },
  });
  assert.equal(dashRes.structuredContent.filters.period, '7d');

  const quotaRes = await sendRequest('tools/call', {
    name: 'app_refresh_quota',
    arguments: { force: true },
  });
  assert.ok(Array.isArray(quotaRes.structuredContent.quota.groups), 'Quota groups must be array');
  assert.ok(quotaRes.structuredContent.quota.groups.length > 0, 'Live quota should return groups');

  const cfgRes = await sendRequest('tools/call', { name: 'app_get_config', arguments: {} });
  assert.equal(cfgRes.structuredContent.config.usdToEurRate, 0.92);

  console.log('SMOKE TEST PASSED:', {
    uiSizeKB: (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1),
    indexedTurns7d: openRes.structuredContent.kpis.totalTurns,
    conversations7d: openRes.structuredContent.kpis.conversationCount,
    quotaGroups: quotaRes.structuredContent.quota.groups.map((g) => g.name),
    stderrLines: stderrChunks.join('').trim() || '(clean)',
  });
} finally {
  child.kill();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}
