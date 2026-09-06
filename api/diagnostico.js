// api/diagnostico.js
// Función serverless (Vercel) que recibe las respuestas del autodiagnóstico de Janus,
// genera un informe personalizado con Claude, y envía dos correos vía Resend:
// uno al prospecto, y una copia interna a Warren.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { contacto, respuestas, puntajeTotal, puntajeMax, porcentaje, zona, focos } = req.body;

    if (!contacto || !contacto.correo || !contacto.nombre) {
      return res.status(400).json({ error: 'Faltan datos de contacto requeridos.' });
    }

    // 1. Generar el informe personalizado con Claude
    const informe = await generarInforme({ contacto, respuestas, puntajeTotal, puntajeMax, porcentaje, zona, focos });

    // 2. Construir el HTML de los dos correos
    const htmlProspecto = construirEmailProspecto({ contacto, informe, porcentaje, zona, focos, puntajeTotal, puntajeMax });
    const htmlInterno = construirEmailInterno({ contacto, informe, porcentaje, zona, focos, respuestas, puntajeTotal, puntajeMax });

    // 3. Enviar ambos correos vía Resend
    const fromEmail = process.env.FROM_EMAIL || 'Janus <diagnostico@janus.money>';
    const notifyEmail = process.env.NOTIFY_EMAIL || 'info@warrenbenavides.com';

    await Promise.all([
      enviarCorreo({
        to: contacto.correo,
        from: fromEmail,
        subject: 'Tu diagnóstico de Janus — resultado personalizado',
        html: htmlProspecto
      }),
      enviarCorreo({
        to: notifyEmail,
        from: fromEmail,
        subject: `Nuevo diagnóstico: ${contacto.nombre} (${zona}) — ${contacto.empresa}`,
        html: htmlInterno
      })
    ]);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Error en /api/diagnostico:', err);
    return res.status(500).json({ error: 'Error interno generando o enviando el diagnóstico.' });
  }
}

