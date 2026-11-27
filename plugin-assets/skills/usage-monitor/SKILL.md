---
name: usage-monitor
description: >-
  Consulta cuotas en vivo (5h y semanal), créditos de IA, gasto estimado en EUR
  por modelo y esfuerzo, nivel de caché (ahorro y roturas), proyectos y
  subagentes en Antigravity. Úsalo cuando el usuario pida ver su cuota, uso,
  tokens, caché o costes.
---

# Usage Monitor

Plugin MCP App de telemetría local y cuota en vivo para Antigravity.

## Herramientas disponibles

- `open_usage_dashboard`: Abre el dashboard interactivo completo en el panel lateral (`aux_pane`) o en la barra lateral (`global`). Úsalo cuando el usuario pida abrir el panel, explorar gráficas, revisar proyectos/sesiones o ajustar tarifas.
- `get_usage_summary`: Renderiza una tarjeta compacta inline en el chat (y devuelve un resumen Markdown completo para Antigravity CLI/IDE). Úsalo cuando el usuario pregunte por un resumen rápido de cuota, caché o gasto en EUR.

## Parámetros opcionales

Ambas herramientas aceptan de forma opcional:
- `period`: `"5h"` | `"24h"` | `"7d"` (por defecto) | `"30d"` | `"all"`
- `projectId`: ID del proyecto o `"all"`
- `surface`: `"all"` | `"app"` | `"cli"` | `"ide"`
- `includeLegacy`: `true` | `false` (por defecto)
