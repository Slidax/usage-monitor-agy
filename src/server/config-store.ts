import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_CONFIG, DEFAULT_MODEL_PRICING_USD } from '../shared/pricing.js';
import type { ModelPricingUsd, PluginConfig } from '../shared/types.js';

export function resolveDataDir(): string {
  const envDir = process.env.USAGE_MONITOR_DATA_DIR?.trim();
  if (envDir) {
    return envDir;
  }
  const pluginData = process.env.PLUGIN_DATA?.trim();
  if (pluginData) {
    return pluginData;
  }
  return path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'usage-monitor');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFileAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function sanitizePositive(value: unknown, fallback: number, min = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) return fallback;
  return num;
}

export function normalizeConfig(raw: unknown): PluginConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<PluginConfig>;
  const rawAlerts = (input.alerts && typeof input.alerts === 'object' ? input.alerts : {}) as Partial<
    PluginConfig['alerts']
  >;
  const rawPricing = (input.pricingUsd && typeof input.pricingUsd === 'object'
    ? input.pricingUsd
    : {}) as Record<string, Partial<ModelPricingUsd>>;

  const mergedPricing: Record<string, ModelPricingUsd> = {};
  for (const [key, def] of Object.entries(DEFAULT_MODEL_PRICING_USD)) {
    const custom = rawPricing[key];
    mergedPricing[key] = {
      familyKey: def.familyKey,
      displayName: typeof custom?.displayName === 'string' && custom.displayName.trim() ? custom.displayName.trim() : def.displayName,
      group: def.group,
      input: sanitizePositive(custom?.input, def.input, 0),
      cacheRead: sanitizePositive(custom?.cacheRead, def.cacheRead, 0),
      output: sanitizePositive(custom?.output, def.output, 0),
      contextWindow: sanitizePositive(custom?.contextWindow, def.contextWindow, 1024),
    };
  }

  for (const [key, custom] of Object.entries(rawPricing)) {
    if (mergedPricing[key] || !custom || typeof custom !== 'object') continue;
    mergedPricing[key] = {
      familyKey: key,
      displayName: typeof custom.displayName === 'string' && custom.displayName.trim() ? custom.displayName.trim() : key,
      group: custom.group === 'Claude & GPT' || custom.group === 'Legacy' ? custom.group : 'Gemini Models',
      input: sanitizePositive(custom.input, 1.5, 0),
      cacheRead: sanitizePositive(custom.cacheRead, 0.075, 0),
      output: sanitizePositive(custom.output, 7.5, 0),
      contextWindow: sanitizePositive(custom.contextWindow, 1_048_576, 1024),
    };
  }

  return {
    usdToEurRate: sanitizePositive(input.usdToEurRate, DEFAULT_CONFIG.usdToEurRate, 0.01),
    autoSnapshotMinutes: Math.round(sanitizePositive(input.autoSnapshotMinutes, DEFAULT_CONFIG.autoSnapshotMinutes, 0)),
    quotaStaleMinutes: Math.max(1, Math.round(sanitizePositive(input.quotaStaleMinutes, DEFAULT_CONFIG.quotaStaleMinutes, 1))),
    alerts: {
      quota5hWarnPct: Math.min(100, sanitizePositive(rawAlerts.quota5hWarnPct, DEFAULT_CONFIG.alerts.quota5hWarnPct, 0)),
      quotaWeeklyWarnPct: Math.min(100, sanitizePositive(rawAlerts.quotaWeeklyWarnPct, DEFAULT_CONFIG.alerts.quotaWeeklyWarnPct, 0)),
      weeklyBudgetEur: sanitizePositive(rawAlerts.weeklyBudgetEur, DEFAULT_CONFIG.alerts.weeklyBudgetEur, 0),
    },
    pricingUsd: mergedPricing,
  };
}

export class ConfigStore {
  private readonly configPath: string;
  private cached: PluginConfig | null = null;

  constructor(private readonly dataDir: string = resolveDataDir()) {
    this.configPath = path.join(dataDir, 'config.json');
  }

  getDataDir(): string {
    return this.dataDir;
  }

  get(): PluginConfig {
    if (this.cached) return this.cached;
    try {
      if (fs.existsSync(this.configPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.cached = normalizeConfig(parsed);
        return this.cached;
      }
    } catch (err) {
      console.error('[usage-monitor] Failed to read config.json, using defaults:', err);
    }
    this.cached = normalizeConfig(DEFAULT_CONFIG);
    return this.cached;
  }

  save(next: unknown): PluginConfig {
    const normalized = normalizeConfig(next);
    writeFileAtomic(this.configPath, JSON.stringify(normalized, null, 2));
    this.cached = normalized;
    return normalized;
  }

  resetDefaults(): PluginConfig {
    return this.save(DEFAULT_CONFIG);
  }
}
