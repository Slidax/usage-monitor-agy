import React, { useMemo, useState } from 'react';
import { formatCompactNumber, formatEur } from '../../shared/pricing.js';
import type { DashboardPayload, ModelAggregate } from '../../shared/types.js';
import { HorizontalModelBars } from './SvgCharts.js';

type SortKey = 'costEur' | 'turns' | 'freshInput' | 'cacheRead' | 'output' | 'globalCacheHitRate' | 'savingsEur';

export function ModelsTab({ data }: { data: DashboardPayload }) {
  const [groupBy, setGroupBy] = useState<'family' | 'exact'>('family');
  const [sortKey, setSortKey] = useState<SortKey>('costEur');
  const [sortAsc, setSortAsc] = useState(false);

  const sourceRows = groupBy === 'family' ? data.byModelFamily : data.byModelExact;

  const sortedRows = useMemo(() => {
    const copy = [...sourceRows];
    copy.sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortAsc ? diff : -diff;
    });
    return copy;
  }, [sourceRows, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <div className="tab-stack">
      <div className="card panel-card">
        <div className="card-header-row">
          <div>
            <h3>Consumo y gasto estimado por modelo</h3>
            <span className="muted-caption">
              Valores en EUR (€) calculados con las tarifas configuradas y tipo de cambio {data.config.usdToEurRate.toFixed(2)}
            </span>
          </div>
          <div className="segmented">
            <button
              type="button"
              className={groupBy === 'family' ? 'active' : ''}
              onClick={() => setGroupBy('family')}
            >
              Por familia
            </button>
            <button
              type="button"
              className={groupBy === 'exact' ? 'active' : ''}
              onClick={() => setGroupBy('exact')}
            >
              Modelo + esfuerzo
            </button>
          </div>
        </div>

        <HorizontalModelBars models={sortedRows} />
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Grupo</th>
                <th className="num" onClick={() => handleSort('turns')}>Turnos{sortIndicator('turns')}</th>
                <th className="num" onClick={() => handleSort('freshInput')}>Input fresco{sortIndicator('freshInput')}</th>
                <th className="num" onClick={() => handleSort('cacheRead')}>Caché{sortIndicator('cacheRead')}</th>
                <th className="num" onClick={() => handleSort('output')}>Salida{sortIndicator('output')}</th>
                <th className="num" onClick={() => handleSort('globalCacheHitRate')}>% Caché{sortIndicator('globalCacheHitRate')}</th>
                <th className="num">Ctx medio</th>
                <th className="num" onClick={() => handleSort('costEur')}>Gasto est.{sortIndicator('costEur')}</th>
                <th className="num" onClick={() => handleSort('savingsEur')}>Ahorro caché{sortIndicator('savingsEur')}</th>
                <th className="num">% Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty-row">
                    No hay turnos registrados con los filtros actuales.
                  </td>
                </tr>
              ) : (
                sortedRows.map((m: ModelAggregate) => (
                  <tr key={m.key}>
                    <td>
                      <div className="model-cell">
                        <strong>{m.label}</strong>
                        {m.effort && <span className="tag tag-effort">{m.effort}</span>}
                      </div>
                    </td>
                    <td><span className="tag">{m.group}</span></td>
                    <td className="num">{m.turns}</td>
                    <td className="num">{formatCompactNumber(m.freshInput)}</td>
                    <td className="num">{formatCompactNumber(m.cacheRead)}</td>
                    <td className="num">{formatCompactNumber(m.output)}</td>
                    <td className="num">{(m.globalCacheHitRate * 100).toFixed(1)}%</td>
                    <td className="num">{formatCompactNumber(m.avgContextTokens)}</td>
                    <td className="num"><strong>{formatEur(m.costEur)}</strong></td>
                    <td className="num text-success">{formatEur(m.savingsEur)}</td>
                    <td className="num">{m.sharePct.toFixed(1)}%</td>
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