// ─────────────────────────────────────────────
// 1. GENERACIÓN DEL INFORME CON CLAUDE
// ─────────────────────────────────────────────
async function generarInforme({ contacto, respuestas, puntajeTotal, puntajeMax, porcentaje, zona, focos }) {

  const respuestasTexto = respuestas.map(r =>
    `- [${r.categoria}] ${r.pregunta}\n  Respuesta: "${r.respuesta}" (puntaje ${r.puntaje}/3)`
  ).join('\n');

  const prompt = `Sos un estratega de negocios escribiendo un informe de diagnóstico personalizado para ${contacto.nombre}, ${contacto.puesto} en ${contacto.empresa}.

Esta persona completó un autodiagnóstico sobre cómo gestiona su red de contactos y su proceso comercial (para consultores independientes, coaches y profesionales de servicios B2B que viven del networking activo).

DATOS DEL DIAGNÓSTICO:
- Puntaje: ${puntajeTotal}/${puntajeMax} (${porcentaje}%)
- Zona: ${zona}
- Áreas de mayor atención: ${focos.length ? focos.join(', ') : 'ninguna crítica'}

RESPUESTAS COMPLETAS:
${respuestasTexto}

Escribí un informe de diagnóstico personalizado, en español de Costa Rica, usando "vos" (nunca "tú" ni "usted"). El informe debe:

1. Abrir reconociendo su situación específica según sus respuestas — no genérico, referite a detalles concretos que dio (ej. si dijo que le toma horas organizar contactos a mano, mencionalo).
2. Explicar con números y ejemplos concretos el RIESGO REAL de negocio que implica seguir así — oportunidades que se enfrían, ingreso que no se puede proyectar, contratos recurrentes que se pueden vencer sin aviso, tiempo que se pierde en tareas administrativas en vez de vender. Sé específico y honesto, no alarmista sin fundamento — basate en sus respuestas reales.
3. Priorizar sus 2-3 áreas más débiles (${focos.join(', ') || 'sus respuestas más bajas'}) y explicar qué consecuencia concreta tiene cada una si no se resuelve en los próximos meses.
4. Cerrar con una nota de que este patrón es resolvible con estructura — sin mencionar productos específicos de forma insistente, pero podés mencionar que existen herramientas como Janus (CRM ligero para consultores) que resuelven exactamente este tipo de fricción.

Extensión: 4-5 párrafos. Tono directo, profesional pero cercano, sin adornos vacíos ni frases de motivación genérica. No uses viñetas ni encabezados — es un texto corrido, como una carta personal de un estratega de negocios.

Devolvé SOLO el texto del informe, sin saludo inicial tipo "Estimado" ni firma al final.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de Claude API: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text.trim() : 'No se pudo generar el informe en este momento.';
}

// ─────────────────────────────────────────────
// 2. BARRA DEL UMBRAL — misma pieza visual que en la web (tabla HTML, segura para email)
// ─────────────────────────────────────────────
function construirBarraUmbral(porcentaje, puntajeTotal, puntajeMax) {
  const pos = Math.min(96, Math.max(4, porcentaje)); // margen para que el punto no se salga del borde
  const izquierda = pos;
  const derecha = 100 - pos;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 6px;">
    <tr>
      <td style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;padding-bottom:14px;">
        TU POSICIÓN EN LA ESCALA JANUS
      </td>
    </tr>
    <tr>
      <td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:${izquierda}%;"><div style="height:1px;line-height:1px;font-size:1px;background-color:#5A5A5E;">&nbsp;</div></td>
            <td style="width:12px;">
              <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
                <td style="width:9px;height:9px;line-height:9px;font-size:1px;background-color:#FAFAF9;border-radius:50%;">&nbsp;</td>
              </tr></table>
            </td>
            <td style="width:${derecha}%;"><div style="height:1px;line-height:1px;font-size:1px;background-color:#5A5A5E;">&nbsp;</div></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding-top:10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align:left;font-family:Arial,sans-serif;font-size:11px;color:#7C7C80;">Disperso</td>
            <td style="text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#7C7C80;">En transición</td>
            <td style="text-align:right;font-family:Arial,sans-serif;font-size:11px;color:#7C7C80;">Con control</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding-top:12px;font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;">
        Puntaje: <strong style="color:#FAFAF9;">${puntajeTotal} / ${puntajeMax}</strong> — ${porcentaje}%
      </td>
    </tr>
  </table>`;
}

// ─────────────────────────────────────────────
// 3. TEMPLATES DE CORREO (HTML compatible con clientes de correo)
// ─────────────────────────────────────────────
function emailShell(innerHtml) {
  return `
  <div style="background-color:#0A0A0B;padding:32px 16px;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background-color:#131315;border:1px solid #232326;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="padding:28px 32px 20px;border-bottom:1px solid #232326;">
          <span style="font-family:Arial,sans-serif;font-weight:bold;font-size:15px;color:#FAFAF9;letter-spacing:1px;">JANUS</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 32px;">
          ${innerHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;border-top:1px solid #232326;font-family:Arial,sans-serif;font-size:11px;color:#7C7C80;">
          Janus · Construido por nxt LVL · <a href="https://janus.money" style="color:#ACACB0;">janus.money</a>
        </td>
      </tr>
    </table>
  </div>`;
}

