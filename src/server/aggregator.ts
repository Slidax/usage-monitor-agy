import { parseModelSlug } from '../shared/model-utils.js';
import {
  computeTurnCostEur,
  formatCompactNumber,
  formatEur,
  resolveModelPricing,
} from '../shared/pricing.js';
import type {
  AlertItem,
  CacheAnalytics,
  CacheBreakEvent,
  DashboardFilters,
  DashboardKpis,
  DashboardPayload,
  IndexedConversation,
  IndexedTurn,
  InlineSummaryPayload,
  InsightItem,
  ModelAggregate,
  PeriodFilter,
  PluginConfig,
  ProjectAggregate,
  QuotaState,
  SessionRow,
  SubagentRow,
  TimeSeriesPoint,
} from '../shared/types.js';
import type { IndexResult } from './transcript-indexer.js';

const PERIOD_MS: Record<Exclude<PeriodFilter, 'all'>, number> = {
  '5h': 5 * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
};

const MAX_SESSION_ROWS = 100;
const MAX_CACHE_BREAKS = 25;

interface ModelAcc {
  key: string;
  label: string;
  familyKey: string;
  familyName: string;
  effort: string | null;
  group: 'Gemini Models' | 'Claude & GPT' | 'Legacy';
  isLegacy: boolean;
  turns: number;
  freshInput: number;
  cacheRead: number;
  output: number;
  coldFresh: number;
  coldCache: number;
  coldTurns: number;
  warmFresh: number;
  warmCache: number;
  warmTurns: number;
  costEur: number;
  uncachedCostEur: number;
  savingsEur: number;
}

interface ConvAcc {
  conv: IndexedConversation;
  turns: number;
  freshInput: number;
  cacheRead: number;
  output: number;
  peakContextTokens: number;
  peakContextPct: number;
  costEur: number;
  savingsEur: number;
  lastActivityMs: number;
  models: Set<string>;
}

function getCutoffMs(period: PeriodFilter, nowMs: number): number {
  if (period === 'all') return 0;
  return nowMs - PERIOD_MS[period];
}

function resolveRootId(
  convId: string,
  byId: Map<string, IndexedConversation>,
): string {
  let currId = convId;
  const visited = new Set<string>();
  while (currId && !visited.has(currId)) {
    visited.add(currId);
    const node = byId.get(currId);
    if (!node || !node.parentConversationId) {
      return currId;
    }
    if (!byId.has(node.parentConversationId)) {
      return currId;
    }
    currId = node.parentConversationId;
  }
  return convId;
}

function formatTimeBucket(tsMs: number, hourly: boolean): { key: string; label: string; iso: string } {
  const d = new Date(tsMs);
  if (hourly) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
    const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
    const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).toISOString();
    return { key, label, iso };
  }
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  return { key, label, iso };
}

function finalizeModelList(map: Map<string, ModelAcc>, totalCostEur: number): ModelAggregate[] {
  return Array.from(map.values())
    .map((m): ModelAggregate => {
      const totalPromptTokens = m.freshInput + m.cacheRead;
      const warmPrompt = m.warmFresh + m.warmCache;
      return {
        key: m.key,
        label: m.label,
        familyKey: m.familyKey,
        familyName: m.familyName,
        effort: m.effort,
        group: m.group,
        isLegacy: m.isLegacy,
        turns: m.turns,
        freshInput: m.freshInput,
        cacheRead: m.cacheRead,
        output: m.output,
        totalPromptTokens,
        globalCacheHitRate: totalPromptTokens > 0 ? m.cacheRead / totalPromptTokens : 0,
        warmCacheHitRate: warmPrompt > 0 ? m.warmCache / warmPrompt : 0,
        coldTurns: m.coldTurns,
        warmTurns: m.warmTurns,
        avgContextTokens: m.turns > 0 ? Math.round(totalPromptTokens / m.turns) : 0,
        costEur: m.costEur,
        uncachedCostEur: m.uncachedCostEur,
        savingsEur: m.savingsEur,
        sharePct: totalCostEur > 0 ? (m.costEur / totalCostEur) * 100 : 0,
      };
    })
    .sort((a, b) => b.costEur - a.costEur || b.turns - a.turns);
}

