import React from 'react';
import { formatCompactNumber, formatEur } from '../../shared/pricing.js';
import type { DashboardPayload } from '../../shared/types.js';
import { TimelineChartSvg } from './SvgCharts.js';

export function CacheTab({ data }: { data: DashboardPayload }) {
  const { cacheAnalytics, kpis } = data;

  return (
    <div className="tab-stack">
      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Acierto en caliente (sin Turno 1)</span>
          <strong className="kpi-value">{(cacheAnalytics.warmHitRate * 100).toFixed(1)}%</strong>
          <span className="kpi-sub">
            {cacheAnalytics.warmTurns} turnos en caliente · {cacheAnalytics.coldTurns} en frío
          </span>
        </div>

        <div className="card kpi-card">
          <span className="kpi-label">Acierto global de caché</span>
          <strong className="kpi-value">{(cacheAnalytics.globalHitRate * 100).toFixed(1)}%</strong>
          <span className="kpi-sub">
            {formatCompactNumber(kpis.totalCacheRead)} de {formatCompactNumber(kpis.totalPromptTokens)} tokens de entrada
          </span>
        </div>

        <div className="card kpi-card">
          <span className="kpi-label">Ahorro estimado por caché</span>
          <strong className="kpi-value text-success">{formatEur(cacheAnalytics.totalSavingsEur)}</strong>
          <span className="kpi-sub">
            Descuento efectivo del {cacheAnalytics.effectiveDiscountPct.toFixed(1)}% sobre coste sin caché
          </span>
        </div>

        <div className="card kpi-card">
          <span className="kpi-label">Roturas de caché detectadas</span>
          <strong className="kpi-value">{kpis.cacheBreakCount}</strong>
          <span className="kpi-sub">
            Caídas &gt;50% en cache_read (excluye compactions)
          </span>
        </div>
      </div>

      <div className="card panel-card">
        <div className="card-header-row">
          <div>
            <h3>Evolución del nivel de caché (%)</h3>
            <span className="muted-caption">Porcentaje de tokens servidos desde caché por intervalo</span>
          </div>
        </div>
        <TimelineChartSvg data={data.timeSeries} metric="cache" />
      </div>

      <div className="card table-card">
        <div className="card-header-row table-header-pad">
          <div>
            <h3>Eficiencia de caché y ahorro por modelo</h3>
            <span className="muted-caption">Comparativa de Hit Rate global vs turnos en caliente</span>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Familia de modelo</th>
                <th className="num">Turnos en caliente</th>
                <th className="num">Hit Rate en caliente</th>
                <th className="num">Hit Rate global</th>
                <th className="num">Tokens caché</th>
                <th className="num">Ahorro estimado</th>
              </tr>
            </thead>
            <tbody>
              {cacheAnalytics.byModel.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-row">Sin datos de caché en este periodo.</td>
                </tr>
              ) : (
                cacheAnalytics.byModel.map((m) => (
                  <tr key={m.key}>
                    <td><strong>{m.familyName}</strong></td>
                    <td className="num">{m.warmTurns} / {m.turns}</td>
                    <td className="num"><strong>{(m.warmCacheHitRate * 100).toFixed(1)}%</strong></td>
                    <td className="num">{(m.globalCacheHitRate * 100).toFixed(1)}%</td>
                    <td className="num">{formatCompactNumber(m.cacheRead)}</td>
                    <td className="num text-success"><strong>{formatEur(m.savingsEur)}</strong></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card table-card">
        <div className="card-header-row table-header-pad">
          <div>
            <h3>Roturas recientes de caché</h3>
            <span className="muted-caption">
              Turnos con contexto previo ≥ 8K donde la lectura de caché cayó &gt;50% (cambio de modelo, TTL o reinicio de prefijo)
            </span>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Conversación</th>
                <th>Proyecto</th>
                <th>Modelo</th>
                <th className="num">Ctx previo</th>
                <th className="num">Caché leída</th>
                <th className="num">Caída</th>
                <th className="num">Sobrecoste est.</th>
              </tr>
            </thead>
            <tbody>
              {cacheAnalytics.recentBreaks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-row">
                    Excelente: no se detectaron roturas significativas de caché en esta ventana.
                  </td>
                </tr>
              ) : (
                cacheAnalytics.recentBreaks.map((ev, idx) => (
                  <tr key={`${ev.conversationId}-${ev.ts}-${idx}`}>
                    <td>{new Date(ev.ts).toLocaleString('es-ES')}</td>
                    <td className="truncate-cell" title={ev.title}>{ev.title}</td>
                    <td><span className="tag">{ev.projectName}</span></td>
                    <td>{ev.modelName}</td>
                    <td className="num">{formatCompactNumber(ev.prevPromptTokens)}</td>
                    <td className="num">{formatCompactNumber(ev.currCacheReadTokens)}</td>
                    <td className="num text-danger">-{ev.dropPct.toFixed(0)}%</td>
                    <td className="num">{formatEur(ev.estimatedExtraCostEur)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
