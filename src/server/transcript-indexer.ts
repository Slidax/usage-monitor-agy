import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  IndexedConversation,
  IndexedTurn,
  SurfaceKind,
} from '../shared/types.js';
import { writeFileAtomic } from './config-store.js';

interface SqliteSummaryRow {
  conversation_id: string;
  title?: string;
  project_id?: string;
  agent_name?: string;
  parent_conversation_id?: string;
  nesting_depth?: number;
  last_modified_time?: string;
}

interface TranscriptCacheFile {
  version: number;
  entries: Record<string, IndexedConversation>;
}

export interface IndexResult {
  conversations: IndexedConversation[];
  projectMap: Map<string, string>;
  appDataDirsFound: string[];
  transcriptCounts: Record<SurfaceKind, number>;
  sqliteAvailable: boolean;
  sqliteLoadedSurfaces: SurfaceKind[];
  indexCacheHitCount: number;
  indexReparsedCount: number;
  totalIndexedTurns: number;
}

const CACHE_VERSION = 1;
const SURFACES: Array<{ surface: SurfaceKind; folder: string }> = [
  { surface: 'app', folder: 'antigravity' },
  { surface: 'cli', folder: 'antigravity-cli' },
  { surface: 'ide', folder: 'antigravity-ide' },
];

export function resolveGeminiRoot(): string {
  return process.env.USAGE_MONITOR_GEMINI_DIR?.trim() || path.join(os.homedir(), '.gemini');
}

export function loadProjectMap(geminiRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  map.set('outside-of-project', 'Sin proyecto');
  map.set('', 'Sin proyecto');

  const projectsDir = path.join(geminiRoot, 'config', 'projects');
  if (!fs.existsSync(projectsDir)) {
    return map;
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(projectsDir);
  } catch {
    return map;
  }

  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const fp = path.join(projectsDir, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf8')) as { id?: string; name?: string };
      if (parsed?.id && parsed?.name) {
        map.set(parsed.id, parsed.name);
      }
    } catch {
      // Ignore invalid project files
    }
  }

  return map;
}