export function buildDashboardPayload(
  indexResult: IndexResult,
  quota: QuotaState,
  config: PluginConfig,
  rawFilters: Partial<DashboardFilters> = {},
  nowMs: number = Date.now(),
): DashboardPayload {
  const filters: DashboardFilters = {
    period: rawFilters.period ?? '7d',
    projectId: rawFilters.projectId ?? 'all',
    surface: rawFilters.surface ?? 'all',
    includeLegacy: rawFilters.includeLegacy ?? false,
  };

  const byId = new Map<string, IndexedConversation>();
  for (const conv of indexResult.conversations) {
    byId.set(conv.id, conv);
  }

  const rootIdMap = new Map<string, string>();
  const availableProjectMap = new Map<string, string>();
  for (const conv of indexResult.conversations) {
    const rId = resolveRootId(conv.id, byId);
    rootIdMap.set(conv.id, rId);
    const rootConv = byId.get(rId) ?? conv;
    availableProjectMap.set(rootConv.projectId, rootConv.projectName);
  }

  const availableProjects = Array.from(availableProjectMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const cutoffMs = getCutoffMs(filters.period, nowMs);
  const rolling7dCutoffMs = nowMs - PERIOD_MS['7d'];
  const hourlySeries = filters.period === '5h' || filters.period === '24h';

  let totalCostEur = 0;
  let uncachedCostEur = 0;
  let cacheSavingsEur = 0;
  let weeklyRollingCostEur = 0;
  let totalFreshInput = 0;
  let totalCacheRead = 0;
  let totalOutput = 0;
  let warmFresh = 0;
  let warmCache = 0;
  let coldTurns = 0;
  let warmTurns = 0;
  let totalTurns = 0;

  const familyMap = new Map<string, ModelAcc>();
  const exactMap = new Map<string, ModelAcc>();
  const timeMap = new Map<
    string,
    { key: string; label: string; ts: string; freshInput: number; cacheRead: number; output: number; costEur: number; savingsEur: number; turns: number }
  >();
  const convAccMap = new Map<string, ConvAcc>();
  const cacheBreaks: CacheBreakEvent[] = [];

  for (const conv of indexResult.conversations) {
    if (filters.surface !== 'all' && conv.surface !== filters.surface) {
      continue;
    }

    const rootId = rootIdMap.get(conv.id) ?? conv.id;
    const rootConv = byId.get(rootId) ?? conv;
    const effectiveProjectId = rootConv.projectId;
    const effectiveProjectName = rootConv.projectName;

    if (filters.projectId !== 'all' && effectiveProjectId !== filters.projectId) {
      continue;
    }

    // Track 7d rolling cost across selected project/surface for budget alert
    for (const t of conv.turns) {
      const parsed = parseModelSlug(t.modelRaw);
      if (parsed.isLegacy && !filters.includeLegacy) continue;
      const tMs = t.tsMs || conv.lastModifiedMs;
      if (tMs >= rolling7dCutoffMs) {
        const c = computeTurnCostEur(t.freshInput, t.cacheRead, t.output, parsed.familyKey, config);
        weeklyRollingCostEur += c.actualEur;
      }
    }

    let prevPlannerTurn: IndexedTurn | null = null;
    let convAcc: ConvAcc | null = null;

    for (const turn of conv.turns) {
      const parsed = parseModelSlug(turn.modelRaw);
      if (parsed.isLegacy && !filters.includeLegacy) {
        if (!turn.isCheckpoint) prevPlannerTurn = turn;
        continue;
      }

      const turnMs = turn.tsMs || conv.lastModifiedMs;
      if (turnMs < cutoffMs) {
        if (!turn.isCheckpoint) prevPlannerTurn = turn;
        continue;
      }

      const costs = computeTurnCostEur(turn.freshInput, turn.cacheRead, turn.output, parsed.familyKey, config);
      const pricing = resolveModelPricing(parsed.familyKey, config);
      const promptTokens = turn.freshInput + turn.cacheRead;

      totalCostEur += costs.actualEur;
      uncachedCostEur += costs.uncachedEur;
      cacheSavingsEur += costs.savingsEur;
      totalFreshInput += turn.freshInput;
      totalCacheRead += turn.cacheRead;
      totalOutput += turn.output;

      if (!turn.isCheckpoint) {
        totalTurns += 1;
        const isWarm = prevPlannerTurn !== null;
        if (isWarm) {
          warmTurns += 1;
          warmFresh += turn.freshInput;
          warmCache += turn.cacheRead;
        } else {
          coldTurns += 1;
        }

        // Cache break detection
        if (isWarm && prevPlannerTurn && !turn.prevWasCheckpoint) {
          const prevPrompt = prevPlannerTurn.freshInput + prevPlannerTurn.cacheRead;
          if (prevPrompt >= 8000 && turn.cacheRead < prevPrompt * 0.5) {
            const dropPct = Number((((prevPrompt - turn.cacheRead) / prevPrompt) * 100).toFixed(1));
            const lostCacheTokens = Math.max(0, prevPrompt - turn.cacheRead);
            const affectedTokens = Math.min(turn.freshInput, lostCacheTokens);
            const rate = Number.isFinite(config.usdToEurRate) && config.usdToEurRate > 0 ? config.usdToEurRate : 0.92;
            const extraEur =
              (affectedTokens * Math.max(0, pricing.input - pricing.cacheRead) * rate) / 1_000_000;
            cacheBreaks.push({
              conversationId: rootConv.id,
              title: rootConv.title,
              projectName: effectiveProjectName,
              surface: conv.surface,
              ts: turn.ts || new Date(turnMs).toISOString(),
              modelName: parsed.effort ? `${parsed.familyName} (${parsed.effort})` : parsed.familyName,
              prevPromptTokens: prevPrompt,
              currCacheReadTokens: turn.cacheRead,
              currFreshInputTokens: turn.freshInput,
              dropPct,
              estimatedExtraCostEur: extraEur,
            });
          }
        }
      }

      // Accumulate model family
      const famKey = parsed.familyKey;
      let famAcc = familyMap.get(famKey);
      if (!famAcc) {
        famAcc = {
          key: famKey,
          label: parsed.familyName,
          familyKey: parsed.familyKey,
          familyName: parsed.familyName,
          effort: null,
          group: parsed.group,
          isLegacy: parsed.isLegacy,
          turns: 0,
          freshInput: 0,
          cacheRead: 0,
          output: 0,
          coldFresh: 0,
          coldCache: 0,
          coldTurns: 0,
          warmFresh: 0,
          warmCache: 0,
          warmTurns: 0,
          costEur: 0,
          uncachedCostEur: 0,
          savingsEur: 0,
        };
        familyMap.set(famKey, famAcc);
      }

      const exactKey = parsed.slug || 'legacy';
      const exactLabel = parsed.effort ? `${parsed.familyName} (${parsed.effort})` : parsed.familyName;
      let exactAcc = exactMap.get(exactKey);
      if (!exactAcc) {
        exactAcc = {
          key: exactKey,
          label: exactLabel,
          familyKey: parsed.familyKey,
          familyName: parsed.familyName,
          effort: parsed.effort,
          group: parsed.group,
          isLegacy: parsed.isLegacy,
          turns: 0,
          freshInput: 0,
          cacheRead: 0,
          output: 0,
          coldFresh: 0,
          coldCache: 0,
          coldTurns: 0,
          warmFresh: 0,
          warmCache: 0,
          warmTurns: 0,
          costEur: 0,
          uncachedCostEur: 0,
          savingsEur: 0,
        };
        exactMap.set(exactKey, exactAcc);
      }

      for (const acc of [famAcc, exactAcc]) {
        acc.freshInput += turn.freshInput;
        acc.cacheRead += turn.cacheRead;
        acc.output += turn.output;
        acc.costEur += costs.actualEur;
        acc.uncachedCostEur += costs.uncachedEur;
        acc.savingsEur += costs.savingsEur;
        if (!turn.isCheckpoint) {
          acc.turns += 1;
          if (prevPlannerTurn !== null) {
            acc.warmTurns += 1;
            acc.warmFresh += turn.freshInput;
            acc.warmCache += turn.cacheRead;
          } else {
            acc.coldTurns += 1;
            acc.coldFresh += turn.freshInput;
            acc.coldCache += turn.cacheRead;
          }
        }
      }

      // Time series bucket
      const tb = formatTimeBucket(turnMs, hourlySeries);
      let tPoint = timeMap.get(tb.key);
      if (!tPoint) {
        tPoint = {
          key: tb.key,
          label: tb.label,
          ts: tb.iso,
          freshInput: 0,
          cacheRead: 0,
          output: 0,
          costEur: 0,
          savingsEur: 0,
          turns: 0,
        };
        timeMap.set(tb.key, tPoint);
      }
      tPoint.freshInput += turn.freshInput;
      tPoint.cacheRead += turn.cacheRead;
      tPoint.output += turn.output;
      tPoint.costEur += costs.actualEur;
      tPoint.savingsEur += costs.savingsEur;
      if (!turn.isCheckpoint) tPoint.turns += 1;

      // Conversation accumulator
      if (!convAcc) {
        convAcc = {
          conv: {
            ...conv,
            projectId: effectiveProjectId,
            projectName: effectiveProjectName,
          },
          turns: 0,
          freshInput: 0,
          cacheRead: 0,
          output: 0,
          peakContextTokens: 0,
          peakContextPct: 0,
          costEur: 0,
          savingsEur: 0,
          lastActivityMs: turnMs,
          models: new Set<string>(),
        };
        convAccMap.set(conv.id, convAcc);
      }
      if (!turn.isCheckpoint) {
        convAcc.turns += 1;
        if (promptTokens > convAcc.peakContextTokens) {
          convAcc.peakContextTokens = promptTokens;
          const ctxPct = pricing.contextWindow > 0 ? (promptTokens / pricing.contextWindow) * 100 : 0;
          convAcc.peakContextPct = Math.min(100, Number(ctxPct.toFixed(1)));
        }
      }
      convAcc.freshInput += turn.freshInput;
      convAcc.cacheRead += turn.cacheRead;
      convAcc.output += turn.output;
      convAcc.costEur += costs.actualEur;
      convAcc.savingsEur += costs.savingsEur;
      if (turnMs > convAcc.lastActivityMs) convAcc.lastActivityMs = turnMs;
      convAcc.models.add(parsed.familyName);

      if (!turn.isCheckpoint) {
        prevPlannerTurn = turn;
      }
    }
  }

  // Roll up subagents into root conversations
  const sessionMap = new Map<string, SessionRow>();
  const subagentsByRoot = new Map<string, ConvAcc[]>();

  for (const cAcc of convAccMap.values()) {
    const rootId = rootIdMap.get(cAcc.conv.id) ?? cAcc.conv.id;
    if (rootId === cAcc.conv.id) {
      const prompt = cAcc.freshInput + cAcc.cacheRead;
      sessionMap.set(rootId, {
        id: cAcc.conv.id,
        title: cAcc.conv.title,
        projectId: cAcc.conv.projectId,
        projectName: cAcc.conv.projectName,
        surface: cAcc.conv.surface,
        lastActivity: new Date(cAcc.lastActivityMs).toISOString(),
        turns: cAcc.turns,
        freshInput: cAcc.freshInput,
        cacheRead: cAcc.cacheRead,
        output: cAcc.output,
        cacheHitRate: prompt > 0 ? cAcc.cacheRead / prompt : 0,
        peakContextTokens: cAcc.peakContextTokens,
        peakContextPct: cAcc.peakContextPct,
        costEur: cAcc.costEur,
        savingsEur: cAcc.savingsEur,
        models: Array.from(cAcc.models),
        subagentCount: 0,
        subagentCostEur: 0,
        subagents: [],
      });
    } else {
      const list = subagentsByRoot.get(rootId) ?? [];
      list.push(cAcc);
      subagentsByRoot.set(rootId, list);
    }
  }

  let totalSubagents = 0;
  let totalSubagentCostEur = 0;

  for (const [rootId, children] of subagentsByRoot.entries()) {
    let parentRow = sessionMap.get(rootId);
    if (!parentRow) {
      const rootMeta = byId.get(rootId) ?? children[0].conv;
      parentRow = {
        id: rootId,
        title: rootMeta.title,
        projectId: rootMeta.projectId,
        projectName: rootMeta.projectName,
        surface: rootMeta.surface,
        lastActivity: new Date(rootMeta.lastModifiedMs).toISOString(),
        turns: 0,
        freshInput: 0,
        cacheRead: 0,
        output: 0,
        cacheHitRate: 0,
        peakContextTokens: 0,
        peakContextPct: 0,
        costEur: 0,
        savingsEur: 0,
        models: [],
        subagentCount: 0,
        subagentCostEur: 0,
        subagents: [],
      };
      sessionMap.set(rootId, parentRow);
    }

    const parentModels = new Set<string>(parentRow.models);
    for (const child of children) {
      totalSubagents += 1;
      totalSubagentCostEur += child.costEur;

      const cPrompt = child.freshInput + child.cacheRead;
      const subRow: SubagentRow = {
        id: child.conv.id,
        agentName: child.conv.agentName || 'Subagente',
        title: child.conv.title,
        turns: child.turns,
        freshInput: child.freshInput,
        cacheRead: child.cacheRead,
        output: child.output,
        cacheHitRate: cPrompt > 0 ? child.cacheRead / cPrompt : 0,
        costEur: child.costEur,
        savingsEur: child.savingsEur,
        models: Array.from(child.models),
      };

      parentRow.subagents.push(subRow);
      parentRow.subagentCount += 1;
      parentRow.subagentCostEur += child.costEur;
      parentRow.turns += child.turns;
      parentRow.freshInput += child.freshInput;
      parentRow.cacheRead += child.cacheRead;
      parentRow.output += child.output;
      parentRow.costEur += child.costEur;
      parentRow.savingsEur += child.savingsEur;
      if (child.lastActivityMs > Date.parse(parentRow.lastActivity)) {
        parentRow.lastActivity = new Date(child.lastActivityMs).toISOString();
      }
      for (const m of child.models) parentModels.add(m);
    }

    const totalPrompt = parentRow.freshInput + parentRow.cacheRead;
    parentRow.cacheHitRate = totalPrompt > 0 ? parentRow.cacheRead / totalPrompt : 0;
    parentRow.models = Array.from(parentModels);
    parentRow.subagents.sort((a, b) => b.costEur - a.costEur);
  }

  const allSessions = Array.from(sessionMap.values()).sort(
    (a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity),
  );

  // Project aggregates
  const projectAggMap = new Map<string, ProjectAggregate>();
  for (const s of allSessions) {
    let pAcc = projectAggMap.get(s.projectId);
    if (!pAcc) {
      pAcc = {
        projectId: s.projectId,
        projectName: s.projectName,
        conversations: 0,
        subagents: 0,
        turns: 0,
        freshInput: 0,
        cacheRead: 0,
        output: 0,
        cacheHitRate: 0,
        costEur: 0,
        savingsEur: 0,
        sharePct: 0,
      };
      projectAggMap.set(s.projectId, pAcc);
    }
    pAcc.conversations += 1;
    pAcc.subagents += s.subagentCount;
    pAcc.turns += s.turns;
    pAcc.freshInput += s.freshInput;
    pAcc.cacheRead += s.cacheRead;
    pAcc.output += s.output;
    pAcc.costEur += s.costEur;
    pAcc.savingsEur += s.savingsEur;
  }

  const byProject = Array.from(projectAggMap.values())
    .map((p) => {
      const prompt = p.freshInput + p.cacheRead;
      return {
        ...p,
        cacheHitRate: prompt > 0 ? p.cacheRead / prompt : 0,
        sharePct: totalCostEur > 0 ? (p.costEur / totalCostEur) * 100 : 0,
      };
    })
    .sort((a, b) => b.costEur - a.costEur || b.turns - a.turns);

  const avgPeakContextPct =
    allSessions.length > 0
      ? Number(
          (allSessions.reduce((acc, s) => acc + s.peakContextPct, 0) / allSessions.length).toFixed(1),
        )
      : 0;

  const totalPromptTokens = totalFreshInput + totalCacheRead;
  const globalCacheHitRate = totalPromptTokens > 0 ? totalCacheRead / totalPromptTokens : 0;
  const warmPromptTokens = warmFresh + warmCache;
  const warmCacheHitRate = warmPromptTokens > 0 ? warmCache / warmPromptTokens : 0;

  const kpis: DashboardKpis = {
    totalCostEur,
    uncachedCostEur,
    cacheSavingsEur,
    weeklyRollingCostEur,
    totalFreshInput,
    totalCacheRead,
    totalOutput,
    totalPromptTokens,
    globalCacheHitRate,
    warmCacheHitRate,
    coldTurns,
    warmTurns,
    cacheBreakCount: cacheBreaks.length,
    totalTurns,
    conversationCount: allSessions.length,
    subagentCount: totalSubagents,
    subagentCostEur: totalSubagentCostEur,
    avgPeakContextPct,
  };

  const byModelFamily = finalizeModelList(familyMap, totalCostEur);
  const byModelExact = finalizeModelList(exactMap, totalCostEur);

  const timeSeries: TimeSeriesPoint[] = Array.from(timeMap.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => {
      const prompt = p.freshInput + p.cacheRead;
      return {
        bucketKey: p.key,
        label: p.label,
        ts: p.ts,
        freshInput: p.freshInput,
        cacheRead: p.cacheRead,
        output: p.output,
        costEur: p.costEur,
        savingsEur: p.savingsEur,
        cacheHitRate: prompt > 0 ? p.cacheRead / prompt : 0,
        turns: p.turns,
      };
    });

  const sortedBreaks = [...cacheBreaks]
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, MAX_CACHE_BREAKS);

  const cacheAnalytics: CacheAnalytics = {
    globalHitRate: globalCacheHitRate,
    warmHitRate: warmCacheHitRate,
    coldTurns,
    warmTurns,
    totalSavingsEur: cacheSavingsEur,
    effectiveDiscountPct: uncachedCostEur > 0 ? (cacheSavingsEur / uncachedCostEur) * 100 : 0,
    byModel: byModelFamily,
    recentBreaks: sortedBreaks,
  };

  const alerts = evaluateAlerts(quota, kpis, config);
  const insights = buildInsights(kpis, byModelFamily, allSessions, cacheAnalytics);

  return {
    view: 'dashboard',
    generatedAt: new Date(nowMs).toISOString(),
    filters,
    availableProjects,
    quota,
    config,
    kpis,
    timeSeries,
    byModelFamily,
    byModelExact,
    cacheAnalytics,
    byProject,
    sessions: allSessions.slice(0, MAX_SESSION_ROWS),
    alerts,
    insights,
    diagnostics: {
      appDataDirsFound: indexResult.appDataDirsFound,
      transcriptCounts: indexResult.transcriptCounts,
      sqliteAvailable: indexResult.sqliteAvailable,
      sqliteLoadedSurfaces: indexResult.sqliteLoadedSurfaces,
      projectsMapped: indexResult.projectMap.size,
      agyPath: null,
      dataDir: '',
      indexCacheHitCount: indexResult.indexCacheHitCount,
      indexReparsedCount: indexResult.indexReparsedCount,
      totalIndexedTurns: indexResult.totalIndexedTurns,
    },
  };
}

