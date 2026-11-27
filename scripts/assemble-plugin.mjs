import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pluginOutDir = path.join(rootDir, 'plugin');
const installMode = process.argv.includes('--install');

function copyCleanDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

const serverBundle = path.join(rootDir, 'dist', 'server', 'index.mjs');
const uiHtml = path.join(rootDir, 'dist', 'ui', 'index.html');

if (!fs.existsSync(serverBundle)) {
  throw new Error(`Missing built server bundle: ${serverBundle}`);
}
if (!fs.existsSync(uiHtml)) {
  throw new Error(`Missing built UI HTML: ${uiHtml}`);
}

const uiBytes = fs.statSync(uiHtml).size;
if (uiBytes === 0 || uiBytes > 10 * 1024 * 1024) {
  throw new Error(`Invalid UI HTML size: ${uiBytes} bytes`);
}

copyCleanDir(path.join(rootDir, 'plugin-assets'), pluginOutDir);
fs.mkdirSync(path.join(pluginOutDir, 'server'), { recursive: true });
fs.mkdirSync(path.join(pluginOutDir, 'ui'), { recursive: true });
fs.copyFileSync(serverBundle, path.join(pluginOutDir, 'server', 'index.mjs'));
fs.copyFileSync(uiHtml, path.join(pluginOutDir, 'ui', 'app.html'));

console.log(`Assembled clean plugin bundle at ${pluginOutDir} (UI: ${(uiBytes / 1024).toFixed(1)} KB)`);

if (installMode) {
  const localInstallDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'usage-monitor');
  copyCleanDir(pluginOutDir, localInstallDir);
  console.log(`Installed plugin locally to ${localInstallDir}`);
}
