// api/diagnostico.js
// Función serverless (Vercel) que recibe las respuestas del autodiagnóstico de JANUS,
// genera un informe individualizado con Claude y envía dos correos vía Resend:
// uno al prospecto y una copia interna a Warren.

const PERFILES = {
  'Vivo de mi red': 'El negocio genera clientes principalmente por su red: referidos, networking y eventos. Las capacidades de JANUS más relevantes son el seguimiento con fecha y alertas, el escaneo de tarjetas con IA, el formulario QR para eventos, el pipeline y las cotizaciones que se convierten en oportunidades.',
  'Vendo mi tiempo': 'El negocio vende su tiempo: cobra por hora, por sesión o por caso. Las capacidades de JANUS más relevantes son el Tiempo Facturable (registro del tiempo por cliente y por caso, y un reporte mensual en PDF por cliente que respalda cada factura), las cotizaciones y el formulario para que los clientes completen sus datos de facturación.',
  'Tengo un equipo comercial': 'El negocio vende con un equipo comercial. Las capacidades de JANUS más relevantes son JANUS for Teams (un usuario por vendedor con su propia cartera, cuotas, comisiones y análisis por vendedor, con visibilidad completa para quien dirige), el pipeline y la proyección de ingresos.',
  'Una combinación': 'El negocio combina varias formas de generar ingresos (red de contactos, venta de tiempo y/o equipo comercial). La capacidad de JANUS más relevante es el ciclo completo en un solo sistema: del primer contacto a la factura, pasando por seguimiento, cotizaciones, registro de tiempo y proyección de ingresos.'
};

function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { contacto, respuestas, puntajeTotal, puntajeMax, porcentaje, zona } = req.body;
    const focos = Array.isArray(req.body.focos) ? req.body.focos : [];
    const perfil = PERFILES[req.body.perfil] ? req.body.perfil : null;
    // Si el formulario no envía el título (versiones anteriores), se deriva de la zona.
    const titulo = req.body.titulo || tituloPorZona(zona);

    if (!contacto || !contacto.correo || !contacto.nombre || !Array.isArray(respuestas)) {
      return res.status(400).json({ error: 'Faltan datos de contacto requeridos.' });
    }

    // 1. Generar el informe individualizado con Claude
    const informe = await generarInforme({ contacto, respuestas, puntajeTotal, puntajeMax, porcentaje, zona, focos, perfil });

    // 2. Construir el HTML de los dos correos
    const datos = { contacto, informe, porcentaje, zona, titulo, focos, perfil, respuestas, puntajeTotal, puntajeMax };
    const htmlProspecto = construirEmailProspecto(datos);
    const htmlInterno = construirEmailInterno(datos);

    // 3. Enviar ambos correos vía Resend
    const fromEmail = process.env.FROM_EMAIL || 'JANUS <diagnostico@janus.money>';
    const notifyEmail = process.env.NOTIFY_EMAIL || 'info@warrenbenavides.com';

    await Promise.all([
      enviarCorreo({
        to: contacto.correo,
        from: fromEmail,
        subject: 'Tu diagnóstico de JANUS — resultado individualizado',
        html: htmlProspecto
      }),
      enviarCorreo({
        to: notifyEmail,
        from: fromEmail,
        subject: `Nuevo diagnóstico: ${contacto.nombre} (${zona})${perfil ? ' · ' + perfil : ''} — ${contacto.empresa}`,
        html: htmlInterno
      })
    ]);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Error en /api/diagnostico:', err);
    return res.status(500).json({ error: 'Error interno generando o enviando el diagnóstico.' });
  }
}

function tituloPorZona(zona) {
  const z = String(zona || '').toLowerCase();
  if (z.includes('disperso')) return 'Su gestión comercial está operando con un nivel alto de dispersión.';
  if (z.includes('transición') || z.includes('transicion')) return 'Ya dejó atrás el desorden total, pero todavía hay puntos ciegos.';
  if (z.includes('control')) return 'Su negocio tiene un nivel de control comercial superior al de la mayoría.';
  return 'Su diagnóstico comercial';
}