export function evaluateAlerts(
  quota: QuotaState,
  kpis: DashboardKpis,
  config: PluginConfig,
): AlertItem[] {
  const alerts: AlertItem[] = [];
  for (const g of quota.groups) {
    for (const b of g.buckets) {
      if (b.window === '5h' && b.remainingPct <= config.alerts.quota5hWarnPct) {
        alerts.push({
          id: `quota-5h-${b.id}`,
          severity: b.remainingPct <= 10 ? 'danger' : 'warning',
          title: `Cuota 5h baja en ${g.name}: ${b.remainingPct.toFixed(0)}% restante`,
          detail: b.description || 'Considera cambiar a un modelo más ligero como Gemini 4 Hydrogen.',
        });
      }
      if (b.window === 'weekly' && b.remainingPct <= config.alerts.quotaWeeklyWarnPct) {
        alerts.push({
          id: `quota-weekly-${b.id}`,
          severity: b.remainingPct <= 10 ? 'danger' : 'warning',
          title: `Cuota semanal baja en ${g.name}: ${b.remainingPct.toFixed(0)}% restante`,
          detail: b.description || 'Cerca del límite semanal del plan.',
        });
      }
    }
  }

  if (config.alerts.weeklyBudgetEur > 0 && kpis.weeklyRollingCostEur >= config.alerts.weeklyBudgetEur * 0.8) {
    const exceeded = kpis.weeklyRollingCostEur >= config.alerts.weeklyBudgetEur;
    alerts.push({
      id: 'weekly-budget-eur',
      severity: exceeded ? 'danger' : 'warning',
      title: exceeded
        ? `Presupuesto semanal superado (${formatEur(kpis.weeklyRollingCostEur)} / ${formatEur(config.alerts.weeklyBudgetEur)})`
        : `Presupuesto semanal al ${((kpis.weeklyRollingCostEur / config.alerts.weeklyBudgetEur) * 100).toFixed(0)}%`,
      detail: 'Calculado sobre los últimos 7 días con las tarifas configuradas en Ajustes.',
    });
  }

  return alerts;
}

