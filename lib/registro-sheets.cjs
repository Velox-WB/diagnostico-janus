const { createSign, randomUUID } = require('node:crypto');

const encabezados = [
  'Fecha UTC', 'ID', 'Nombre', 'Empresa', 'Puesto', 'Correo', 'WhatsApp',
  'Perfil', 'Puntaje', 'Máximo', 'Porcentaje (0–100)', 'Zona', 'Focos',
  ...Array.from({length: 8}, (_, i) => ['Categoría','Pregunta','Respuesta','Puntaje'].map(k => `${k} ${i+1}`)).flat()
];

async function registrarDiagnostico({contacto, perfil, puntajeTotal, puntajeMax, porcentaje, zona, focos, respuestas}) {
  const id = process.env.SHEETS_SPREADSHEET_ID;
  if (!id) return;
  try {
    const email = process.env.SHEETS_CLIENT_EMAIL;
    const key = process.env.SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!email || !key) throw new Error('configuración incompleta');
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const codificar = v => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now()/1000);
    const jwt = codificar({alg:'RS256', typ:'JWT'})+'.'+codificar({
      iss:email, scope:'https://www.googleapis.com/auth/spreadsheets', aud:tokenUrl, iat:now, exp:now+300
    });
    const assertion = jwt+'.'+createSign('RSA-SHA256').update(jwt).sign(key,'base64url');
    const signal = AbortSignal.timeout(3500);
    const auth = await fetch(tokenUrl,{method:'POST',signal,body:new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion
    })});
    if (!auth.ok) throw new Error('autenticación HTTP '+auth.status);
    const {access_token} = await auth.json();
    if (!access_token) throw new Error('sin token');
    const val = value => typeof value === 'number' && Number.isFinite(value) ? value : String(value ?? '').slice(0,2000);
    const row = [
      new Date().toISOString(),randomUUID(),contacto.nombre,contacto.empresa,contacto.puesto,contacto.correo,contacto.whatsapp,
      perfil,puntajeTotal,puntajeMax,porcentaje,zona,focos.slice(0,3).join(' · '),
      ...Array.from({length:8},(_,i)=>{ const r=respuestas[i] || {}; return [r.categoria,r.pregunta,r.respuesta,r.puntaje]; }).flat()
    ].map(val);
    const url = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(id)+'/values/'+encodeURIComponent("'Diagnósticos'!A:AS")+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    const result = await fetch(url,{method:'POST',signal,headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json'},body:JSON.stringify({values:[row]})});
    if (!result.ok) throw new Error('escritura HTTP '+result.status);
  } catch (err) {
    // No incluyas respuestas, datos personales, claves ni cuerpos de respuesta en los logs.
    console.error('Registro JANUS en Sheets no completado:', /^(configuración incompleta|autenticación HTTP \d+|escritura HTTP \d+|sin token)$/.test(err.message) ? err.message : 'fallo de conexión o configuración');
  }
}

module.exports = { registrarDiagnostico };