async function loadSqliteSummaries(
  surfaceDir: string,
): Promise<{ ok: boolean; rows: Map<string, SqliteSummaryRow> }> {
  const dbPath = path.join(surfaceDir, 'conversation_summaries.db');
  const rows = new Map<string, SqliteSummaryRow>();
  if (!fs.existsSync(dbPath)) {
    return { ok: false, rows };
  }

  try {
    const sqlite = await import('node:sqlite');
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const stmt = db.prepare(
        'SELECT conversation_id, title, project_id, agent_name, parent_conversation_id, nesting_depth, last_modified_time FROM conversation_summaries',
      );
      const list = stmt.all() as unknown as SqliteSummaryRow[];
      for (const r of list) {
        if (r?.conversation_id) {
          rows.set(r.conversation_id, r);
        }
      }
      return { ok: true, rows };
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[usage-monitor] Could not read ${dbPath}:`, err);
    return { ok: false, rows };
  }
}

export function parseTranscriptContent(content: string): {
  turns: IndexedTurn[];
  fallbackTitle: string;
} {
  const turns: IndexedTurn[] = [];
  let fallbackTitle = '';
  let prevWasCheckpoint = false;
  let lastSeenModelRaw: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Skip malformed or partial trailing line
      continue;
    }

    const type = typeof obj.type === 'string' ? obj.type : '';
    const ts = typeof obj.created_at === 'string' ? obj.created_at : '';
    const tsMs = ts ? Date.parse(ts) : 0;
    const stepIndex = typeof obj.step_index === 'number' ? obj.step_index : turns.length;

    if (!fallbackTitle && type === 'USER_INPUT' && typeof obj.content === 'string') {
      const cleaned = obj.content
        .replace(/<\/?USER_REQUEST>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) {
        fallbackTitle = cleaned.slice(0, 72);
      }
    }

    if (type === 'CHECKPOINT') {
      const freshInput = toSafeInt(obj.input_tokens);
      const cacheRead = toSafeInt(obj.cache_read_tokens);
      const output = toSafeInt(obj.output_tokens);
      if (freshInput > 0 || cacheRead > 0 || output > 0) {
        turns.push({
          stepIndex,
          ts,
          tsMs: Number.isFinite(tsMs) ? tsMs : 0,
          modelRaw: lastSeenModelRaw,
          freshInput,
          cacheRead,
          output,
          isCheckpoint: true,
          prevWasCheckpoint: false,
        });
      }
      prevWasCheckpoint = true;
      continue;
    }

    if (type === 'PLANNER_RESPONSE') {
      const modelRaw = typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : null;
      if (modelRaw) {
        lastSeenModelRaw = modelRaw;
      }
      const freshInput = toSafeInt(obj.input_tokens);
      const cacheRead = toSafeInt(obj.cache_read_tokens);
      const output = toSafeInt(obj.output_tokens);

      turns.push({
        stepIndex,
        ts,
        tsMs: Number.isFinite(tsMs) ? tsMs : 0,
        modelRaw,
        freshInput,
        cacheRead,
        output,
        isCheckpoint: false,
        prevWasCheckpoint,
      });
      prevWasCheckpoint = false;
    }
  }

  return { turns, fallbackTitle };
}

function toSafeInt(val: unknown): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

export class TranscriptIndexer {
  private readonly cachePath: string;
  private memoryCache: Map<string, IndexedConversation> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly geminiRoot: string = resolveGeminiRoot(),
  ) {
    this.cachePath = path.join(dataDir, 'transcript_index_v1.json');
  }

  private loadDiskCache(): Map<string, IndexedConversation> {
    if (this.memoryCache) return this.memoryCache;
    const map = new Map<string, IndexedConversation>();
    try {
      if (fs.existsSync(this.cachePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf8')) as TranscriptCacheFile;
        if (parsed?.version === CACHE_VERSION && parsed.entries && typeof parsed.entries === 'object') {
          for (const [k, v] of Object.entries(parsed.entries)) {
            if (v && Array.isArray(v.turns)) {
              map.set(k, v);
            }
          }
        }
      }
    } catch (err) {
      console.error('[usage-monitor] Failed to read transcript index cache, rebuilding:', err);
    }
    this.memoryCache = map;
    return map;
  }

  private saveDiskCache(cache: Map<string, IndexedConversation>): void {
    try {
      const entries: Record<string, IndexedConversation> = {};
      for (const [k, v] of cache.entries()) {
        entries[k] = v;
      }
      const payload: TranscriptCacheFile = { version: CACHE_VERSION, entries };
      writeFileAtomic(this.cachePath, JSON.stringify(payload));
    } catch (err) {
      console.error('[usage-monitor] Failed to persist transcript index cache:', err);
    }
  }

  async indexAll(): Promise<IndexResult> {
    const projectMap = loadProjectMap(this.geminiRoot);
    const cache = this.loadDiskCache();

    let sqliteAvailable = false;
    try {
      await import('node:sqlite');
      sqliteAvailable = true;
    } catch {
      sqliteAvailable = false;
    }

    const appDataDirsFound: string[] = [];
    const sqliteLoadedSurfaces: SurfaceKind[] = [];
    const transcriptCounts: Record<SurfaceKind, number> = { app: 0, cli: 0, ide: 0 };
    const conversations: IndexedConversation[] = [];

    let indexCacheHitCount = 0;
    let indexReparsedCount = 0;
    let totalIndexedTurns = 0;
    let cacheDirty = false;
    const seenKeys = new Set<string>();

    for (const { surface, folder } of SURFACES) {
      const surfaceDir = path.join(this.geminiRoot, folder);
      if (!fs.existsSync(surfaceDir)) continue;
      appDataDirsFound.push(surfaceDir);

      const summaryResult = sqliteAvailable
        ? await loadSqliteSummaries(surfaceDir)
        : { ok: false, rows: new Map<string, SqliteSummaryRow>() };
      if (summaryResult.ok) {
        sqliteLoadedSurfaces.push(surface);
      }

      const brainDir = path.join(surfaceDir, 'brain');
      if (!fs.existsSync(brainDir)) continue;

      let convDirs: fs.Dirent[] = [];
      try {
        convDirs = fs.readdirSync(brainDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of convDirs) {
        if (!entry.isDirectory()) continue;
        const convId = entry.name;
        const transcriptPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
        if (!fs.existsSync(transcriptPath)) continue;

        let stat: fs.Stats;
        try {
          stat = fs.statSync(transcriptPath);
        } catch {
          continue;
        }

        transcriptCounts[surface] += 1;
        const cacheKey = `${surface}:${convId}`;
        seenKeys.add(cacheKey);

        const summary = summaryResult.rows.get(convId);
        const projectId = summary?.project_id || 'outside-of-project';
        const projectName = projectMap.get(projectId) ?? (projectId === 'outside-of-project' ? 'Sin proyecto' : projectId.slice(0, 8));

        const cached = cache.get(cacheKey);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          indexCacheHitCount += 1;
          const updated: IndexedConversation = {
            ...cached,
            title: summary?.title?.trim() || cached.title,
            projectId,
            projectName,
            agentName: summary?.agent_name ?? cached.agentName,
            parentConversationId: summary?.parent_conversation_id ?? cached.parentConversationId,
            nestingDepth: summary?.nesting_depth ?? cached.nestingDepth,
          };
          if (
            updated.title !== cached.title ||
            updated.projectId !== cached.projectId ||
            updated.projectName !== cached.projectName ||
            updated.parentConversationId !== cached.parentConversationId
          ) {
            cache.set(cacheKey, updated);
            cacheDirty = true;
          }
          conversations.push(updated);
          totalIndexedTurns += updated.turns.length;
          continue;
        }

        let raw = '';
        try {
          raw = fs.readFileSync(transcriptPath, 'utf8');
        } catch {
          continue;
        }

        const { turns, fallbackTitle } = parseTranscriptContent(raw);
        indexReparsedCount += 1;

        const lastTurnMs = turns.length > 0 ? turns[turns.length - 1].tsMs : 0;
        const parsedModMs = summary?.last_modified_time ? Date.parse(summary.last_modified_time) : 0;
        const lastModifiedMs = Math.max(
          Number.isFinite(lastTurnMs) ? lastTurnMs : 0,
          Number.isFinite(parsedModMs) ? parsedModMs : 0,
          stat.mtimeMs,
        );

        const title = summary?.title?.trim() || fallbackTitle || `Conversación ${convId.slice(0, 8)}`;
        const legacyOnly = turns.length > 0 && turns.every((t) => !t.modelRaw);

        const conv: IndexedConversation = {
          id: convId,
          surface,
          title,
          projectId,
          projectName,
          agentName: summary?.agent_name ?? '',
          parentConversationId: summary?.parent_conversation_id ?? '',
          nestingDepth: summary?.nesting_depth ?? 0,
          lastModifiedMs,
          turns,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          legacyOnly,
        };

        cache.set(cacheKey, conv);
        cacheDirty = true;
        conversations.push(conv);
        totalIndexedTurns += turns.length;
      }
    }

    for (const existingKey of Array.from(cache.keys())) {
      if (!seenKeys.has(existingKey)) {
        cache.delete(existingKey);
        cacheDirty = true;
      }
    }

    if (cacheDirty) {
      this.saveDiskCache(cache);
    }

    return {
      conversations,
      projectMap,
      appDataDirsFound,
      transcriptCounts,
      sqliteAvailable,
      sqliteLoadedSurfaces,
      indexCacheHitCount,
      indexReparsedCount,
      totalIndexedTurns,
    };
  }
}