// ─────────────────────────────────────────────
// 1. GENERACIÓN DEL INFORME CON CLAUDE
// ─────────────────────────────────────────────
async function generarInforme({ contacto, respuestas, puntajeTotal, puntajeMax, porcentaje, zona, focos, perfil }) {
  const primerNombre = String(contacto.nombre).split(' ')[0];

  const respuestasTexto = respuestas.map(r =>
    `- [${r.categoria}] ${r.pregunta}\n  Respuesta: "${r.respuesta}" (puntaje ${r.puntaje}/3)`
  ).join('\n');

  const perfilTexto = perfil
    ? `- Cómo genera ingresos el negocio (lo eligió quien respondió): ${perfil}\n  Contexto para el párrafo 4: ${PERFILES[perfil]}`
    : '- Cómo genera ingresos el negocio: no se indicó.';

  const prompt = `Sos un estratega de negocios escribiendo un informe de diagnóstico para ${contacto.empresa}, a partir del autodiagnóstico que completó ${contacto.nombre} (${contacto.puesto}).

Este autodiagnóstico evalúa qué tanto control tiene un negocio sobre su ciclo comercial completo: desde que conoce a un contacto, pasando por el seguimiento, el pipeline y las cotizaciones, hasta el tiempo que le dedica a cada cliente, la forma en que factura y su capacidad de proyectar ingresos y crecer. Quien responde puede ser un profesional independiente (abogado, consultor, contador, coach) o el dueño o gerente de una pyme con equipo comercial.

REGLA CENTRAL DEL INFORME — LEÉ ESTO CON CUIDADO:
El diagnóstico es sobre EL NEGOCIO y sus procesos, NUNCA sobre los hábitos personales de ${contacto.nombre}. Aunque se trate de un profesional independiente, el sujeto del informe es su operación comercial: su estructura, sus procesos, su nivel de control, su dependencia de la memoria o de personas puntuales. Evitá frases dirigidas a la persona como "usted debería", "le falta disciplina" o "su memoria falla"; en su lugar, hablá de "el negocio", "la operación comercial", "el despacho" o "el equipo", según corresponda. Podés dirigirte a ${primerNombre} directamente para contextualizar (ej. "${primerNombre}, su diagnóstico muestra que la operación comercial..."), pero el diagnóstico describe brechas estructurales, no fallas personales.

DATOS DEL DIAGNÓSTICO:
- Puntaje: ${puntajeTotal}/${puntajeMax} (${porcentaje}%)
- Zona: ${zona}
- Áreas de mayor atención: ${focos.length ? focos.join(', ') : 'ninguna crítica'}
${perfilTexto}

RESPUESTAS COMPLETAS:
${respuestasTexto}

Escribí el informe en español de Costa Rica, usando "usted" al dirigirte a ${primerNombre} (nunca "tú" ni "vos"). El informe debe tener esta estructura EXACTA, en 4 párrafos separados (con línea en blanco entre cada uno):

PÁRRAFO 1: Abrí dirigiéndote a ${primerNombre} brevemente, pero pasando de inmediato a describir el patrón estructural que revelan las respuestas. Referite a detalles concretos que se dieron (ej. si las cotizaciones quedan en el correo sin seguimiento, o si el tiempo trabajado no siempre se factura), siempre como brechas de la operación, no como descuidos individuales.

PÁRRAFO 2: Explicá el RIESGO REAL de negocio que implica seguir sin estructura. Presentá exactamente TRES riesgos concretos, cada uno en su propia línea, con este formato exacto (numeración seguida de un salto de línea simple entre cada uno, todos dentro de este mismo párrafo):
1. [primer riesgo, con ejemplo concreto basado en las respuestas]
2. [segundo riesgo, con ejemplo concreto basado en las respuestas]
3. [tercer riesgo, con ejemplo concreto basado en las respuestas]
Los riesgos deben ser específicos y, cuando sea posible, medibles (tiempo, frecuencia, ingreso que se deja de cobrar), pero sin inventar cifras que las respuestas no permitan sostener y sin alarmismo.

PÁRRAFO 3: Priorizá las 2-3 áreas más débiles (${focos.join(', ') || 'las respuestas más bajas'}) y explicá qué consecuencia concreta tiene cada una para el negocio si no se soluciona en los próximos meses. Usá el MISMO formato numerado que el párrafo 2 — cada área en su propia línea (nunca "Primero/Segundo/Tercero" en prosa):
1. [primera área más débil + consecuencia concreta]
2. [segunda área más débil + consecuencia concreta]
3. [tercera área más débil + consecuencia concreta, si aplica]

PÁRRAFO 4 (aparte, como cierre, nunca combinado con el párrafo anterior): Cerrá con una nota de que este patrón es solucionable con estructura y procesos. Podés mencionar que JANUS, el Sistema Operativo Comercial para empresarios y profesionales, resuelve exactamente este tipo de brecha${perfil ? ', y conectar la solución con las capacidades más relevantes para cómo genera ingresos este negocio (según el contexto indicado arriba). Mencioná como máximo dos capacidades, en lenguaje de negocio, no como lista de funciones' : ''}.

REGLAS DE VOCABULARIO Y MARCA — OBLIGATORIAS:
- Usá "medible" (nunca "mensurable").
- Usá "solucionable" (nunca "resolvible").
- Usá "individualizado" (nunca "personalizado").
- NO CONFUNDAS DOS ENTIDADES DISTINTAS: "${contacto.empresa}" es el negocio del cliente — el que TIENE el problema y recibe este diagnóstico. "JANUS" es el nombre del producto que RESUELVE el problema. Nunca uses "${contacto.empresa}" como ejemplo de una plataforma o solución. Cuando el párrafo 4 mencione una plataforma, esa plataforma es siempre y únicamente "JANUS", en mayúsculas. Nunca inventes ni sustituyas ese nombre por ningún otro, incluido el nombre del negocio del cliente.
- No menciones precios, planes ni condiciones comerciales de JANUS.

Tono directo, profesional pero cercano, sin adornos vacíos ni frases de motivación genérica. Los párrafos 1 y 4 son texto corrido, sin viñetas ni numeración. Los párrafos 2 y 3 llevan numeración 1/2/3 como se indicó arriba.

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
      max_tokens: 1400,
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
// 2. RENDERIZADO DEL INFORME — detecta el párrafo con lista numerada (1/2/3)
// y lo convierte en una lista con estilo, en vez de texto corrido.
// ─────────────────────────────────────────────
function renderInformeHtml(informeCrudo) {
  const informe = escapeHtml(informeCrudo);
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

// ─────────────────────────────────────────────
// 3. BARRA DEL UMBRAL — misma pieza visual que en la web (tabla HTML, segura para email)
// ─────────────────────────────────────────────
function construirBarraUmbral(porcentaje, puntajeTotal, puntajeMax) {
  const pos = Math.min(96, Math.max(4, Number(porcentaje) || 0)); // margen para que el punto no se salga del borde
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
        Puntaje: <strong style="color:#FAFAF9;">${escapeHtml(puntajeTotal)} / ${escapeHtml(puntajeMax)}</strong> — ${escapeHtml(porcentaje)}%
      </td>
    </tr>
  </table>`;
}

