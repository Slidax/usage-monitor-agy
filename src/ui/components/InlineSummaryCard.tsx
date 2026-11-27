import React from 'react';
import { formatCompactNumber, formatEur } from '../../shared/pricing.js';
import type { InlineSummaryPayload } from '../../shared/types.js';

export function InlineSummaryCard({ data }: { data: InlineSummaryPayload }) {
  const { kpis, quota } = data;
  const totalTokens = kpis.totalPromptTokens + kpis.totalOutput;

  return (
    <div className="inline-shell">
      <div className="inline-header">
        <div>
          <strong>Usage Monitor</strong>
          <span className="muted-inline"> · Ventana {data.period}</span>
        </div>
        {quota.credits && (
          <span className="credits-pill-sm">AI Credits: {quota.credits.remainingCredits}</span>
        )}
      </div>

      {data.alerts.length > 0 && (
        <div className="inline-alerts">
          {data.alerts.map((a) => (
            <div key={a.id} className={`alert-banner alert-${a.severity}`}>
              <strong>{a.title}</strong>
            </div>
          ))}
        </div>
      )}

      {quota.groups.length > 0 && (
        <div className="inline-quota-row">
          {quota.groups.map((g) => (
            <div key={g.name} className="inline-quota-box">
              <div className="inline-quota-title">{g.name}</div>
              {g.buckets.map((b) => (
                <div key={b.id} className="inline-bucket-line">
                  <span>{b.window === '5h' ? '5h' : 'Semanal'}</span>
                  <div className="inline-bar-track">
                    <div
                      className="inline-bar-fill"
                      style={{
                        width: `${Math.max(0, Math.min(100, b.remainingPct))}%`,
                        background:
                          b.remainingPct >= 50 ? '#10b981' : b.remainingPct >= 20 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </div>
                  <strong>{b.remainingPct.toFixed(0)}%</strong>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="inline-kpis">
        <div className="inline-kpi">
          <span>Gasto equiv.</span>
          <strong>{formatEur(kpis.totalCostEur)}</strong>
        </div>
        <div className="inline-kpi">
          <span>Caché (caliente)</span>
          <strong>{(kpis.warmCacheHitRate * 100).toFixed(1)}%</strong>
        </div>
        <div className="inline-kpi">
          <span>Ahorro caché</span>
          <strong className="text-success">{formatEur(kpis.cacheSavingsEur)}</strong>
        </div>
        <div className="inline-kpi">
          <span>Tokens</span>
          <strong>{formatCompactNumber(totalTokens)}</strong>
        </div>
      </div>

      {data.topModels.length > 0 && (
        <div className="inline-models">
          {data.topModels.slice(0, 3).map((m) => (
            <div key={m.key} className="inline-model-row">
              <span>{m.familyName}</span>
              <span>
                {formatEur(m.costEur)} ({m.sharePct.toFixed(0)}%) · {(m.globalCacheHitRate * 100).toFixed(0)}% caché
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
