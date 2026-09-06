# Autodiagnóstico Janus — Guía de despliegue

Misma arquitectura que ya usás en el diagnóstico de nxt LVL y Mi ERM: **Vercel + Claude + Resend**,
sin base de datos ni servidor propio que mantener.

## 1. Estructura de carpetas

Subí estos archivos a un repositorio de GitHub con esta estructura exacta:

```
/
├── index.html              → el autodiagnóstico completo (front-end)
├── api/
│   └── diagnostico.js      → la función serverless (genera el informe + envía los correos)
├── package.json
└── .env.example            → solo de referencia, no se sube con valores reales
```

## 2. Conectar el repositorio a Vercel

1. Entrá a [vercel.com](https://vercel.com) → **Add New → Project**.
2. Seleccioná el repositorio.
3. Framework Preset: **Other** (no es Next.js, es HTML estático + una función serverless).
4. Vercel detecta automáticamente cualquier archivo dentro de `/api` como una función serverless — no requiere configuración adicional.

## 3. Variables de entorno

En **Project Settings → Environment Variables**, agregá:

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | Tu API key de Anthropic (console.anthropic.com) |
| `RESEND_API_KEY` | Tu API key de Resend (resend.com) |
| `NOTIFY_EMAIL` | `info@warrenbenavides.com` |
| `FROM_EMAIL` | `Janus <diagnostico@janus.money>` (ver paso 4) |

## 4. Verificar el dominio de envío en Resend

Resend exige verificar el dominio desde el que se envían los correos (no podés enviar
desde `@janus.money` hasta que Resend confirme que sos dueño del dominio vía registros DNS).

1. En Resend → **Domains → Add Domain** → `janus.money`.
2. Agregá los registros DNS (TXT/MX/CNAME) que Resend te indique, en GoDaddy.
3. Esperá la verificación (usualmente minutos, a veces unas horas).
4. Mientras tanto, podés probar con el dominio de pruebas que Resend da por defecto
   (`onboarding@resend.dev`) cambiando `FROM_EMAIL` temporalmente.

## 5. Probar de principio a fin

1. Una vez desplegado, Vercel te da una URL tipo `janus-autodiagnostico.vercel.app`.
2. Completá el autodiagnóstico completo con un correo real tuyo.
3. En pantalla deberías ver el resultado inmediatamente (esto no depende del backend).
4. Unos segundos después deberían llegarte **dos correos**: uno como si fueras el
   prospecto (con el informe y el gráfico de riesgo), y la copia interna en
   `info@warrenbenavides.com` (con los mismos datos + las 8 respuestas completas).
5. Si algo falla, revisá **Vercel → Deployments → [el deployment] → Functions → diagnostico**
   para ver el log del error exacto — el error más común al inicio es el dominio de
   Resend sin verificar todavía.

## 6. Conectar el dominio final

Cuando quieras publicarlo en `diagnostico.janus.money`:
1. En Vercel → **Project Settings → Domains** → agregá `diagnostico.janus.money`.
2. Vercel te da un registro CNAME — agregalo en GoDaddy, en la zona DNS de `janus.money`.
3. Esperá la propagación (usualmente minutos).

## Notas sobre el informe generado por IA

- La función usa `claude-haiku-4-5-20251001` — rápido y económico, el mismo criterio
  que ya aplicás en los otros diagnósticos.
- El informe se genera con las respuestas reales de cada persona — no es un texto
  pre-escrito. Cada informe es único, redactado según sus focos de atención específicos.
- El "gráfico de riesgo" que va en el correo está armado con una tabla HTML (no una
  imagen ni un `<canvas>`), porque muchos clientes de correo (Gmail, Outlook) bloquean
  o no renderizan bien gráficos generados dinámicamente. Esta técnica es 100%
  compatible y se ve como una barra de progreso simple, en el mismo lenguaje visual
  del Umbral que ya usás en todo el ecosistema Janus.
- Si en algún momento querés un análisis con más profundidad y no te importa el
  costo/latencia extra, cambiá el valor de `model` en `api/diagnostico.js` por un
  modelo Sonnet.

## Qué pasa si el envío de correo falla

El resultado en pantalla **nunca depende de que el correo se envíe correctamente** —
la persona siempre ve su zona, puntaje y focos de atención de inmediato, calculados
en el navegador. Si el correo falla (por ejemplo, el dominio de Resend no está
verificado todavía), el mensaje en pantalla cambia a avisarle que hubo un problema
y que te escriba por WhatsApp — nunca se queda esperando sin respuesta.

## Extensión futura sugerida: registro en Google Sheets

Hoy cada lead solo queda en los dos correos. Si querés además un registro consultable
(como ya tenés en nxt LVL), se puede agregar un tercer paso en `api/diagnostico.js` que
haga un `fetch` a un Google Apps Script Web App y agregue una fila por cada diagnóstico
completado. No está incluido en esta versión — avisame si lo querés y lo sumamos.
