export type PeriodFilter = '5h' | '24h' | '7d' | '30d' | 'all';
export type SurfaceKind = 'app' | 'cli' | 'ide';
export type SurfaceFilter = 'all' | SurfaceKind;

export interface QuotaHistoryPoint {
  ts: string;
  remainingPct: number;
}

export interface QuotaBucket {
  id: string;
  name: string;
  description: string;
  window: '5h' | 'weekly' | string;
  remainingFraction: number;
  remainingPct: number;
  usedPct: number;
  resetTime: string;
  burnRatePctPerHour: number | null;
  estimatedHoursToEmpty: number | null;
  history: QuotaHistoryPoint[];
}

export interface QuotaGroup {
  name: string;
  description: string;
  buckets: QuotaBucket[];
}

export interface CreditsInfo {
  remainingCredits: number;
  upgradeUri?: string;
}

export interface QuotaState {
  groups: QuotaGroup[];
  credits: CreditsInfo | null;
  fetchedAt: string | null;
  fromCache: boolean;
  stale: boolean;
  error: string | null;
  historyCount: number;
}

export interface ModelPricingUsd {
  familyKey: string;
  displayName: string;
  group: 'Gemini Models' | 'Claude & GPT' | 'Legacy';
  input: number;
  cacheRead: number;
  output: number;
  contextWindow: number;
}

export interface AlertThresholds {
  quota5hWarnPct: number;
  quotaWeeklyWarnPct: number;
  weeklyBudgetEur: number;
}

export interface PluginConfig {
  usdToEurRate: number;
  autoSnapshotMinutes: number;
  quotaStaleMinutes: number;
  alerts: AlertThresholds;
  pricingUsd: Record<string, ModelPricingUsd>;
}

export interface IndexedTurn {
  stepIndex: number;
  ts: string;
  tsMs: number;
  modelRaw: string | null;
  freshInput: number;
  cacheRead: number;
  output: number;
  isCheckpoint?: boolean;
  prevWasCheckpoint?: boolean;
}

export interface IndexedConversation {
  id: string;
  surface: SurfaceKind;
  title: string;
  projectId: string;
  projectName: string;
  agentName: string;
  parentConversationId: string;
  nestingDepth: number;
  lastModifiedMs: number;
  turns: IndexedTurn[];
  mtimeMs: number;
  size: number;
  legacyOnly: boolean;
}

export interface ParsedModelInfo {
  familyKey: string;
  familyName: string;
  effort: string | null;
  group: 'Gemini Models' | 'Claude & GPT' | 'Legacy';
  isLegacy: boolean;
  slug: string;
}

export interface ModelAggregate {
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
  totalPromptTokens: number;
  globalCacheHitRate: number;
  warmCacheHitRate: number;
  coldTurns: number;
  warmTurns: number;
  avgContextTokens: number;
  costEur: number;
  uncachedCostEur: number;
  savingsEur: number;
  sharePct: number;
}

export interface CacheBreakEvent {
  conversationId: string;
  title: string;
  projectName: string;
  surface: SurfaceKind;
  ts: string;
  modelName: string;
  prevPromptTokens: number;
  currCacheReadTokens: number;
  currFreshInputTokens: number;
  dropPct: number;
  estimatedExtraCostEur: number;
}

export interface TimeSeriesPoint {
  bucketKey: string;
  label: string;
  ts: string;
  freshInput: number;
  cacheRead: number;
  output: number;
  costEur: number;
  savingsEur: number;
  cacheHitRate: number;
  turns: number;
}

export interface ProjectAggregate {
  projectId: string;
  projectName: string;
  conversations: number;
  subagents: number;
  turns: number;
  freshInput: number;
  cacheRead: number;
  output: number;
  cacheHitRate: number;
  costEur: number;
  savingsEur: number;
  sharePct: number;
}

export interface SubagentRow {
  id: string;
  agentName: string;
  title: string;
  turns: number;
  freshInput: number;
  cacheRead: number;
  output: number;
  cacheHitRate: number;
  costEur: number;
  savingsEur: number;
  models: string[];
}

export interface SessionRow {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  surface: SurfaceKind;
  lastActivity: string;
  turns: number;
  freshInput: number;
  cacheRead: number;
  output: number;
  cacheHitRate: number;
  peakContextTokens: number;
  peakContextPct: number;
  costEur: number;
  savingsEur: number;
  models: string[];
  subagentCount: number;
  subagentCostEur: number;
  subagents: SubagentRow[];
}

export interface AlertItem {
  id: string;
  severity: 'warning' | 'danger' | 'info';
  title: string;
  detail: string;
}

export interface InsightItem {
  id: string;
  kind: 'cache' | 'context' | 'model' | 'quota';
  title: string;
  detail: string;
}

export interface DiagnosticsInfo {
  appDataDirsFound: string[];
  transcriptCounts: Record<SurfaceKind, number>;
  sqliteAvailable: boolean;
  sqliteLoadedSurfaces: SurfaceKind[];
  projectsMapped: number;
  agyPath: string | null;
  dataDir: string;
  indexCacheHitCount: number;
  indexReparsedCount: number;
  totalIndexedTurns: number;
}

export interface DashboardFilters {
  period: PeriodFilter;
  projectId: string;
  surface: SurfaceFilter;
  includeLegacy: boolean;
}

export interface DashboardKpis {
  totalCostEur: number;
  uncachedCostEur: number;
  cacheSavingsEur: number;
  weeklyRollingCostEur: number;
  totalFreshInput: number;
  totalCacheRead: number;
  totalOutput: number;
  totalPromptTokens: number;
  globalCacheHitRate: number;
  warmCacheHitRate: number;
  coldTurns: number;
  warmTurns: number;
  cacheBreakCount: number;
  totalTurns: number;
  conversationCount: number;
  subagentCount: number;
  subagentCostEur: number;
  avgPeakContextPct: number;
}

export interface CacheAnalytics {
  globalHitRate: number;
  warmHitRate: number;
  coldTurns: number;
  warmTurns: number;
  totalSavingsEur: number;
  effectiveDiscountPct: number;
  byModel: ModelAggregate[];
  recentBreaks: CacheBreakEvent[];
}

export interface DashboardPayload {
  view: 'dashboard';
  generatedAt: string;
  filters: DashboardFilters;
  availableProjects: Array<{ id: string; name: string }>;
  quota: QuotaState;
  config: PluginConfig;
  kpis: DashboardKpis;
  timeSeries: TimeSeriesPoint[];
  byModelFamily: ModelAggregate[];
  byModelExact: ModelAggregate[];
  cacheAnalytics: CacheAnalytics;
  byProject: ProjectAggregate[];
  sessions: SessionRow[];
  alerts: AlertItem[];
  insights: InsightItem[];
  diagnostics: DiagnosticsInfo;
}

export interface InlineSummaryPayload {
  view: 'inline_summary';
  generatedAt: string;
  period: PeriodFilter;
  quota: QuotaState;
  kpis: DashboardKpis;
  topModels: ModelAggregate[];
  topProjects: ProjectAggregate[];
  alerts: AlertItem[];
  usdToEurRate: number;
}
