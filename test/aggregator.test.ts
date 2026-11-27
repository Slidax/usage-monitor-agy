import { describe, expect, it } from 'vitest';
import { buildDashboardPayload, formatMarkdownSummary, buildInlineSummaryPayload } from '../src/server/aggregator.js';
import { DEFAULT_CONFIG } from '../src/shared/pricing.js';
import type { IndexResult } from '../src/server/transcript-indexer.js';
import type { IndexedConversation, QuotaState } from '../src/shared/types.js';

function makeIndexResult(conversations: IndexedConversation[]): IndexResult {
  const projectMap = new Map<string, string>([
    ['proj-a', 'Backend VTUI'],
    ['outside-of-project', 'Sin proyecto'],
  ]);
  return {
    conversations,
    projectMap,
    appDataDirsFound: ['~/.gemini/antigravity'],
    transcriptCounts: { app: conversations.length, cli: 0, ide: 0 },
    sqliteAvailable: true,
    sqliteLoadedSurfaces: ['app'],
    indexCacheHitCount: 0,
    indexReparsedCount: conversations.length,
    totalIndexedTurns: conversations.reduce((s, c) => s + c.turns.length, 0),
  };
}

describe('aggregator', () => {
  const nowMs = Date.parse('2026-11-27T12:00:00Z');

  const emptyQuota: QuotaState = {
    groups: [
      {
        name: 'Gemini Models',
        description: 'Gemini',
        buckets: [
          {
            id: 'gemini-5h',
            name: '5h',
            description: 'Low quota',
            window: '5h',
            remainingFraction: 0.15,
            remainingPct: 15,
            usedPct: 85,
            resetTime: '2026-11-27T14:00:00Z',
            burnRatePctPerHour: 12,
            estimatedHoursToEmpty: 1.2,
            history: [],
          },
        ],
      },
    ],
    credits: { remainingCredits: 0 },
    fetchedAt: '2026-11-27T12:00:00Z',
    fromCache: false,
    stale: false,
    error: null,
    historyCount: 1,
  };

  it('rolls up subagents into parent, computes warm cache hit rate, and filters legacy by default', () => {
    const parent: IndexedConversation = {
      id: 'root-1',
      surface: 'app',
      title: 'Refactor auth',
      projectId: 'proj-a',
      projectName: 'Backend VTUI',
      agentName: '',
      parentConversationId: '',
      nestingDepth: 0,
      lastModifiedMs: nowMs - 3600_000,
      mtimeMs: nowMs,
      size: 100,
      legacyOnly: false,
      turns: [
        // Cold turn 1: 20k fresh, 0 cache
        {
          stepIndex: 1,
          ts: '2026-11-27T10:00:00Z',
          tsMs: nowMs - 2 * 3600_000,
          modelRaw: 'gemini-4-neon-xhigh',
          freshInput: 20000,
          cacheRead: 0,
          output: 500,
        },
        // Warm turn 2: 2k fresh, 18k cache (90% hit!)
        {
          stepIndex: 2,
          ts: '2026-11-27T10:05:00Z',
          tsMs: nowMs - 1.9 * 3600_000,
          modelRaw: 'gemini-4-neon-xhigh',
          freshInput: 2000,
          cacheRead: 18000,
          output: 500,
        },
        // Turn 3 after checkpoint should NOT trigger cache break even though cache dropped
        {
          stepIndex: 3,
          ts: '2026-11-27T10:10:00Z',
          tsMs: nowMs - 1.8 * 3600_000,
          modelRaw: 'gemini-4-neon-xhigh',
          freshInput: 10000,
          cacheRead: 1000,
          output: 300,
          prevWasCheckpoint: true,
        },
        // Turn 4 (prev prompt 11000 >= 8000, cacheRead 1000 < 5500, NOT post-checkpoint) -> cache break!
        {
          stepIndex: 4,
          ts: '2026-11-27T10:15:00Z',
          tsMs: nowMs - 1.7 * 3600_000,
          modelRaw: 'gemini-4-neon-xhigh',
          freshInput: 10000,
          cacheRead: 1000,
          output: 300,
          prevWasCheckpoint: false,
        },
        // Legacy turn inside 7d without model (excluded by default)
        {
          stepIndex: 5,
          ts: '2026-11-26T10:00:00Z',
          tsMs: nowMs - 24 * 3600_000,
          modelRaw: null,
          freshInput: 50000,
          cacheRead: 0,
          output: 1000,
        },
      ],
    };

    const child: IndexedConversation = {
      id: 'sub-1',
      surface: 'app',
      title: 'Subagent research',
      projectId: 'outside-of-project',
      projectName: 'Sin proyecto',
      agentName: 'research',
      parentConversationId: 'root-1',
      nestingDepth: 1,
      lastModifiedMs: nowMs - 1800_000,
      mtimeMs: nowMs,
      size: 50,
      legacyOnly: false,
      turns: [
        {
          stepIndex: 1,
          ts: '2026-11-27T11:00:00Z',
          tsMs: nowMs - 3600_000,
          modelRaw: 'gemini-4-hydrogen-high',
          freshInput: 10000,
          cacheRead: 0,
          output: 200,
        },
      ],
    };

    const dash = buildDashboardPayload(
      makeIndexResult([parent, child]),
      emptyQuota,
      DEFAULT_CONFIG,
      { period: '7d', includeLegacy: false },
      nowMs,
    );

    expect(dash.kpis.conversationCount).toBe(1);
    expect(dash.kpis.subagentCount).toBe(1);
    expect(dash.kpis.totalTurns).toBe(5); // 4 non-legacy parent + 1 child
    expect(dash.kpis.coldTurns).toBe(2); // parent turn 1 + child turn 1
    expect(dash.kpis.warmTurns).toBe(3); // parent turns 2, 3, 4
    expect(dash.kpis.cacheBreakCount).toBe(1); // Only turn 4, NOT turn 3
    expect(dash.sessions[0].projectName).toBe('Backend VTUI');
    expect(dash.sessions[0].subagentCount).toBe(1);
    expect(dash.alerts.some((a) => a.id === 'quota-5h-gemini-5h')).toBe(true);

    const md = formatMarkdownSummary(buildInlineSummaryPayload(dash));
    expect(md).toContain('€');
    expect(md).toContain('Gemini 4 Neon');

    const withLegacy = buildDashboardPayload(
      makeIndexResult([parent, child]),
      emptyQuota,
      DEFAULT_CONFIG,
      { period: '7d', includeLegacy: true },
      nowMs,
    );
    expect(withLegacy.kpis.totalTurns).toBe(6);
  });
});
