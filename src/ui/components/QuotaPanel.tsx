import React, { useEffect, useState } from 'react';
import type { AlertItem, QuotaBucket, QuotaState } from '../../shared/types.js';
import { SparklineSvg } from './SvgCharts.js';

function formatCountdown(resetIso: string, nowMs: number): string {
  if (!resetIso) return '—';
  const target = Date.parse(resetIso);
  if (!Number.isFinite(target)) return '—';
  const diffSec = Math.max(0, Math.floor((target - nowMs) / 1000));
  if (diffSec === 0) return 'Reiniciando…';

  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function getBucketStatusColor(remainingPct: number): { bar: string; badge: string } {
  if (remainingPct >= 50) return { bar: '#10b981', badge: 'status-ok' };
  if (remainingPct >= 20) return { bar: '#f59e0b', badge: 'status-warn' };
  return { bar: '#ef4444', badge: 'status-danger' };
}

function BucketRow({ bucket, nowMs }: { bucket: QuotaBucket; nowMs: number }) {
  const { bar, badge } = getBucketStatusColor(bucket.remainingPct);
  const windowLabel = bucket.window === '5h' ? 'Ventana 5h' : bucket.window === 'weekly' ? 'Límite semanal' : bucket.name;

  return (
    <div className="quota-bucket">
      <div className="quota-bucket-head">
        <div>
          <span className="quota-window-label">{windowLabel}</span>
          <span className={`quota-pct-badge ${badge}`}>{bucket.remainingPct.toFixed(1)}% libre</span>
        </div>
        <div className="quota-reset">
          Reinicio en <strong>{formatCountdown(bucket.resetTime, nowMs)}</strong>
        </div>
      </div>

      <div className="quota-bar-track">
        <div
          className="quota-bar-fill"
          style={{ width: `${Math.max(0, Math.min(100, bucket.remainingPct))}%`, background: bar }}
        />
      </div>

      <div className="quota-bucket-foot">
        <span>
          {bucket.burnRatePctPerHour !== null
            ? `Ritmo: -${bucket.burnRatePctPerHour}%/h${
                bucket.estimatedHoursToEmpty !== null ? ` (~${bucket.estimatedHoursToEmpty}h restantes)` : ''
              }`
            : bucket.description}
        </span>
      </div>

      {bucket.history.length >= 2 && <SparklineSvg points={bucket.history} color={bar} />}
    </div>
  );
}

export function QuotaPanel({
  quota,
  alerts,
  refreshing,
  onRefresh,
  canOpenLinks,
  onOpenLink,
}: {
  quota: QuotaState;
  alerts: AlertItem[];
  refreshing: boolean;
  onRefresh: () => void;
  canOpenLinks: boolean;
  onOpenLink: (url: string) => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="section-block">
      {alerts.length > 0 && (
        <div className="alert-stack">
          {alerts.map((a) => (
            <div key={a.id} className={`alert-banner alert-${a.severity}`}>
              <strong>{a.title}</strong>
              <span>{a.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div className="section-header">
        <div>
          <h2>Cuota en vivo y créditos</h2>
          <p className="muted-text">
            {quota.fetchedAt
              ? `Última lectura: ${new Date(quota.fetchedAt).toLocaleString('es-ES')}${
                  quota.fromCache ? ' (caché local)' : ''
                }`
              : 'Sin lectura previa de cuota'}
            {quota.error ? ` · ${quota.error}` : ''}
          </p>
        </div>
        <div className="quota-actions">
          {quota.credits && (
            <div className="credits-pill">
              <span>AI Credits: <strong>{quota.credits.remainingCredits}</strong></span>
              {canOpenLinks && quota.credits.upgradeUri && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => onOpenLink(quota.credits!.upgradeUri!)}
                >
                  Gestionar
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? 'Actualizando…' : 'Refrescar cuota'}
          </button>
        </div>
      </div>

      {quota.groups.length === 0 ? (
        <div className="empty-card">
          <p>Aún no hay snapshot de cuota guardado. Pulsa «Refrescar cuota» para consultar `agy /usage` (0 tokens).</p>
        </div>
      ) : (
        <div className="quota-grid">
          {quota.groups.map((g) => (
            <div key={g.name} className="card quota-card">
              <div className="quota-card-title">
                <h3>{g.name}</h3>
                <span className="muted-caption">{g.description}</span>
              </div>
              <div className="quota-buckets-list">
                {g.buckets.map((b) => (
                  <BucketRow key={b.id} bucket={b} nowMs={nowMs} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
