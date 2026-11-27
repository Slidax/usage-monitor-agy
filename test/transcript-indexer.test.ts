import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTranscriptContent, TranscriptIndexer } from '../src/server/transcript-indexer.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('transcript-indexer', () => {
  it('parses PLANNER_RESPONSE, CHECKPOINT, and skips malformed trailing lines', () => {
    const jsonl = [
      JSON.stringify({
        type: 'USER_INPUT',
        step_index: 0,
        created_at: '2026-11-27T10:00:00Z',
        content: '<USER_REQUEST>\nImplementa caché en API\n</USER_REQUEST>',
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        step_index: 1,
        created_at: '2026-11-27T10:00:05Z',
        model: 'gemini-4-neon-xhigh',
        input_tokens: 20000,
        cache_read_tokens: 0,
        output_tokens: 800,
      }),
      JSON.stringify({
        type: 'CHECKPOINT',
        step_index: 2,
        created_at: '2026-11-27T10:01:00Z',
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 500,
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        step_index: 3,
        created_at: '2026-11-27T10:01:10Z',
        model: 'gemini-4-neon-xhigh',
        input_tokens: 6000,
        cache_read_tokens: 2000,
        output_tokens: 400,
      }),
      '{"type": "PLANNER_RESPONSE", "truncated": ',
    ].join('\n');

    const { turns, fallbackTitle } = parseTranscriptContent(jsonl);
    expect(fallbackTitle).toBe('Implementa caché en API');
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({
      modelRaw: 'gemini-4-neon-xhigh',
      freshInput: 20000,
      cacheRead: 0,
      output: 800,
      isCheckpoint: false,
      prevWasCheckpoint: false,
    });
    expect(turns[1]).toMatchObject({
      isCheckpoint: true,
      modelRaw: 'gemini-4-neon-xhigh',
    });
    expect(turns[2]).toMatchObject({
      isCheckpoint: false,
      prevWasCheckpoint: true,
      freshInput: 6000,
      cacheRead: 2000,
    });
  });

  it('uses mtime+size incremental cache on subsequent scans', async () => {
    const geminiRoot = makeTempDir('um-gemini-');
    const dataDir = makeTempDir('um-data-');

    const projectsDir = path.join(geminiRoot, 'config', 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectsDir, 'proj1.json'),
      JSON.stringify({ id: 'proj1', name: 'Mi Proyecto Real' }),
    );

    const logDir = path.join(geminiRoot, 'antigravity', 'brain', 'conv-1', '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'transcript.jsonl'),
      [
        JSON.stringify({
          type: 'USER_INPUT',
          step_index: 0,
          created_at: '2026-11-27T11:00:00Z',
          content: 'Hola',
        }),
        JSON.stringify({
          type: 'PLANNER_RESPONSE',
          step_index: 1,
          created_at: '2026-11-27T11:00:02Z',
          model: 'gemini-4-hydrogen-high',
          input_tokens: 5000,
          cache_read_tokens: 15000,
          output_tokens: 200,
        }),
      ].join('\n'),
    );

    const idx1 = new TranscriptIndexer(dataDir, geminiRoot);
    const res1 = await idx1.indexAll();
    expect(res1.indexReparsedCount).toBe(1);
    expect(res1.indexCacheHitCount).toBe(0);
    expect(res1.conversations).toHaveLength(1);

    const idx2 = new TranscriptIndexer(dataDir, geminiRoot);
    const res2 = await idx2.indexAll();
    expect(res2.indexReparsedCount).toBe(0);
    expect(res2.indexCacheHitCount).toBe(1);
    expect(res2.totalIndexedTurns).toBe(1);
  });
});
