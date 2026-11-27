import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  CreditsInfo,
  PluginConfig,
  QuotaBucket,
  QuotaGroup,
  QuotaHistoryPoint,
  QuotaState,
} from '../shared/types.js';
import { ensureDir, writeFileAtomic } from './config-store.js';

const execFileAsync = promisify(execFile);

interface RawQuotaBucket {
  id: string;
  name: string;
  description?: string;
  window?: string;
  remaining_fraction?: number;
  reset_time?: string;
}

interface RawQuotaGroup {
  name: string;
  description?: string;
  buckets?: RawQuotaBucket[];
}

export interface StoredQuotaSnapshot {
  fetchedAt: string;
  groups: RawQuotaGroup[];
  credits: CreditsInfo | null;
}

const MAX_HISTORY_LINES = 500;
const PRUNE_THRESHOLD_LINES = 600;

export function resolveAgyBinary(): string | null {
  const fromEnv = process.env.AGY_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const candidate = path.join(localAppData, 'agy', 'bin', 'agy.exe');
    if (localAppData && fs.existsSync(candidate)) {
      return candidate;
    }
  } else {
    const candidates = [
      '/usr/local/bin/agy',
      '/opt/homebrew/bin/agy',
      path.join(process.env.HOME || '', '.local', 'bin', 'agy'),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
  }

  return 'agy';
}

function parseJsonFromStdout(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('Empty output from agy CLI');
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  const candidate = lines.length > 0 ? lines[lines.length - 1] : trimmed;
  return JSON.parse(candidate) as Record<string, unknown>;
}

export function computeBurnRate(
  history: StoredQuotaSnapshot[],
  bucketId: string,
  currentResetTime: string,
  currentRemainingPct: number,
): { burnRatePctPerHour: number | null; estimatedHoursToEmpty: number | null; points: QuotaHistoryPoint[] } {
  const points: QuotaHistoryPoint[] = [];
  for (const snap of history) {
    for (const g of snap.groups) {
      const match = g.buckets?.find((b) => b.id === bucketId);
      if (match && typeof match.remaining_fraction === 'number') {
        points.push({
          ts: snap.fetchedAt,
          remainingPct: Number((match.remaining_fraction * 100).toFixed(2)),
        });
      }
    }
  }

  const recentPoints = points.slice(-48);
  const sameWindow = history
    .map((snap) => {
      const b = snap.groups.flatMap((g) => g.buckets ?? []).find((x) => x.id === bucketId);
      if (!b || b.reset_time !== currentResetTime || typeof b.remaining_fraction !== 'number') {
        return null;
      }
      return {
        tsMs: Date.parse(snap.fetchedAt),
        pct: b.remaining_fraction * 100,
      };
    })
    .filter((item): item is { tsMs: number; pct: number } => item !== null && Number.isFinite(item.tsMs));

  if (sameWindow.length < 2) {
    return { burnRatePctPerHour: null, estimatedHoursToEmpty: null, points: recentPoints };
  }

  const first = sameWindow[0];
  const last = sameWindow[sameWindow.length - 1];
  const deltaHours = (last.tsMs - first.tsMs) / 3_600_000;
  const consumedPct = first.pct - last.pct;
  if (deltaHours < 0.05 || consumedPct <= 0.1) {
    return { burnRatePctPerHour: null, estimatedHoursToEmpty: null, points: recentPoints };
  }

  const burnRate = Number((consumedPct / deltaHours).toFixed(2));
  const estHours = burnRate > 0 ? Number((currentRemainingPct / burnRate).toFixed(1)) : null;
  return {
    burnRatePctPerHour: burnRate,
    estimatedHoursToEmpty: estHours,
    points: recentPoints,
  };
}

export class QuotaService {
  private readonly historyPath: string;
  private readonly agyPath: string | null;
  private inFlight: Promise<QuotaState> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastError: string | null = null;

  constructor(private readonly dataDir: string) {
    this.historyPath = path.join(dataDir, 'quota_history.jsonl');
    this.agyPath = resolveAgyBinary();
  }

  getAgyPath(): string | null {
    return this.agyPath;
  }

