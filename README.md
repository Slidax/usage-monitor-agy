# Usage Monitor para Antigravity (`usage-monitor-agy`)

Extensión / plugin **MCP App** para Google Antigravity con panel interactivo en barra lateral (`global`), panel lateral (`aux_pane`), tarjeta inline en chat (`get_usage_summary`) y comando `/usage-monitor`.

## Qué muestra

- **Cuota real en vivo y AI Credits** (`agy -p /usage` y `/credits`, **0 tokens consumidos**): porcentaje restante en ventanas de `5h` y semanal por grupo (*Gemini Models* y *Claude & GPT*), cuenta atrás en tiempo real, historial local y *burn rate*.
- **Gasto equivalente estimado en EUR (€)** por familia de modelo y nivel de esfuerzo (`Low`, `Medium`, `High`, `XHigh`), con tarifas base USD/1M editables y tipo de cambio USD→EUR configurable en **Ajustes**.
- **Nivel de caché y ahorro**: *Cache Hit Rate* global vs en caliente (excluyendo el primer turno), ahorro estimado en EUR y **detector de roturas de caché** (excluyendo compactions `CHECKPOINT`).
- **Proyectos, sesiones y subagentes**: lectura de transcripciones de Antigravity App, CLI e IDE enriquecidas con nombres reales de proyectos y rollup automático de subagentes / swarms.
- **Exportación y contexto**: descarga o copia de reportes CSV/JSON y botón **Adjuntar contexto al chat** en el panel lateral.

## Instalación directa en Antigravity

El plugin listo para instalar se encuentra en [`./plugin`](./plugin):

```bash
agy plugin validate --strict https://github.com/Slidax/usage-monitor-agy/tree/main/plugin
agy plugin install https://github.com/Slidax/usage-monitor-agy/tree/main/plugin
```

## Desarrollo y compilación local

```bash
npm install
npm run typecheck
npm test
npm run build:plugin
npm run install:local
agy plugin validate --strict ./plugin
```
