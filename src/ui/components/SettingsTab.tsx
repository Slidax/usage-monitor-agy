import React, { useEffect, useState } from 'react';
import type { DashboardPayload, ModelPricingUsd, PluginConfig } from '../../shared/types.js';

export function SettingsTab({
  data,
  saving,
  onSave,
  onResetDefaults,
}: {
  data: DashboardPayload;
  saving: boolean;
  onSave: (nextConfig: PluginConfig) => Promise<void>;
  onResetDefaults: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<PluginConfig>(() => structuredClone(data.config));
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setDraft(structuredClone(data.config));
  }, [data.config]);

  const updateRate = (key: string, field: keyof Pick<ModelPricingUsd, 'input' | 'cacheRead' | 'output'>, raw: string) => {
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) return;
    setDraft((prev) => ({
      ...prev,
      pricingUsd: {
        ...prev.pricingUsd,
        [key]: {
          ...prev.pricingUsd[key],
          [field]: val,
        },
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(draft);
    setSavedNotice('Configuración guardada y métricas recalculadas en EUR.');
    setTimeout(() => setSavedNotice(null), 3500);
  };

  return (
    <form className="tab-stack" onSubmit={handleSubmit}>
      <div className="card panel-card">
        <div className="card-header-row">
          <div>
            <h3>Parámetros generales, alertas y tipo de cambio</h3>
            <span className="muted-caption">
              Todos los importes del dashboard se muestran exclusivamente en EUR (€) aplicando el tipo de cambio indicado.
            </span>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={async () => {
                await onResetDefaults();
                setSavedNotice('Tarifas restauradas a valores predeterminados.');
                setTimeout(() => setSavedNotice(null), 3500);
              }}
            >
              Restaurar predeterminados
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>

        {savedNotice && <div className="alert-banner alert-info">{savedNotice}</div>}

        <div className="settings-grid">
          <label className="field-box">
            <span>Tipo de cambio USD → EUR</span>
            <input
              type="number"
              step="0.01"
              min="0.1"
              value={draft.usdToEurRate}
              onChange={(e) => setDraft({ ...draft, usdToEurRate: Number(e.target.value) || 0.92 })}
            />
          </label>

          <label className="field-box">
            <span>Captura automática de cuota</span>
            <select
              value={draft.autoSnapshotMinutes}
              onChange={(e) => setDraft({ ...draft, autoSnapshotMinutes: Number(e.target.value) })}
            >
              <option value={0}>Desactivada (solo al abrir / manual)</option>
              <option value={5}>Cada 5 minutos</option>
              <option value={15}>Cada 15 minutos (recomendado)</option>
              <option value={30}>Cada 30 minutos</option>
              <option value={60}>Cada 60 minutos</option>
            </select>
          </label>

          <label className="field-box">
            <span>Alerta cuota 5h ≤ (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              value={draft.alerts.quota5hWarnPct}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  alerts: { ...draft.alerts, quota5hWarnPct: Number(e.target.value) || 0 },
                })
              }
            />
          </label>

          <label className="field-box">
            <span>Alerta cuota semanal ≤ (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              value={draft.alerts.quotaWeeklyWarnPct}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  alerts: { ...draft.alerts, quotaWeeklyWarnPct: Number(e.target.value) || 0 },
                })
              }
            />
          </label>

          <label className="field-box">
            <span>Presupuesto semanal alerta (€) (0 = desactivado)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={draft.alerts.weeklyBudgetEur}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  alerts: { ...draft.alerts, weeklyBudgetEur: Number(e.target.value) || 0 },
                })
              }
            />
          </label>
        </div>
      </div>

      <div className="card table-card">
        <div className="card-header-row table-header-pad">
          <div>
            <h3>Tarifas base por modelo (USD por 1M tokens)</h3>
            <span className="muted-caption">
              Precios de lista estándar en USD; se multiplican por {draft.usdToEurRate.toFixed(2)} para mostrar EUR.
            </span>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Grupo</th>
                <th className="num">Input fresco ($/1M)</th>
                <th className="num">Cache Read ($/1M)</th>
                <th className="num">Output ($/1M)</th>
                <th className="num">Ventana ctx</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(draft.pricingUsd).map((p) => (
                <tr key={p.familyKey}>
                  <td><strong>{p.displayName}</strong></td>
                  <td><span className="tag">{p.group}</span></td>
                  <td className="num">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="rate-input"
                      value={p.input}
                      onChange={(e) => updateRate(p.familyKey, 'input', e.target.value)}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      step="0.005"
                      min="0"
                      className="rate-input"
                      value={p.cacheRead}
                      onChange={(e) => updateRate(p.familyKey, 'cacheRead', e.target.value)}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="rate-input"
                      value={p.output}
                      onChange={(e) => updateRate(p.familyKey, 'output', e.target.value)}
                    />
                  </td>
                  <td className="num">{Math.round(p.contextWindow / 1024)}K</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card panel-card">
        <h3>Diagnóstico de fuentes locales</h3>
        <div className="diag-grid">
          <div><strong>Transcripciones App:</strong> {data.diagnostics.transcriptCounts.app}</div>
          <div><strong>Transcripciones CLI:</strong> {data.diagnostics.transcriptCounts.cli}</div>
          <div><strong>Transcripciones IDE:</strong> {data.diagnostics.transcriptCounts.ide}</div>
          <div><strong>Turnos indexados:</strong> {data.diagnostics.totalIndexedTurns}</div>
          <div><strong>Cache hits / re-parseados:</strong> {data.diagnostics.indexCacheHitCount} / {data.diagnostics.indexReparsedCount}</div>
          <div><strong>Proyectos mapeados:</strong> {data.diagnostics.projectsMapped}</div>
          <div><strong>SQLite solo lectura:</strong> {data.diagnostics.sqliteAvailable ? `Activo (${data.diagnostics.sqliteLoadedSurfaces.join(', ') || 'ninguno'})` : 'No disponible'}</div>
          <div><strong>Snapshots de cuota:</strong> {data.quota.historyCount}</div>
        </div>
      </div>
    </form>
  );
}
