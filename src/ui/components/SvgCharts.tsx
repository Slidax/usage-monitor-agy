import React, { useState } from 'react';
import { formatCompactNumber, formatEur } from '../../shared/pricing.js';
import type { ModelAggregate, QuotaHistoryPoint, TimeSeriesPoint } from '../../shared/types.js';

export function SparklineSvg({
  points,
  color = '#2563eb',
  height = 34,
}: {
  points: QuotaHistoryPoint[];
  color?: string;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <div className="sparkline-empty">
        Sin historial suficiente aún (se captura cada 15 min)
      </div>
    );
  }

  const width = 220;
  const pad = 4;
  const min = Math.max(0, Math.min(...points.map((p) => p.remainingPct)) - 5);
  const max = Math.min(100, Math.max(...points.map((p) => p.remainingPct)) + 5);
  const span = Math.max(5, max - min);

  const coords = points.map((p, idx) => {
    const x = pad + (idx / Math.max(1, points.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (p.remainingPct - min) / span) * (height - pad * 2);
    return { x, y, p };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - pad} L ${coords[0].x.toFixed(1)} ${height - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="sparkline-svg"
      role="img"
      aria-label="Evolución de cuota"
    >
      <path d={areaPath} fill={color} fillOpacity="0.14" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle
        cx={coords[coords.length - 1].x}
        cy={coords[coords.length - 1].y}
        r="2.8"
        fill={color}
      />
    </svg>
  );
}

export type TimelineMetric = 'tokens' | 'cost' | 'cache';

export function TimelineChartSvg({
  data,
  metric,
}: {
  data: TimeSeriesPoint[];
  metric: TimelineMetric;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return <div className="chart-empty">No hay actividad registrada en esta ventana.</div>;
  }

  const width = 760;
  const height = 220;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = data.map((d) => {
    if (metric === 'cost') return d.costEur;
    if (metric === 'cache') return d.cacheHitRate * 100;
    return d.cacheRead + d.freshInput + d.output;
  });

  const maxVal = metric === 'cache' ? 100 : Math.max(1e-6, ...values) * 1.12;
  const barGap = data.length > 24 ? 2 : 6;
  const stepW = plotW / data.length;
  const barW = Math.max(4, Math.min(36, stepW - barGap));

  const formatYAxis = (v: number): string => {
    if (metric === 'cost') return formatEur(v, true);
    if (metric === 'cache') return `${Math.round(v)}%`;
    return formatCompactNumber(v);
  };

  const yTicks = [0, 0.5, 1].map((frac) => {
    const val = maxVal * frac;
    const y = padTop + plotH - frac * plotH;
    return { val, y };
  });

  const labelStep = Math.max(1, Math.ceil(data.length / 7));

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="chart-wrap">
      {hovered && (
        <div className="chart-tooltip">
          <strong>{hovered.label}</strong>
          <span>Gasto: {formatEur(hovered.costEur)}</span>
          <span>Ahorro caché: {formatEur(hovered.savingsEur)}</span>
          <span>Caché: {(hovered.cacheHitRate * 100).toFixed(1)}%</span>
          <span>
            Tokens: {formatCompactNumber(hovered.cacheRead)} caché ·{' '}
            {formatCompactNumber(hovered.freshInput)} fresco · {formatCompactNumber(hovered.output)}{' '}
            salida
          </span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="timeline-svg"
        role="img"
        aria-label="Evolución temporal"
      >
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={t.y}
              y2={t.y}
              className="chart-grid-line"
            />
            <text x={padLeft - 8} y={t.y + 4} textAnchor="end" className="chart-axis-text">
              {formatYAxis(t.val)}
            </text>
          </g>
        ))}

        {metric === 'cache' ? (
          <>
            {(() => {
              const pts = data.map((d, idx) => {
                const x = padLeft + idx * stepW + stepW / 2;
                const y = padTop + plotH - ((d.cacheHitRate * 100) / 100) * plotH;
                return { x, y };
              });
              const path = pts
                .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                .join(' ');
              const area = `${path} L ${pts[pts.length - 1].x.toFixed(1)} ${padTop + plotH} L ${pts[0].x.toFixed(1)} ${padTop + plotH} Z`;
              return (
                <>
                  <path d={area} fill="#10b981" fillOpacity="0.14" />
                  <path d={path} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
                  {pts.map((p, idx) => (
                    <g key={data[idx].bucketKey}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={hoverIdx === idx ? 5 : 3.2}
                        fill="#10b981"
                      />
                      <rect
                        x={padLeft + idx * stepW}
                        y={padTop}
                        width={stepW}
                        height={plotH}
                        fill="transparent"
                        onMouseEnter={() => setHoverIdx(idx)}
                        onMouseLeave={() => setHoverIdx(null)}
                      />
                    </g>
                  ))}
                </>
              );
            })()}
          </>
        ) : (
          data.map((d, idx) => {
            const x = padLeft + idx * stepW + (stepW - barW) / 2;
            if (metric === 'cost') {
              const barH = (d.costEur / maxVal) * plotH;
              const y = padTop + plotH - barH;
              return (
                <g
                  key={d.bucketKey}
                  onMouseEnter={() => setHoverIdx(idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                >
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(1, barH)}
                    rx={3}
                    fill={hoverIdx === idx ? '#1d4ed8' : '#3b82f6'}
                  />
                </g>
              );
            }

            const cacheH = (d.cacheRead / maxVal) * plotH;
            const freshH = (d.freshInput / maxVal) * plotH;
            const outH = (d.output / maxVal) * plotH;
            const yCache = padTop + plotH - cacheH;
            const yFresh = yCache - freshH;
            const yOut = yFresh - outH;

            return (
              <g
                key={d.bucketKey}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
              >
                <rect x={x} y={yCache} width={barW} height={Math.max(0, cacheH)} fill="#10b981" rx={1.5} />
                <rect x={x} y={yFresh} width={barW} height={Math.max(0, freshH)} fill="#3b82f6" />
                <rect x={x} y={yOut} width={barW} height={Math.max(0, outH)} fill="#f59e0b" rx={1.5} />
                <rect x={x} y={padTop} width={barW} height={plotH} fill="transparent" />
              </g>
            );
          })
        )}

        {data.map((d, idx) =>
          idx % labelStep === 0 || idx === data.length - 1 ? (
            <text
              key={`lbl-${d.bucketKey}`}
              x={padLeft + idx * stepW + stepW / 2}
              y={height - 8}
              textAnchor="middle"
              className="chart-axis-text"
            >
              {d.label}
            </text>
          ) : null,
        )}
      </svg>

      {metric === 'tokens' && (
        <div className="chart-legend">
          <span><i className="dot dot-cache" /> Caché leída</span>
          <span><i className="dot dot-fresh" /> Entrada fresca</span>
          <span><i className="dot dot-out" /> Salida</span>
        </div>
      )}
    </div>
  );
}

export function HorizontalModelBars({ models }: { models: ModelAggregate[] }) {
  const top = models.slice(0, 7);
  if (top.length === 0) {
    return <div className="chart-empty">Sin modelos en el periodo seleccionado.</div>;
  }
  const maxCost = Math.max(0.0001, ...top.map((m) => m.costEur));

  return (
    <div className="hbar-list">
      {top.map((m) => {
        const pct = Math.max(2, (m.costEur / maxCost) * 100);
        return (
          <div key={m.key} className="hbar-row">
            <div className="hbar-meta">
              <span className="hbar-name">{m.label}</span>
              <span className="hbar-value">
                {formatEur(m.costEur)} ({m.sharePct.toFixed(1)}%)
              </span>
            </div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
