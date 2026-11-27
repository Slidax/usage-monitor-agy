import React, { useState } from 'react';
import { formatCompactNumber, formatEur } from '../../shared/pricing.js';
import type { DashboardPayload } from '../../shared/types.js';
import { HorizontalModelBars, TimelineChartSvg, type TimelineMetric } from './SvgCharts.js';

export function OverviewTab({ data }: { data: DashboardPayload }) {
  const [metric, setMetric] = useState<TimelineMetric>('tokens');
  const { kpis } = data;
  const totalTokens = kpis.totalPromptTokens + kpis.totalOutput;

  return (
    <div className="tab-stack">
      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Gasto API equivalente</span>
          <strong className="kpi-value">{formatEur(kpis.totalCostEur)}</strong>
          <span className="kpi-sub">
            Sin caché sería {formatEur(kpis.uncachedCostEur)}
          </span>
        </div>

        <div className="card kpi-card">
          <span className="kpi-label">Nivel de caché (En caliente)</span>
          <strong className="kpi-value">{(kpis.warmCacheHitRate * 100).toFixed(1)}%</strong>
          <span className="kpi-sub">
            Global {(kpis.globalCacheHitRate * 100).toFixed(1)}% · Ahorro{' '}
            <strong className="text-success">{formatEur(kpis.cacheSavingsEur)}</strong>
          </span>
        </div>

        <div className="card kpi-card">
          <span className="kpi-label">Tokens procesados</span>
          <strong className="kpi-value">{formatCompactNumber(totalTokens)}</strong>
          <span className="kpi-sub">
            {formatCompactNumber(kpis.totalCacheRead)} caché ·{' '}
            {formatCompactNumber(kpis.totalFreshInput)} fresco ·{' '}
            {formatCompactNumber(kpis.totalOutput)} salida
          </span>
        </div>

        <div className="card kpi-card">
          <span className="kpi-label">Sesiones y subagentes</span>
          <strong className="kpi-value">
            {kpis.conversationCount}{' '}
            <small className="kpi-unit">({kpis.totalTurns} turnos)</small>
          </strong>
          <span className="kpi-sub">
            {kpis.subagentCount} subagentes ({formatEur(kpis.subagentCostEur)}) · Ctx pico medio{' '}
            {kpis.avgPeakContextPct.toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="overview-grid">
        <div className="card panel-card">
          <div className="card-header-row">
            <div>
              <h3>Evolución en el tiempo</h3>
              <span className="muted-caption">
                Ventana {data.filters.period} · {data.timeSeries.length} intervalos
              </span>
            </div>
            <div className="segmented">
              <button
                type="button"
                className={metric === 'tokens' ? 'active' : ''}
                onClick={() => setMetric('tokens')}
              >
                Tokens
              </button>
              <button
                type="button"
                className={metric === 'cost' ? 'active' : ''}
                onClick={() => setMetric('cost')}
              >
                Gasto (€)
              </button>
              <button
                type="button"
                className={metric === 'cache' ? 'active' : ''}
                onClick={() => setMetric('cache')}
              >
                Caché (%)
              </button>
            </div>
          </div>
          <TimelineChartSvg data={data.timeSeries} metric={metric} />
        </div>

        <div className="card panel-card">
          <div className="card-header-row">
            <div>
              <h3>Peso por familia de modelo</h3>
              <span className="muted-caption">Gasto equivalente estimado en EUR</span>
            </div>
          </div>
          <HorizontalModelBars models={data.byModelFamily} />
        </div>
      </div>

      {data.insights.length > 0 && (
        <div className="card panel-card">
          <h3>Diagnóstico e insights</h3>
          <div className="insights-grid">
            {data.insights.map((ins) => (
              <div key={ins.id} className={`insight-item insight-${ins.kind}`}>
                <strong>{ins.title}</strong>
                <p>{ins.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
