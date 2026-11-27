# Usage Monitor para Antigravity

Plugin **MCP App** nativo para Antigravity que ofrece visibilidad completa de:

- **Cuota en vivo y AI Credits** (`5h` y límite semanal para *Gemini Models* y *Claude & GPT*) consultados con **0 tokens** mediante `agy -p /usage` y `/credits`, con cuenta atrás en vivo, captura histórica automática y cálculo de *burn rate*.
- **Gasto equivalente estimado en EUR (€)** desglosado por familia de modelo y nivel de esfuerzo (`Low`, `Medium`, `High`, `XHigh`), con tarifas USD/1M editables y tipo de cambio USD→EUR configurable.
- **Analítica de Prompt Caching**: Hit Rate global vs turnos en caliente, ahorro acumulado en EUR y detector de roturas de caché (excluyendo compactaciones `CHECKPOINT`).
- **Proyectos, Sesiones y Subagentes**: Agregación por proyecto real y rollup automático de conversaciones hijas (*subagents* / *swarms*) sobre su conversación raíz.
- **Múltiples superficies**: Barra lateral completa (`global`), panel lateral junto al chat (`aux_pane`), tarjeta inline + Markdown (`get_usage_summary`) y comando `/usage-monitor`.

## Instalación desde GitHub

```bash
agy plugin validate --strict https://github.com/Slidax/usage-monitor-agy/tree/main/plugin
agy plugin install https://github.com/Slidax/usage-monitor-agy/tree/main/plugin
```

## Desarrollo local

```bash
npm install
npm test
npm run build:plugin
npm run install:local
```
