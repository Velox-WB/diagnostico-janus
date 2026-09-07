// api/diagnostico.js
// Función serverless (Vercel) que recibe las respuestas del autodiagnóstico de Janus,
// genera un informe personalizado con Claude, y envía dos correos vía Resend:
// uno al prospecto, y una copia interna a Warren.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { contacto, respuestas, puntajeTotal, puntajeMax, porcentaje, zona, titulo, focos } = req.body;

    if (!contacto || !contacto.correo || !contacto.nombre) {
      return res.status(400).json({ error: 'Faltan datos de contacto requeridos.' });
    }

    // 1. Generar el informe personalizado con Claude
    const informe = await generarInforme({ contacto, respuestas, puntajeTotal, puntajeMax, porcentaje, zona, focos });

    // 2. Construir el HTML de los dos correos
    const htmlProspecto = construirEmailProspecto({ contacto, informe, porcentaje, zona, titulo, focos, puntajeTotal, puntajeMax });
    const htmlInterno = construirEmailInterno({ contacto, informe, porcentaje, zona, titulo, focos, respuestas, puntajeTotal, puntajeMax });

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

  const prompt = `Sos un estratega de negocios escribiendo un informe de diagnóstico para la empresa ${contacto.empresa}, a partir del autodiagnóstico que completó ${contacto.nombre} (${contacto.puesto}).

Este autodiagnóstico evalúa qué tan estructurado está el proceso comercial de una empresa pequeña (Janus es una plataforma de gestión comercial multiusuario para pymes de servicios — no una herramienta para un solo consultor).

REGLA CENTRAL DEL INFORME — LEÉ ESTO CON CUIDADO:
El diagnóstico es sobre LA EMPRESA y sus procesos, NUNCA sobre los hábitos personales de ${contacto.nombre}. ${contacto.nombre} es quien respondió el formulario en representación de la empresa, pero el sujeto del informe es siempre el negocio: su estructura, su falta de procesos, su nivel de control, su dependencia de personas puntuales. Evitá frases dirigidas a la persona como "usted debería", "le falta disciplina", "su memoria falla" — en vez de eso, hablá de "la empresa", "el equipo", "la operación comercial", "el negocio". Podés dirigirte a ${contacto.nombre.split(' ')[0]} directamente para contextualizar (ej. "${contacto.nombre.split(' ')[0]}, su diagnóstico muestra que la empresa..."), pero el diagnóstico en sí describe brechas estructurales del negocio, no fallas personales.

DATOS DEL DIAGNÓSTICO:
- Puntaje: ${puntajeTotal}/${puntajeMax} (${porcentaje}%)
- Zona: ${zona}
- Áreas de mayor atención: ${focos.length ? focos.join(', ') : 'ninguna crítica'}

RESPUESTAS COMPLETAS:
${respuestasTexto}

Escribí el informe en español de Costa Rica, usando "usted" al dirigirte a ${contacto.nombre.split(' ')[0]} (nunca "tú" ni "vos"). El informe debe tener esta estructura EXACTA, en 4 párrafos separados (con línea en blanco entre cada uno):

PÁRRAFO 1: Abrí dirigiéndote a ${contacto.nombre.split(' ')[0]} brevemente, pero pasando de inmediato a describir el patrón estructural que revelan las respuestas — referite a detalles concretos que se dieron (ej. si la respuesta indica que cada persona del equipo maneja sus propios contactos, mencionalo como una brecha de la operación, no como un descuido individual).

PÁRRAFO 2: Explicá el RIESGO REAL de negocio que implica seguir sin estructura. Presentá exactamente TRES riesgos concretos, cada uno en su propia línea, con este formato exacto (numeración seguida de un salto de línea simple entre cada uno, todos dentro de este mismo párrafo):
1. [primer riesgo, con ejemplo concreto basado en las respuestas]
2. [segundo riesgo, con ejemplo concreto basado en las respuestas]
3. [tercer riesgo, con ejemplo concreto basado en las respuestas]
Los riesgos deben ser específicos y medibles cuando sea posible (montos, tiempo, frecuencia) — no alarmistas sin fundamento, basate en las respuestas reales.

PÁRRAFO 3: Priorizá las 2-3 áreas más débiles (${focos.join(', ') || 'las respuestas más bajas'}) y explicá qué consecuencia concreta tiene cada una para el negocio si no se soluciona en los próximos meses.

PÁRRAFO 4 (aparte, como cierre, nunca combinado con el párrafo anterior): Cerrá con una nota de que este patrón es solucionable con estructura y procesos. Podés mencionar que existen plataformas diseñadas específicamente para pymes de servicios, como JANUS, que resuelven exactamente este tipo de brecha operativa.

REGLAS DE VOCABULARIO Y MARCA — OBLIGATORIAS:
- Usá "medible" (nunca "mensurable").
- Usá "solucionable" (nunca "resolvible").
- NO CONFUNDAS DOS ENTIDADES DISTINTAS: "${contacto.empresa}" es la empresa del cliente — la que TIENE el problema y recibe este diagnóstico. "JANUS" es el nombre del producto/plataforma que RESUELVE el problema. Nunca uses "${contacto.empresa}" como ejemplo de una plataforma o solución — esa empresa es el sujeto del diagnóstico, no una herramienta. Cuando el párrafo 4 mencione una plataforma que resuelve este tipo de brecha, esa plataforma es siempre y únicamente "JANUS", en mayúsculas. Nunca inventes ni sustituyas ese nombre por ningún otro, incluyendo el nombre de la empresa del cliente.

Tono directo, profesional pero cercano, sin adornos vacíos ni frases de motivación genérica. No uses viñetas en los párrafos 1, 3 y 4 — son texto corrido. Solo el párrafo 2 lleva la numeración 1/2/3 como se indicó arriba.

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
// ─────────────────────────────────────────────
// RENDERIZADO DEL INFORME — detecta el párrafo con lista numerada (1/2/3)
// y lo convierte en una lista con estilo, en vez de texto corrido.
// ─────────────────────────────────────────────
function renderInformeHtml(informe) {
  const parrafos = informe.split('\n\n').filter(p => p.trim().length > 0);

  return parrafos.map((p, i) => {
    const marginTop = (i === 0) ? '24px' : '0';
    const tieneListaNumerada = /\n\s*2\.\s/.test(p) && /\n\s*3\.\s/.test(p) && /(^|\n)\s*1\.\s/.test(p);

    if (tieneListaNumerada) {
      // Todo lo que aparece antes del "1." (si existe) se trata como frase introductoria.
      const corte = p.search(/(^|\n)\s*1\.\s/);
      const intro = p.slice(0, corte).trim();
      const listaTexto = p.slice(corte).trim();

      const items = listaTexto.split(/\n(?=\s*\d\.\s)/).map(item => item.replace(/^\s*\d\.\s*/, '').trim());
      const itemsHtml = items.map((item, idx) => `
        <tr>
          <td style="width:26px;vertical-align:top;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#FAFAF9;padding:6px 8px 6px 0;">${idx + 1}.</td>
          <td style="vertical-align:top;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#d8d8da;padding:6px 0;">${item}</td>
        </tr>`).join('');

      const introHtml = intro ? `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#d8d8da;margin:${marginTop} 0 10px;">${intro}</p>` : '';
      const listMarginTop = intro ? '0' : marginTop;
      return `${introHtml}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:${listMarginTop} 0 16px;">${itemsHtml}</table>`;
    }

    return `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#d8d8da;margin:${marginTop} 0 16px;">${p}</p>`;
  }).join('');
}

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