// ─────────────────────────────────────────────
// 4. TEMPLATES DE CORREO (HTML compatible con clientes de correo)
// ─────────────────────────────────────────────
function emailShell(innerHtml) {
  return `
  <div style="background-color:#0A0A0B;padding:32px 16px;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background-color:#131315;border:1px solid #232326;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="padding:28px 32px 20px;border-bottom:1px solid #232326;">
          <span style="font-family:Arial,sans-serif;font-weight:bold;font-size:15px;color:#FAFAF9;letter-spacing:1px;">JANUS</span>
          <span style="font-family:Arial,sans-serif;font-size:11px;color:#7C7C80;letter-spacing:0.5px;"> · El Sistema Operativo Comercial</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 32px;">
          ${innerHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;border-top:1px solid #232326;font-family:Arial,sans-serif;font-size:11px;color:#7C7C80;">
          JANUS · Construido por nxt LVL · <a href="https://janus.money" style="color:#ACACB0;">janus.money</a>
        </td>
      </tr>
    </table>
  </div>`;
}

function construirEmailProspecto({ contacto, informe, porcentaje, zona, titulo, focos, puntajeTotal, puntajeMax }) {
  const barra = construirBarraUmbral(porcentaje, puntajeTotal, puntajeMax);
  const informeHtml = renderInformeHtml(informe);
  const primerNombre = escapeHtml(String(contacto.nombre).split(' ')[0]);

  const focosHtml = focos.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0F0F11;border-left:2px solid #FAFAF9;border-radius:0 4px 4px 0;margin:24px 0;">
      <tr><td style="padding:20px 24px;">
        <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin-bottom:12px;">TUS FOCOS DE ATENCIÓN PRIORITARIOS</div>
        ${focos.map((f, i) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#FAFAF9;padding:6px 0;">0${i + 1} — ${escapeHtml(f)}</div>`).join('')}
      </td></tr>
    </table>` : '';

  const waText = encodeURIComponent(`Hola, soy ${contacto.nombre} (${contacto.puesto} en ${contacto.empresa}). Acabo de recibir mi diagnóstico de JANUS (${zona}) y quiero conversar sobre mi resultado.`);

  return emailShell(`
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#ACACB0;margin:0 0 20px;">Hola ${primerNombre},</p>
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin-bottom:8px;">${escapeHtml(zona)}</div>
    <h1 style="font-family:Arial,sans-serif;font-size:24px;color:#FAFAF9;margin:0 0 20px;line-height:1.3;">${escapeHtml(titulo)}</h1>
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

function construirEmailInterno({ contacto, informe, porcentaje, zona, titulo, focos, perfil, respuestas, puntajeTotal, puntajeMax }) {
  const barra = construirBarraUmbral(porcentaje, puntajeTotal, puntajeMax);
  const informeHtml = renderInformeHtml(informe);

  const fila = (etiqueta, valor) =>
    `<tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#ACACB0;padding:4px 0;"><strong style="color:#FAFAF9;">${etiqueta}:</strong> ${escapeHtml(valor)}</td></tr>`;

  const respuestasHtml = respuestas.map(r => `
    <tr>
      <td style="padding:8px 12px;border-top:1px solid #232326;font-family:Arial,sans-serif;font-size:12px;color:#ACACB0;">${escapeHtml(r.categoria)}</td>
      <td style="padding:8px 12px;border-top:1px solid #232326;font-family:Arial,sans-serif;font-size:12px;color:#d8d8da;">${escapeHtml(r.respuesta)}</td>
      <td style="padding:8px 12px;border-top:1px solid #232326;font-family:Arial,sans-serif;font-size:12px;color:#FAFAF9;text-align:center;">${escapeHtml(r.puntaje)}/3</td>
    </tr>`).join('');

  return emailShell(`
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7C7C80;margin-bottom:8px;">Nuevo lead · Autodiagnóstico</div>
    <h1 style="font-family:Arial,sans-serif;font-size:22px;color:#FAFAF9;margin:0 0 20px;">${escapeHtml(contacto.nombre)}</h1>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      ${fila('Empresa', contacto.empresa)}
      ${fila('Puesto', contacto.puesto)}
      ${fila('Correo', contacto.correo)}
      ${fila('WhatsApp', contacto.whatsapp)}
      ${fila('Cómo genera ingresos', perfil || 'No indicado')}
      ${fila('Resultado', `${zona} — ${puntajeTotal}/${puntajeMax} (${porcentaje}%)`)}
      ${fila('Título del diagnóstico', titulo)}
      ${fila('Focos', focos.length ? focos.join(', ') : 'Ninguno crítico')}
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
// 5. ENVÍO VÍA RESEND
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
