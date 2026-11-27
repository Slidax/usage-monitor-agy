import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  App as McpApp,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { formatCompactNumber, formatEur } from '../shared/pricing.js';
import type {
  AlertItem,
  DashboardFilters,
  DashboardPayload,
  InlineSummaryPayload,
  PeriodFilter,
  PluginConfig,
  QuotaState,
  SurfaceFilter,
} from '../shared/types.js';
import { CacheTab } from './components/CacheTab.js';
import { InlineSummaryCard } from './components/InlineSummaryCard.js';
import { ModelsTab } from './components/ModelsTab.js';
import { OverviewTab } from './components/OverviewTab.js';
import { QuotaPanel } from './components/QuotaPanel.js';
import { SessionsTab } from './components/SessionsTab.js';
import { SettingsTab } from './components/SettingsTab.js';

type TabId = 'overview' | 'models' | 'cache' | 'sessions' | 'settings';

function applyThemeContext(ctx?: McpUiHostContext | null): void {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    document.documentElement.dataset.theme = ctx.theme;
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

function buildCsvExport(data: DashboardPayload): string {
  const esc = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    'id',
    'titulo',
    'proyecto',
    'superficie',
    'modelos',
    'turnos',
    'subagentes',
    'input_fresco',
    'cache_leida',
    'salida',
    'cache_hit_pct',
    'ctx_pico_pct',
    'gasto_eur',
    'ahorro_cache_eur',
    'ultima_actividad',
  ].join(',');

  const rows = data.sessions.map((s) =>
    [
      esc(s.id),
      esc(s.title),
      esc(s.projectName),
      esc(s.surface),
      esc(s.models.join(' | ')),
      s.turns,
      s.subagentCount,
      s.freshInput,
      s.cacheRead,
      s.output,
      (s.cacheHitRate * 100).toFixed(2),
      s.peakContextPct.toFixed(1),
      s.costEur.toFixed(4),
      s.savingsEur.toFixed(4),
      esc(s.lastActivity),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

function buildContextAttachmentText(data: DashboardPayload): string {
  const lines: string[] = [
    `[Usage Monitor — Ventana ${data.filters.period}]`,
    `Gasto equivalente estimado: ${formatEur(data.kpis.totalCostEur)} | Ahorro caché: ${formatEur(data.kpis.cacheSavingsEur)} (${(data.kpis.warmCacheHitRate * 100).toFixed(1)}% hit rate en caliente)`,
    `Tokens: ${formatCompactNumber(data.kpis.totalPromptTokens + data.kpis.totalOutput)} (${formatCompactNumber(data.kpis.totalCacheRead)} caché, ${formatCompactNumber(data.kpis.totalFreshInput)} fresco, ${formatCompactNumber(data.kpis.totalOutput)} salida)`,
  ];
  for (const g of data.quota.groups) {
    const parts = g.buckets.map((b) => `${b.window === '5h' ? '5h' : 'Semanal'}: ${b.remainingPct.toFixed(1)}% libre`);
    lines.push(`Cuota ${g.name}: ${parts.join(' · ')}`);
  }
  if (data.byModelFamily.length > 0) {
    const top = data.byModelFamily
      .slice(0, 4)
      .map((m) => `${m.familyName} (${formatEur(m.costEur)}, ${m.sharePct.toFixed(0)}%)`)
      .join(', ');
    lines.push(`Top modelos: ${top}`);
  }
  return lines.join('\n');
}

export function App() {
  const appRef = useRef<McpApp | null>(null);
  const autoRefreshedRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<McpUiHostCapabilities | undefined>(undefined);

  const [inlineData, setInlineData] = useState<InlineSummaryPayload | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [filters, setFilters] = useState<DashboardFilters>({
    period: '7d',
    projectId: 'all',
    surface: 'all',
    includeLegacy: false,
  });

  const [loadingData, setLoadingData] = useState(false);
  const [refreshingQuota, setRefreshingQuota] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3200);
  }, []);

  const refreshQuota = useCallback(
    async (force: boolean, weeklyRollingCostEur?: number) => {
      const mcpApp = appRef.current;
      if (!mcpApp) return;
      setRefreshingQuota(true);
      try {
        const res = await mcpApp.callServerTool({
          name: 'app_refresh_quota',
          arguments: {
            force,
            weeklyRollingCostEur: weeklyRollingCostEur ?? dashboard?.kpis.weeklyRollingCostEur ?? 0,
          },
        });
        const sc = res.structuredContent as { quota?: QuotaState; alerts?: AlertItem[] } | undefined;
        if (sc?.quota) {
          setDashboard((prev) =>
            prev
              ? {
                  ...prev,
                  quota: sc.quota!,
                  alerts: sc.alerts ?? prev.alerts,
                }
              : prev,
          );
          setInlineData((prev) =>
            prev
              ? {
                  ...prev,
                  quota: sc.quota!,
                  alerts: sc.alerts ?? prev.alerts,
                }
              : prev,
          );
        }
      } catch (err) {
        console.error('Error refreshing quota:', err);
      } finally {
        setRefreshingQuota(false);
      }
    },
    [dashboard?.kpis.weeklyRollingCostEur],
  );

  const loadDashboardData = useCallback(async (nextFilters: DashboardFilters) => {
    const mcpApp = appRef.current;
    if (!mcpApp) return;
    setLoadingData(true);
    try {
      const res = await mcpApp.callServerTool({
        name: 'app_get_dashboard_data',
        arguments: nextFilters as unknown as Record<string, unknown>,
      });
      const sc = res.structuredContent as DashboardPayload | undefined;
      if (sc?.view === 'dashboard') {
        setDashboard(sc);
        setFilters(sc.filters);
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (appRef.current) return;

    const mcpApp = new McpApp(
      { name: 'Usage Monitor', version: '1.0.0' },
      {},
      { autoResize: true },
    );
    appRef.current = mcpApp;

    let receivedResult = false;

    mcpApp.ontoolinput = () => {
      // Initial skeleton already shown
    };

    mcpApp.ontoolresult = (result) => {
      receivedResult = true;
      const sc = result.structuredContent as
        | DashboardPayload
        | InlineSummaryPayload
        | undefined;
      if (!sc) return;

      if (sc.view === 'inline_summary') {
        setInlineData(sc);
        setDashboard(null);
      } else if (sc.view === 'dashboard') {
        setDashboard(sc);
        setInlineData(null);
        setFilters(sc.filters);

        if ((sc.quota.stale || !sc.quota.fetchedAt) && !autoRefreshedRef.current) {
          autoRefreshedRef.current = true;
          void refreshQuota(false, sc.kpis.weeklyRollingCostEur);
        }
      }
    };

    mcpApp.onhostcontextchanged = (ctx) => {
      applyThemeContext(ctx);
    };

    mcpApp
      .connect()
      .then(() => {
        setConnected(true);
        setCapabilities(mcpApp.getHostCapabilities());
        applyThemeContext(mcpApp.getHostContext());

        setTimeout(() => {
          if (!receivedResult) {
            void loadDashboardData(filters).then(() => {
              if (!autoRefreshedRef.current) {
                autoRefreshedRef.current = true;
                void refreshQuota(false);
              }
            });
          }
        }, 200);
      })
      .catch((err) => {
        setConnectError(err instanceof Error ? err.message : String(err));
      });
  }, [filters, loadDashboardData, refreshQuota]);

  const handleFilterChange = (patch: Partial<DashboardFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    void loadDashboardData(next);
  };

  const handleSaveConfig = async (nextConfig: PluginConfig) => {
    const mcpApp = appRef.current;
    if (!mcpApp) return;
    setSavingConfig(true);
    try {
      await mcpApp.callServerTool({
        name: 'app_save_config',
        arguments: { config: nextConfig },
      });
      await loadDashboardData(filters);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetDefaults = async () => {
    const mcpApp = appRef.current;
    if (!mcpApp) return;
    setSavingConfig(true);
    try {
      await mcpApp.callServerTool({
        name: 'app_save_config',
        arguments: { resetDefaults: true },
      });
      await loadDashboardData(filters);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleAttachContext = async () => {
    const mcpApp = appRef.current;
    if (!mcpApp || !dashboard) return;
    try {
      await mcpApp.updateModelContext({
        content: [{ type: 'text', text: buildContextAttachmentText(dashboard) }],
      });
      showToast('Resumen adjuntado al contexto del próximo mensaje.');
    } catch {
      showToast('El host no permitió adjuntar contexto en esta vista.');
    }
  };

  const handleOpenLink = async (url: string) => {
    const mcpApp = appRef.current;
    if (!mcpApp) return;
    try {
      await mcpApp.openLink({ url });
    } catch {
      showToast('No se pudo abrir el enlace externo.');
    }
  };

  const handleDownloadOrCopy = async (kind: 'json' | 'csv', mode: 'download' | 'copy') => {
    if (!dashboard) return;
    const text =
      kind === 'json' ? JSON.stringify(dashboard, null, 2) : buildCsvExport(dashboard);
    const filename = `usage-monitor-${dashboard.filters.period}.${kind}`;
    const mimeType = kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8';

    if (mode === 'copy') {
      try {
        await navigator.clipboard.writeText(text);
        showToast(`${kind.toUpperCase()} copiado al portapapeles.`);
        setExportOpen(false);
        return;
      } catch {
        showToast('No se pudo copiar al portapapeles en este entorno.');
      }
    }

    if (capabilities?.downloadFile && appRef.current) {
      try {
        const res = await appRef.current.downloadFile({
          contents: [
            {
              type: 'resource',
              resource: {
                uri: `file:///${filename}`,
                mimeType,
                text,
              },
            },
          ],
        });
        if (!res.isError) {
          showToast(`Archivo ${filename} exportado.`);
          setExportOpen(false);
          return;
        }
      } catch {
        // Fallback to blob anchor
      }
    }

    try {
      const blob = new Blob([text], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`Descarga iniciada (${filename}).`);
      setExportOpen(false);
    } catch {
      showToast('Usa «Copiar» si tu vista bloquea descargas.');
    }
  };

  if (connectError) {
    return (
      <div className="loading-shell">
        <div className="card panel-card">
          <h3>Error de conexión MCP App</h3>
          <p className="muted-text">{connectError}</p>
        </div>
      </div>
    );
  }

  if (inlineData) {
    return <InlineSummaryCard data={inlineData} />;
  }

  if (!dashboard) {
    return (
      <div className="loading-shell">
        <div className="spinner" />
        <p className="muted-text">
          {connected ? 'Indexando uso, modelos y caché…' : 'Conectando con Antigravity…'}
        </p>
      </div>
    );
  }

  const canUpdateContext = Boolean(capabilities?.updateModelContext);
  const canOpenLinks = Boolean(capabilities?.openLinks);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-title">
            <span className="brand-dot" />
            <h1>Usage Monitor</h1>
            <span className="eur-badge">EUR €</span>
          </div>
          <p className="muted-caption">
            {dashboard.kpis.conversationCount} sesiones · {dashboard.kpis.totalTurns} turnos ·{' '}
            {loadingData ? 'Actualizando…' : `Actualizado ${new Date(dashboard.generatedAt).toLocaleTimeString('es-ES')}`}
          </p>
        </div>

        <div className="topbar-actions">
          {canUpdateContext && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleAttachContext}
            >
              Adjuntar contexto al chat
            </button>
          )}

          <div className="export-wrap">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setExportOpen((o) => !o)}
            >
              Exportar ▾
            </button>
            {exportOpen && (
              <div className="export-menu card">
                <button type="button" onClick={() => handleDownloadOrCopy('csv', 'download')}>
                  Descargar CSV (sesiones)
                </button>
                <button type="button" onClick={() => handleDownloadOrCopy('json', 'download')}>
                  Descargar JSON (completo)
                </button>
                <hr />
                <button type="button" onClick={() => handleDownloadOrCopy('csv', 'copy')}>
                  Copiar CSV al portapapeles
                </button>
                <button type="button" onClick={() => handleDownloadOrCopy('json', 'copy')}>
                  Copiar JSON al portapapeles
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {statusToast && <div className="toast-banner">{statusToast}</div>}

      <div className="filter-bar card">
        <div className="segmented" role="group" aria-label="Periodo">
          {(['5h', '24h', '7d', '30d', 'all'] as PeriodFilter[]).map((p) => (
            <button
              key={p}
              type="button"
              className={filters.period === p ? 'active' : ''}
              onClick={() => handleFilterChange({ period: p })}
            >
              {p === 'all' ? 'Todo' : p}
            </button>
          ))}
        </div>

        <select
          aria-label="Filtrar por proyecto"
          value={filters.projectId}
          onChange={(e) => handleFilterChange({ projectId: e.target.value })}
        >
          <option value="all">Todos los proyectos</option>
          {dashboard.availableProjects.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filtrar por superficie"
          value={filters.surface}
          onChange={(e) => handleFilterChange({ surface: e.target.value as SurfaceFilter })}
        >
          <option value="all">Todas las superficies</option>
          <option value="app">Antigravity App</option>
          <option value="cli">Antigravity CLI</option>
          <option value="ide">Antigravity IDE</option>
        </select>

        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={filters.includeLegacy}
            onChange={(e) => handleFilterChange({ includeLegacy: e.target.checked })}
          />
          <span>Incluir legacy (sin modelo)</span>
        </label>
      </div>

      <nav className="tabs-nav" aria-label="Secciones">
        {(
          [
            ['overview', 'Resumen & Cuota'],
            ['models', 'Modelos'],
            ['cache', 'Caché'],
            ['sessions', 'Proyectos & Sesiones'],
            ['settings', 'Ajustes'],
          ] as Array<[TabId, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab-btn ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activeTab === 'overview' && (
          <>
            <QuotaPanel
              quota={dashboard.quota}
              alerts={dashboard.alerts}
              refreshing={refreshingQuota}
              onRefresh={() => void refreshQuota(true)}
              canOpenLinks={canOpenLinks}
              onOpenLink={(u) => void handleOpenLink(u)}
            />
            <OverviewTab data={dashboard} />
          </>
        )}
        {activeTab === 'models' && <ModelsTab data={dashboard} />}
        {activeTab === 'cache' && <CacheTab data={dashboard} />}
        {activeTab === 'sessions' && <SessionsTab data={dashboard} />}
        {activeTab === 'settings' && (
          <SettingsTab
            data={dashboard}
            saving={savingConfig}
            onSave={handleSaveConfig}
            onResetDefaults={handleResetDefaults}
          />
        )}
      </main>
    </div>
  );
}