  readHistory(): StoredQuotaSnapshot[] {
    try {
      if (!fs.existsSync(this.historyPath)) return [];
      const content = fs.readFileSync(this.historyPath, 'utf8');
      const items: StoredQuotaSnapshot[] = [];
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as StoredQuotaSnapshot;
          if (parsed && typeof parsed.fetchedAt === 'string' && Array.isArray(parsed.groups)) {
            items.push(parsed);
          }
        } catch {
          // Ignore malformed line
        }
      }
      return items;
    } catch {
      return [];
    }
  }

  private appendHistory(snapshot: StoredQuotaSnapshot): StoredQuotaSnapshot[] {
    ensureDir(this.dataDir);
    const existing = this.readHistory();
    const combined = [...existing, snapshot];
    if (combined.length > PRUNE_THRESHOLD_LINES) {
      const trimmed = combined.slice(-MAX_HISTORY_LINES);
      const body = trimmed.map((s) => JSON.stringify(s)).join('\n') + '\n';
      writeFileAtomic(this.historyPath, body);
      return trimmed;
    }
    fs.appendFileSync(this.historyPath, JSON.stringify(snapshot) + '\n', 'utf8');
    return combined;
  }

  private buildState(
    snapshot: StoredQuotaSnapshot | null,
    history: StoredQuotaSnapshot[],
    opts: { fromCache: boolean; staleMinutes: number; error: string | null },
  ): QuotaState {
    if (!snapshot) {
      return {
        groups: [],
        credits: null,
        fetchedAt: null,
        fromCache: opts.fromCache,
        stale: true,
        error: opts.error,
        historyCount: history.length,
      };
    }

    const fetchedMs = Date.parse(snapshot.fetchedAt);
    const ageMs = Number.isFinite(fetchedMs) ? Date.now() - fetchedMs : Number.POSITIVE_INFINITY;
    const stale = ageMs > opts.staleMinutes * 60_000;

    const groups: QuotaGroup[] = snapshot.groups.map((g) => ({
      name: g.name,
      description: g.description ?? '',
      buckets: (g.buckets ?? []).map((b): QuotaBucket => {
        const frac = typeof b.remaining_fraction === 'number' ? Math.max(0, Math.min(1, b.remaining_fraction)) : 0;
        const remainingPct = Number((frac * 100).toFixed(1));
        const usedPct = Number(((1 - frac) * 100).toFixed(1));
        const resetTime = b.reset_time ?? '';
        const burn = computeBurnRate(history, b.id, resetTime, remainingPct);
        return {
          id: b.id,
          name: b.name,
          description: b.description ?? '',
          window: b.window ?? '',
          remainingFraction: frac,
          remainingPct,
          usedPct,
          resetTime,
          burnRatePctPerHour: burn.burnRatePctPerHour,
          estimatedHoursToEmpty: burn.estimatedHoursToEmpty,
          history: burn.points,
        };
      }),
    }));

    return {
      groups,
      credits: snapshot.credits,
      fetchedAt: snapshot.fetchedAt,
      fromCache: opts.fromCache,
      stale,
      error: opts.error,
      historyCount: history.length,
    };
  }

  getCachedQuota(config: PluginConfig): QuotaState {
    const history = this.readHistory();
    const latest = history.length > 0 ? history[history.length - 1] : null;
    return this.buildState(latest, history, {
      fromCache: true,
      staleMinutes: config.quotaStaleMinutes,
      error: this.lastError,
    });
  }

  async refreshQuota(config: PluginConfig, options: { force?: boolean } = {}): Promise<QuotaState> {
    const history = this.readHistory();
    const latest = history.length > 0 ? history[history.length - 1] : null;
    if (!options.force && latest) {
      const ageMs = Date.now() - Date.parse(latest.fetchedAt);
      if (Number.isFinite(ageMs) && ageMs < config.quotaStaleMinutes * 60_000) {
        return this.buildState(latest, history, {
          fromCache: true,
          staleMinutes: config.quotaStaleMinutes,
          error: null,
        });
      }
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.executeFetch(config, history, latest);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async executeFetch(
    config: PluginConfig,
    history: StoredQuotaSnapshot[],
    latest: StoredQuotaSnapshot | null,
  ): Promise<QuotaState> {
    const bin = this.agyPath || 'agy';
    try {
      const [usageRes, creditsRes] = await Promise.allSettled([
        execFileAsync(bin, ['-p', '/usage', '--output-format', 'json'], {
          timeout: 25_000,
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        }),
        execFileAsync(bin, ['-p', '/credits', '--output-format', 'json'], {
          timeout: 25_000,
          windowsHide: true,
          maxBuffer: 1 * 1024 * 1024,
        }),
      ]);

      if (usageRes.status !== 'fulfilled') {
        throw usageRes.reason;
      }

      const usageJson = parseJsonFromStdout(usageRes.value.stdout);
      const usageCmd = usageJson.command as { data?: { groups?: RawQuotaGroup[] } } | undefined;
      const groups = usageCmd?.data?.groups;
      if (!Array.isArray(groups) || groups.length === 0) {
        throw new Error('agy /usage returned no quota groups');
      }

      let credits: CreditsInfo | null = latest?.credits ?? null;
      if (creditsRes.status === 'fulfilled') {
        try {
          const creditsJson = parseJsonFromStdout(creditsRes.value.stdout);
          const creditsCmd = creditsJson.command as
            | { data?: { remaining_credits?: number; upgrade_uri?: string } }
            | undefined;
          if (creditsCmd?.data && typeof creditsCmd.data.remaining_credits === 'number') {
            credits = {
              remainingCredits: creditsCmd.data.remaining_credits,
              upgradeUri: creditsCmd.data.upgrade_uri,
            };
          }
        } catch {
          // Keep fallback credits
        }
      }

      const snapshot: StoredQuotaSnapshot = {
        fetchedAt: new Date().toISOString(),
        groups,
        credits,
      };
      const updatedHistory = this.appendHistory(snapshot);
      this.lastError = null;
      return this.buildState(snapshot, updatedHistory, {
        fromCache: false,
        staleMinutes: config.quotaStaleMinutes,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = `No se pudo actualizar cuota vía agy CLI: ${msg}`;
      console.error('[usage-monitor]', this.lastError);
      return this.buildState(latest, history, {
        fromCache: true,
        staleMinutes: config.quotaStaleMinutes,
        error: this.lastError,
      });
    }
  }

  startBackgroundPolling(getConfig: () => PluginConfig): void {
    this.rescheduleBackgroundPolling(getConfig().autoSnapshotMinutes, getConfig);
  }

  rescheduleBackgroundPolling(minutes: number, getConfig: () => PluginConfig): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    const intervalMs = Math.max(60_000, minutes * 60_000);
    this.timer = setInterval(() => {
      void this.refreshQuota(getConfig(), { force: true }).catch((err) => {
        console.error('[usage-monitor] Background quota snapshot error:', err);
      });
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