function buildInsights(
  kpis: DashboardKpis,
  byModelFamily: ModelAggregate[],
  sessions: SessionRow[],
  cacheAnalytics: CacheAnalytics,
): InsightItem[] {
  const insights: InsightItem[] = [];

  if (cacheAnalytics.totalSavingsEur > 0) {
    insights.push({
      id: 'cache-savings',
      kind: 'cache',
      title: `Ahorro de ${formatEur(cacheAnalytics.totalSavingsEur)} gracias al prompt caching`,
      detail: `Acierto en caliente del ${(cacheAnalytics.warmHitRate * 100).toFixed(1)}% (${formatCompactNumber(kpis.totalCacheRead)} tokens servidos desde caché).`,
    });
  }

  if (byModelFamily.length > 0) {
    const top = byModelFamily[0];
    insights.push({
      id: 'top-model',
      kind: 'model',
      title: `${top.familyName} concentra el ${top.sharePct.toFixed(1)}% del gasto equivalente`,
      detail: `${top.turns} turnos · ${formatEur(top.costEur)} estimados (${(top.globalCacheHitRate * 100).toFixed(1)}% caché).`,
    });
  }

  const highCtx = sessions.filter((s) => s.peakContextPct >= 75);
  if (highCtx.length > 0) {
    insights.push({
      id: 'high-context',
      kind: 'context',
      title: `${highCtx.length} ${highCtx.length === 1 ? 'sesión superó' : 'sesiones superaron'} el 75% de la ventana de contexto`,
      detail: `Ejemplo: «${highCtx[0].title}» (${highCtx[0].peakContextPct.toFixed(0)}%). Usar /compact o iniciar hilo nuevo reduce cuota.`,
    });
  }

  if (cacheAnalytics.recentBreaks.length > 0) {
    insights.push({
      id: 'cache-breaks',
      kind: 'cache',
      title: `${cacheAnalytics.recentBreaks.length} rotura(s) de caché detectadas en el periodo`,
      detail: 'Ocurren cuando cambia el modelo, expira el TTL del prefijo o se reinicia el contexto sin compactación.',
    });
  }

  return insights;
}

