import React, { useMemo, useState } from 'react';
import { formatCompactNumber, formatEur } from '../../shared/pricing.js';
import type { DashboardPayload, SessionRow } from '../../shared/types.js';

type SessionSortKey = 'lastActivity' | 'costEur' | 'turns' | 'cacheHitRate' | 'peakContextPct';

export function SessionsTab({ data }: { data: DashboardPayload }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SessionSortKey>('lastActivity');
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data.sessions.filter((s) => {
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.projectName.toLowerCase().includes(q) ||
        s.models.some((m) => m.toLowerCase().includes(q))
      );
    });

    list.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'lastActivity') {
        diff = Date.parse(a.lastActivity) - Date.parse(b.lastActivity);
      } else {
        diff = a[sortKey] - b[sortKey];
      }
      return sortAsc ? diff : -diff;
    });
    return list;
  }, [data.sessions, query, sortKey, sortAsc]);

  const handleSort = (key: SessionSortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const sortArrow = (key: SessionSortKey) => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '');

  return (
    <div className="tab-stack">
      <div className="card table-card">
        <div className="card-header-row table-header-pad">
          <div>
            <h3>Resumen por proyecto</h3>
            <span className="muted-caption">
              Incluye consumo combinado de conversaciones principales y sus subagentes / swarms
            </span>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Proyecto</th>
                <th className="num">Sesiones</th>
                <th className="num">Subagentes</th>
                <th className="num">Turnos</th>
                <th className="num">Input fresco</th>
                <th className="num">Caché</th>
                <th className="num">% Caché</th>
                <th className="num">Gasto est.</th>
                <th className="num">Ahorro caché</th>
                <th className="num">% Total</th>
              </tr>
            </thead>
            <tbody>
              {data.byProject.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-row">Sin proyectos con actividad en este periodo.</td>
                </tr>
              ) : (
                data.byProject.map((p) => (
                  <tr key={p.projectId}>
                    <td><strong>{p.projectName}</strong></td>
                    <td className="num">{p.conversations}</td>
                    <td className="num">{p.subagents}</td>
                    <td className="num">{p.turns}</td>
                    <td className="num">{formatCompactNumber(p.freshInput)}</td>
                    <td className="num">{formatCompactNumber(p.cacheRead)}</td>
                    <td className="num">{(p.cacheHitRate * 100).toFixed(1)}%</td>
                    <td className="num"><strong>{formatEur(p.costEur)}</strong></td>
                    <td className="num text-success">{formatEur(p.savingsEur)}</td>
                    <td className="num">{p.sharePct.toFixed(1)}%</td>
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
            <h3>Conversaciones recientes ({filteredSessions.length})</h3>
            <span className="muted-caption">Pulsa en el badge de subagentes para desglosar su gasto</span>
          </div>
          <input
            type="search"
            className="search-input"
            placeholder="Buscar sesión, proyecto o modelo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Conversación</th>
                <th>Proyecto</th>
                <th>Superficie</th>
                <th>Modelos</th>
                <th className="num" onClick={() => handleSort('turns')}>Turnos{sortArrow('turns')}</th>
                <th className="num" onClick={() => handleSort('peakContextPct')}>Ctx pico{sortArrow('peakContextPct')}</th>
                <th className="num" onClick={() => handleSort('cacheHitRate')}>% Caché{sortArrow('cacheHitRate')}</th>
                <th className="num" onClick={() => handleSort('costEur')}>Gasto est.{sortArrow('costEur')}</th>
                <th className="num" onClick={() => handleSort('lastActivity')}>Actividad{sortArrow('lastActivity')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-row">No hay sesiones que coincidan con el filtro.</td>
                </tr>
              ) : (
                filteredSessions.map((s: SessionRow) => {
                  const isExpanded = Boolean(expanded[s.id]);
                  return (
                    <React.Fragment key={s.id}>
                      <tr>
                        <td>
                          <div className="session-title-cell">
                            <span className="session-title" title={s.title}>{s.title}</span>
                            {s.subagentCount > 0 && (
                              <button
                                type="button"
                                className="subagent-badge"
                                onClick={() => toggleExpand(s.id)}
                                title="Ver desglose de subagentes"
                              >
                                {isExpanded ? '▾' : '▸'} {s.subagentCount} subagente{s.subagentCount > 1 ? 's' : ''} ({formatEur(s.subagentCostEur)})
                              </button>
                            )}
                          </div>
                        </td>
                        <td><span className="tag">{s.projectName}</span></td>
                        <td><span className="tag tag-surface">{s.surface.toUpperCase()}</span></td>
                        <td>
                          <div className="model-tags">
                            {s.models.slice(0, 2).map((m) => (
                              <span key={m} className="tag">{m}</span>
                            ))}
                            {s.models.length > 2 && <span className="tag">+{s.models.length - 2}</span>}
                          </div>
                        </td>
                        <td className="num">{s.turns}</td>
                        <td className="num">
                          <span className={s.peakContextPct >= 75 ? 'text-warn' : ''}>
                            {s.peakContextPct.toFixed(0)}%
                          </span>
                          <small className="muted-inline"> ({formatCompactNumber(s.peakContextTokens)})</small>
                        </td>
                        <td className="num">{(s.cacheHitRate * 100).toFixed(1)}%</td>
                        <td className="num"><strong>{formatEur(s.costEur)}</strong></td>
                        <td className="num muted-cell">{new Date(s.lastActivity).toLocaleDateString('es-ES')}</td>
                      </tr>
                      {isExpanded &&
                        s.subagents.map((sub) => (
                          <tr key={sub.id} className="subagent-row">
                            <td colSpan={3}>
                              <div className="subagent-indent">
                                ↳ <strong>{sub.agentName}</strong> · <span>{sub.title}</span>
                              </div>
                            </td>
                            <td>
                              <span className="tag">{sub.models.join(', ') || '—'}</span>
                            </td>
                            <td className="num">{sub.turns}</td>
                            <td className="num">—</td>
                            <td className="num">{(sub.cacheHitRate * 100).toFixed(1)}%</td>
                            <td className="num">{formatEur(sub.costEur)}</td>
                            <td className="num text-success">{formatEur(sub.savingsEur)}</td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