function construirEmailProspecto({ contacto, informe, porcentaje, zona, focos, puntajeTotal, puntajeMax }) {
  const barra = construirBarraUmbral(porcentaje, puntajeTotal, puntajeMax);
  const informeHtml = informe.split('\n\n').map(p =>
    `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#d8d8da;margin:0 0 16px;">${p}</p>`
  ).join('');

  const focosHtml = focos.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0F0F11;border-left:2px solid #FAFAF9;border-radius:0 4px 4px 0;margin:24px 0;">
      <tr><td style="padding:20px 24px;">
        <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin-bottom:12px;">TUS FOCOS DE ATENCIÓN PRIORITARIOS</div>
        ${focos.map((f,i) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#FAFAF9;padding:6px 0;">0${i+1} — ${f}</div>`).join('')}
      </td></tr>
    </table>` : '';

  const waText = encodeURIComponent(`Hola, soy ${contacto.nombre} (${contacto.puesto} en ${contacto.empresa}). Acabo de recibir mi diagnóstico de Janus (${zona}) y quiero conversar sobre mi resultado.`);

  return emailShell(`
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin-bottom:8px;">${zona}</div>
    <h1 style="font-family:Arial,sans-serif;font-size:24px;color:#FAFAF9;margin:0 0 20px;line-height:1.3;">Hola ${contacto.nombre.split(' ')[0]}, este es tu diagnóstico.</h1>
    ${barra}
    ${informeHtml}
    ${focosHtml}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr><td style="background-color:#FAFAF9;border-radius:4px;">
        <a href="https://wa.me/50688813232?text=${waText}" style="display:inline-block;padding:14px 24px;font-family:Arial,sans-serif;font-weight:bold;font-size:14px;color:#0A0A0B;text-decoration:none;">Conversar sobre mi resultado por WhatsApp →</a>
      </td></tr>
    </table>
  `);
}

function construirEmailInterno({ contacto, informe, porcentaje, zona, focos, respuestas, puntajeTotal, puntajeMax }) {
  const barra = construirBarraUmbral(porcentaje, puntajeTotal, puntajeMax);
  const informeHtml = informe.split('\n\n').map(p =>
    `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.65;color:#d8d8da;margin:0 0 14px;">${p}</p>`
  ).join('');

  const respuestasHtml = respuestas.map(r => `
    <tr>
      <td style="padding:8px 12px;border-top:1px solid #232326;font-family:Arial,sans-serif;font-size:12px;color:#ACACB0;">${r.categoria}</td>
      <td style="padding:8px 12px;border-top:1px solid #232326;font-family:Arial,sans-serif;font-size:12px;color:#d8d8da;">${r.respuesta}</td>
      <td style="padding:8px 12px;border-top:1px solid #232326;font-family:Arial,sans-serif;font-size:12px;color:#FAFAF9;text-align:center;">${r.puntaje}/3</td>
    </tr>`).join('');

  return emailShell(`
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin-bottom:8px;">Nuevo lead · Autodiagnóstico</div>
    <h1 style="font-family:Arial,sans-serif;font-size:22px;color:#FAFAF9;margin:0 0 20px;">${contacto.nombre}</h1>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;padding:4px 0;"><strong style="color:#FAFAF9;">Empresa:</strong> ${contacto.empresa}</td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;padding:4px 0;"><strong style="color:#FAFAF9;">Puesto:</strong> ${contacto.puesto}</td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;padding:4px 0;"><strong style="color:#FAFAF9;">Correo:</strong> ${contacto.correo}</td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;padding:4px 0;"><strong style="color:#FAFAF9;">WhatsApp:</strong> ${contacto.whatsapp}</td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;padding:4px 0;"><strong style="color:#FAFAF9;">Resultado:</strong> ${zona} — ${puntajeTotal}/${puntajeMax} (${porcentaje}%)</td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;padding:4px 0;"><strong style="color:#FAFAF9;">Focos:</strong> ${focos.length ? focos.join(', ') : 'Ninguno crítico'}</td></tr>
    </table>

    ${barra}

    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin:20px 0 10px;">Informe generado (el mismo que recibió el prospecto)</div>
    ${informeHtml}

    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin:20px 0 10px;">Respuestas completas</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${respuestasHtml}
    </table>
  `);
}

// ─────────────────────────────────────────────
// 4. ENVÍO VÍA RESEND
// ─────────────────────────────────────────────
async function enviarCorreo({ to, from, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({ from, to, subject, html })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de Resend enviando a ${to}: ${response.status} ${errText}`);
  }

  return response.json();
}