function construirEmailProspecto({ contacto, informe, porcentaje, zona, titulo, focos, puntajeTotal, puntajeMax }) {
  const barra = construirBarraUmbral(porcentaje, puntajeTotal, puntajeMax);
  const informeHtml = renderInformeHtml(informe);

  const focosHtml = focos.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0F0F11;border-left:2px solid #FAFAF9;border-radius:0 4px 4px 0;margin:24px 0;">
      <tr><td style="padding:20px 24px;">
        <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin-bottom:12px;">TUS FOCOS DE ATENCIÓN PRIORITARIOS</div>
        ${focos.map((f,i) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#FAFAF9;padding:6px 0;">0${i+1} — ${f}</div>`).join('')}
      </td></tr>
    </table>` : '';

  const waText = encodeURIComponent(`Hola, soy ${contacto.nombre} (${contacto.puesto} en ${contacto.empresa}). Acabo de recibir mi diagnóstico de Janus (${zona}) y quiero conversar sobre mi resultado.`);

  return emailShell(`
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#ACACB0;margin:0 0 20px;">Hola ${contacto.nombre.split(' ')[0]},</p>
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin-bottom:8px;">${zona}</div>
    <h1 style="font-family:Arial,sans-serif;font-size:24px;color:#FAFAF9;margin:0 0 20px;line-height:1.3;">${titulo}</h1>
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

function construirEmailInterno({ contacto, informe, porcentaje, zona, titulo, focos, respuestas, puntajeTotal, puntajeMax }) {
  const barra = construirBarraUmbral(porcentaje, puntajeTotal, puntajeMax);
  const informeHtml = renderInformeHtml(informe);

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
      <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;padding:4px 0;"><strong style="color:#FAFAF9;">Título del diagnóstico:</strong> ${titulo}</td></tr>
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
