import type { ModelPricingUsd, PluginConfig } from './types.js';

export const DEFAULT_MODEL_PRICING_USD: Record<string, ModelPricingUsd> = {
  'gemini-4-neon': {
    familyKey: 'gemini-4-neon',
    displayName: 'Gemini 4 Neon',
    group: 'Gemini Models',
    input: 3.0,
    cacheRead: 0.15,
    output: 15.0,
    contextWindow: 524_288,
  },
  'gemini-4-carbon': {
    familyKey: 'gemini-4-carbon',
    displayName: 'Gemini 4 Carbon',
    group: 'Gemini Models',
    input: 2.0,
    cacheRead: 0.1,
    output: 10.0,
    contextWindow: 1_048_576,
  },
  'gemini-4-argon': {
    familyKey: 'gemini-4-argon',
    displayName: 'Gemini 4 Argon',
    group: 'Gemini Models',
    input: 2.0,
    cacheRead: 0.1,
    output: 10.0,
    contextWindow: 1_048_576,
  },
  'gemini-4-hydrogen': {
    familyKey: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen',
    group: 'Gemini Models',
    input: 1.5,
    cacheRead: 0.075,
    output: 7.5,
    contextWindow: 1_048_576,
  },
  'gemini-pro-orchestrator': {
    familyKey: 'gemini-pro-orchestrator',
    displayName: 'Orchestrator (Mix)',
    group: 'Gemini Models',
    input: 2.25,
    cacheRead: 0.1125,
    output: 11.25,
    contextWindow: 524_288,
  },
  'gemini-3.8-flash': {
    familyKey: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    group: 'Gemini Models',
    input: 0.75,
    cacheRead: 0.0375,
    output: 3.75,
    contextWindow: 1_048_576,
  },
  'claude-sonnet-5-5': {
    familyKey: 'claude-sonnet-5-5',
    displayName: 'Claude Sonnet 5.5',
    group: 'Claude & GPT',
    input: 2.0,
    cacheRead: 0.1,
    output: 10.0,
    contextWindow: 1_048_576,
  },
  'claude-opus-5-5': {
    familyKey: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    group: 'Claude & GPT',
    input: 4.0,
    cacheRead: 0.2,
    output: 20.0,
    contextWindow: 1_048_576,
  },
  'gpt-oss-120b': {
    familyKey: 'gpt-oss-120b',
    displayName: 'GPT-OSS 120B',
    group: 'Claude & GPT',
    input: 0.5,
    cacheRead: 0.05,
    output: 2.0,
    contextWindow: 131_072,
  },
  legacy: {
    familyKey: 'legacy',
    displayName: 'Legacy (sin modelo)',
    group: 'Legacy',
    input: 1.5,
    cacheRead: 0.075,
    output: 7.5,
    contextWindow: 1_048_576,
  },
};

export const DEFAULT_CONFIG: PluginConfig = {
  usdToEurRate: 0.92,
  autoSnapshotMinutes: 15,
  quotaStaleMinutes: 2,
  alerts: {
    quota5hWarnPct: 20,
    quotaWeeklyWarnPct: 25,
    weeklyBudgetEur: 0,
  },
  pricingUsd: DEFAULT_MODEL_PRICING_USD,
};

export function resolveModelPricing(familyKey: string, config: PluginConfig): ModelPricingUsd {
  return (
    config.pricingUsd[familyKey] ??
    DEFAULT_MODEL_PRICING_USD[familyKey] ??
    config.pricingUsd.legacy ??
    DEFAULT_MODEL_PRICING_USD.legacy
  );
}

export function computeTurnCostEur(
  freshInput: number,
  cacheRead: number,
  output: number,
  familyKey: string,
  config: PluginConfig,
): { actualEur: number; uncachedEur: number; savingsEur: number } {
  const pricing = resolveModelPricing(familyKey, config);
  const rate = Number.isFinite(config.usdToEurRate) && config.usdToEurRate > 0 ? config.usdToEurRate : 0.92;

  const actualUsd =
    (freshInput * pricing.input + cacheRead * pricing.cacheRead + output * pricing.output) / 1_000_000;
  const uncachedUsd =
    ((freshInput + cacheRead) * pricing.input + output * pricing.output) / 1_000_000;
  const savingsUsd = Math.max(0, uncachedUsd - actualUsd);

  return {
    actualEur: actualUsd * rate,
    uncachedEur: uncachedUsd * rate,
    savingsEur: savingsUsd * rate,
  };
}

export function formatEur(amount: number, compact = false): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const decimals = compact ? (safe >= 100 ? 0 : 2) : safe < 0.1 && safe > 0 ? 4 : 2;
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
}

export function formatCompactNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (safe >= 1_000_000_000) return `${(safe / 1_000_000_000).toFixed(2)}B`;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}K`;
  return String(Math.round(safe));
}
