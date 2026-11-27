import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  buildDashboardPayload,
  buildInlineSummaryPayload,
  evaluateAlerts,
  formatMarkdownSummary,
} from './aggregator.js';
import { ConfigStore, resolveDataDir } from './config-store.js';
import { QuotaService } from './quota-service.js';
import { TranscriptIndexer } from './transcript-indexer.js';
import type {
  DashboardFilters,
  DashboardPayload,
  PeriodFilter,
  SurfaceFilter,
} from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_UI_URI = 'ui://usage-monitor/app.html';
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';

const VALID_PERIODS = new Set<PeriodFilter>(['5h', '24h', '7d', '30d', 'all']);
const VALID_SURFACES = new Set<SurfaceFilter>(['all', 'app', 'cli', 'ide']);

function parseFilters(raw: Record<string, unknown> | undefined): Partial<DashboardFilters> {
  if (!raw) return {};
  const period =
    typeof raw.period === 'string' && VALID_PERIODS.has(raw.period as PeriodFilter)
      ? (raw.period as PeriodFilter)
      : undefined;
  const surface =
    typeof raw.surface === 'string' && VALID_SURFACES.has(raw.surface as SurfaceFilter)
      ? (raw.surface as SurfaceFilter)
      : undefined;
  const projectId = typeof raw.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : undefined;
  const includeLegacy = typeof raw.includeLegacy === 'boolean' ? raw.includeLegacy : undefined;
  return { period, surface, projectId, includeLegacy };
}