export function buildInlineSummaryPayload(dashboard: DashboardPayload): InlineSummaryPayload {
  return {
    view: 'inline_summary',
    generatedAt: dashboard.generatedAt,
    period: dashboard.filters.period,
    quota: dashboard.quota,
    kpis: dashboard.kpis,
    topModels: dashboard.byModelFamily.slice(0, 5),
    topProjects: dashboard.byProject.slice(0, 4),
    alerts: dashboard.alerts,
    usdToEurRate: dashboard.config.usdToEurRate,
  };
}

export function formatMarkdownSummary(summary: InlineSummaryPayload): string {
  const lines: string[] = [];
  lines.push(`### Usage Monitor — Resumen (${summary.period})`);
  lines.push('');

  if (summary.quota.groups.length > 0) {
    lines.push('**Cuota en vivo**');
    for (const g of summary.quota.groups) {
      const bText = g.buckets
        .map((b) => `${b.window === '5h' ? '5h' : 'Semanal'}: **${b.remainingPct.toFixed(1)}%** restante`)
        .join(' · ');
      lines.push(`- ${g.name}: ${bText}`);
    }
    if (summary.quota.credits) {
      lines.push(`- AI Credits disponibles: **${summary.quota.credits.remainingCredits}**`);
    }
    lines.push('');
  }

  lines.push('**Uso y caché del periodo**');
  lines.push(`- Gasto API equivalente estimado: **${formatEur(summary.kpis.totalCostEur)}**`);
  lines.push(
    `- Nivel de caché: **${(summary.kpis.globalCacheHitRate * 100).toFixed(1)}%** global · **${(summary.kpis.warmCacheHitRate * 100).toFixed(1)}%** en caliente (ahorro estimado: **${formatEur(summary.kpis.cacheSavingsEur)}**)`,
  );
  lines.push(
    `- Tokens: **${formatCompactNumber(summary.kpis.totalPromptTokens + summary.kpis.totalOutput)}** (${formatCompactNumber(summary.kpis.totalCacheRead)} caché · ${formatCompactNumber(summary.kpis.totalFreshInput)} entrada fresca · ${formatCompactNumber(summary.kpis.totalOutput)} salida)`,
  );
  lines.push(
    `- Actividad: **${summary.kpis.conversationCount}** conversaciones (${summary.kpis.subagentCount} subagentes) · **${summary.kpis.totalTurns}** turnos`,
  );

  if (summary.topModels.length > 0) {
    lines.push('');
    lines.push('**Top modelos**');
    for (const m of summary.topModels.slice(0, 4)) {
      lines.push(
        `- ${m.familyName}: **${formatEur(m.costEur)}** (${m.sharePct.toFixed(1)}%) · ${m.turns} turnos · caché ${(m.globalCacheHitRate * 100).toFixed(1)}%`,
      );
    }
  }

  if (summary.topProjects.length > 0) {
    lines.push('');
    lines.push('**Top proyectos**');
    for (const p of summary.topProjects.slice(0, 3)) {
      lines.push(`- ${p.projectName}: **${formatEur(p.costEur)}** · ${p.conversations} sesiones`);
    }
  }

  if (summary.alerts.length > 0) {
    lines.push('');
    lines.push('**Alertas**');
    for (const a of summary.alerts) {
      lines.push(`- ⚠️ ${a.title}`);
    }
  }

  return lines.join('\n');
}
