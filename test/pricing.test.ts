import { describe, expect, it } from 'vitest';
import { parseModelSlug } from '../src/shared/model-utils.js';
import { computeTurnCostEur, DEFAULT_CONFIG, formatEur } from '../src/shared/pricing.js';

describe('model-utils & pricing', () => {
  it('parses known Gemini, Orchestrator, Claude, GPT, and legacy slugs', () => {
    expect(parseModelSlug('gemini-4-neon-xhigh')).toMatchObject({
      familyKey: 'gemini-4-neon',
      familyName: 'Gemini 4 Neon',
      effort: 'XHigh',
      group: 'Gemini Models',
      isLegacy: false,
    });

    expect(parseModelSlug('gemini-pro-orchestrator-neon')).toMatchObject({
      familyKey: 'gemini-pro-orchestrator',
      familyName: 'Orchestrator (Neon)',
      effort: 'Auto',
      group: 'Gemini Models',
      isLegacy: false,
    });

    expect(parseModelSlug('claude-opus-5-5-medium')).toMatchObject({
      familyKey: 'claude-opus-5-5',
      familyName: 'Claude Opus 5.5',
      effort: 'Medium',
      group: 'Claude & GPT',
      isLegacy: false,
    });

    expect(parseModelSlug(null)).toMatchObject({
      familyKey: 'legacy',
      isLegacy: true,
      group: 'Legacy',
    });
  });

  it('computes EUR cost and cache savings accurately using USD->EUR rate', () => {
    const cfg = { ...DEFAULT_CONFIG, usdToEurRate: 0.92 };
    // Gemini 4 Neon: $3.00 fresh input, $0.15 cache read, $15.00 output per 1M
    const res = computeTurnCostEur(100_000, 900_000, 10_000, 'gemini-4-neon', cfg);

    // actualUsd = 0.30 + 0.135 + 0.15 = 0.585
    // uncachedUsd = 3.00 + 0.15 = 3.15
    // savingsUsd = 2.565
    expect(res.actualEur).toBeCloseTo(0.585 * 0.92, 6);
    expect(res.uncachedEur).toBeCloseTo(3.15 * 0.92, 6);
    expect(res.savingsEur).toBeCloseTo(2.565 * 0.92, 6);
  });

  it('formats monetary values strictly in EUR', () => {
    const out = formatEur(12.5);
    expect(out).toContain('€');
    expect(out).not.toContain('$');
  });
});