function resolveUiHtmlPath(): string {
  const fromEnv = process.env.USAGE_MONITOR_UI_HTML?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [
    path.resolve(__dirname, '..', 'ui', 'app.html'),
    path.resolve(__dirname, '..', '..', 'dist', 'ui', 'index.html'),
    path.resolve(__dirname, 'ui', 'app.html'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function readUiHtml(): string {
  const htmlPath = resolveUiHtmlPath();
  if (fs.existsSync(htmlPath)) {
    return fs.readFileSync(htmlPath, 'utf8');
  }
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Usage Monitor</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;">
  <h2>Usage Monitor UI no encontrada</h2>
  <p>Ruta esperada: ${htmlPath}</p>
</body>
</html>`;
}

function fitTrajectoryCap(payload: DashboardPayload): DashboardPayload {
  // Antigravity persists initial tool CallToolResult payloads up to 1 MiB.
  // Trim sessions if a massive history ever exceeds ~650 KB.
  const raw = JSON.stringify(payload);
  if (Buffer.byteLength(raw, 'utf8') <= 650_000) {
    return payload;
  }
  return {
    ...payload,
    sessions: payload.sessions.slice(0, 25),
    cacheAnalytics: {
      ...payload.cacheAnalytics,
      recentBreaks: payload.cacheAnalytics.recentBreaks.slice(0, 10),
    },
  };
}

export function createUsageMonitorServer(): {
  server: Server;
  quotaService: QuotaService;
  configStore: ConfigStore;
} {
  const dataDir = resolveDataDir();
  const configStore = new ConfigStore(dataDir);
  const quotaService = new QuotaService(dataDir);
  const indexer = new TranscriptIndexer(dataDir);

  const server = new Server(
    { name: 'usage-monitor', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  async function computeDashboard(
    rawArgs: Record<string, unknown> | undefined,
    opts: { refreshIfStale?: boolean } = {},
  ): Promise<DashboardPayload> {
    const config = configStore.get();
    const filters = parseFilters(rawArgs);
    const [indexResult, quota] = await Promise.all([
      indexer.indexAll(),
      opts.refreshIfStale
        ? quotaService.refreshQuota(config, { force: false })
        : Promise.resolve(quotaService.getCachedQuota(config)),
    ]);

    const dashboard = buildDashboardPayload(indexResult, quota, config, filters);
    dashboard.diagnostics.agyPath = quotaService.getAgyPath();
    dashboard.diagnostics.dataDir = configStore.getDataDir();
    return dashboard;
  }

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: APP_UI_URI,
        name: 'Usage Monitor Dashboard',
        description: 'Interfaz interactiva para visualizar cuotas en vivo, consumo por modelo en EUR y caché.',
        mimeType: APP_MIME_TYPE,
        _meta: {
          ui: {
            prefersBorder: false,
          },
        },
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== APP_UI_URI) {
      throw new Error(`Resource not found: ${request.params.uri}`);
    }
    const html = readUiHtml();
    return {
      contents: [
        {
          uri: APP_UI_URI,
          mimeType: APP_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              prefersBorder: false,
            },
          },
        },
      ],
    };
  });

  const filterProperties = {
    period: {
      type: 'string',
      enum: ['5h', '24h', '7d', '30d', 'all'],
      description: 'Ventana temporal de análisis (por defecto 7d).',
    },
    projectId: {
      type: 'string',
      description: 'ID del proyecto a filtrar, o "all" para todos.',
    },
    surface: {
      type: 'string',
      enum: ['all', 'app', 'cli', 'ide'],
      description: 'Superficie de Antigravity (all, app, cli o ide).',
    },
    includeLegacy: {
      type: 'boolean',
      description: 'Incluir turnos históricos antiguos sin etiqueta de modelo (por defecto false).',
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'open_usage_dashboard',
        title: 'Abrir Usage Monitor',
        description:
          'Abre el dashboard interactivo de Usage Monitor en el panel lateral o vista completa con cuotas en vivo, gasto estimado en EUR por modelo, nivel de caché, proyectos y subagentes.',
        inputSchema: {
          type: 'object',
          properties: filterProperties,
          additionalProperties: false,
        },
        _meta: {
          ui: { resourceUri: APP_UI_URI },
          'ui/resourceUri': APP_UI_URI,
          'com.google.antigravity/ui': {
            entrypoints: [
              { type: 'aux_pane', title: 'Usage Monitor' },
              { type: 'global', title: 'Usage Monitor' },
            ],
          },
        },
      },
      {
        name: 'get_usage_summary',
        title: 'Resumen de cuota, modelos y caché',
        description:
          'Muestra una tarjeta interactiva inline (y resumen Markdown en CLI/IDE) con la cuota en vivo, el gasto equivalente en EUR, el nivel de caché y el top de modelos y proyectos.',
        inputSchema: {
          type: 'object',
          properties: filterProperties,
          additionalProperties: false,
        },
        _meta: {
          ui: { resourceUri: APP_UI_URI },
          'ui/resourceUri': APP_UI_URI,
        },
      },
      {
        name: 'app_get_dashboard_data',
        title: 'Obtener datos filtrados del dashboard',
        description: 'Herramienta interna de la UI para consultar métricas filtradas.',
        inputSchema: {
          type: 'object',
          properties: filterProperties,
          additionalProperties: false,
        },
        _meta: {
          ui: { visibility: ['app'] },
        },
      },
      {
        name: 'app_refresh_quota',
        title: 'Refrescar cuota en vivo',
        description: 'Consulta agy /usage y /credits en segundo plano sin consumir tokens.',
        inputSchema: {
          type: 'object',
          properties: {
            force: { type: 'boolean' },
            weeklyRollingCostEur: { type: 'number' },
          },
          additionalProperties: false,
        },
        _meta: {
          ui: { visibility: ['app'] },
        },
      },
      {
        name: 'app_get_config',
        title: 'Leer configuración de Usage Monitor',
        description: 'Devuelve tarifas, tipo de cambio USD→EUR y umbrales configurados.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        _meta: {
          ui: { visibility: ['app'] },
        },
      },
      {
        name: 'app_save_config',
        title: 'Guardar configuración de Usage Monitor',
        description: 'Guarda tarifas USD, tipo de cambio USD→EUR, polling y umbrales en PLUGIN_DATA.',
        inputSchema: {
          type: 'object',
          properties: {
            config: { type: 'object' },
            resetDefaults: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        _meta: {
          ui: { visibility: ['app'] },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    switch (name) {
      case 'open_usage_dashboard': {
        // Keep initial response fast using cached quota snapshot; the UI triggers
        // app_refresh_quota asynchronously when stale (> quotaStaleMinutes).
        const dashboard = fitTrajectoryCap(await computeDashboard(args, { refreshIfStale: false }));
        const summary = buildInlineSummaryPayload(dashboard);
        const markdown = formatMarkdownSummary(summary);
        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent: dashboard as unknown as Record<string, unknown>,
        };
      }

      case 'get_usage_summary': {
        const dashboard = await computeDashboard(args, { refreshIfStale: true });
        const summary = buildInlineSummaryPayload(dashboard);
        const markdown = formatMarkdownSummary(summary);
        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent: summary as unknown as Record<string, unknown>,
        };
      }

      case 'app_get_dashboard_data': {
        const dashboard = await computeDashboard(args, { refreshIfStale: false });
        return {
          content: [{ type: 'text', text: `Datos cargados (${dashboard.kpis.totalTurns} turnos).` }],
          structuredContent: dashboard as unknown as Record<string, unknown>,
        };
      }

      case 'app_refresh_quota': {
        const config = configStore.get();
        const force = Boolean(args.force);
        const quota = await quotaService.refreshQuota(config, { force });
        const weeklyCost =
          typeof args.weeklyRollingCostEur === 'number' && Number.isFinite(args.weeklyRollingCostEur)
            ? args.weeklyRollingCostEur
            : 0;
        const alerts = evaluateAlerts(
          quota,
          {
            totalCostEur: 0,
            uncachedCostEur: 0,
            cacheSavingsEur: 0,
            weeklyRollingCostEur: weeklyCost,
            totalFreshInput: 0,
            totalCacheRead: 0,
            totalOutput: 0,
            totalPromptTokens: 0,
            globalCacheHitRate: 0,
            warmCacheHitRate: 0,
            coldTurns: 0,
            warmTurns: 0,
            cacheBreakCount: 0,
            totalTurns: 0,
            conversationCount: 0,
            subagentCount: 0,
            subagentCostEur: 0,
            avgPeakContextPct: 0,
          },
          config,
        );
        return {
          content: [{ type: 'text', text: `Cuota actualizada (${quota.groups.length} grupos).` }],
          structuredContent: { quota, alerts },
        };
      }

      case 'app_get_config': {
        return {
          content: [{ type: 'text', text: 'Configuración actual cargada.' }],
          structuredContent: { config: configStore.get() },
        };
      }

      case 'app_save_config': {
        const saved = args.resetDefaults
          ? configStore.resetDefaults()
          : configStore.save(args.config);
        quotaService.rescheduleBackgroundPolling(saved.autoSnapshotMinutes, () => configStore.get());
        return {
          content: [{ type: 'text', text: 'Configuración guardada.' }],
          structuredContent: { config: saved, saved: true },
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return { server, quotaService, configStore };
}

async function main(): Promise<void> {
  const { server, quotaService, configStore } = createUsageMonitorServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  quotaService.startBackgroundPolling(() => configStore.get());

  const shutdown = (): void => {
    quotaService.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((err) => {
    console.error('[usage-monitor] Fatal server error:', err);
    process.exit(1);
  });
}
