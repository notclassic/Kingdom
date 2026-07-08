/*
 * kingdom-telegram-webhook.mjs
 * ---------------------------------------------------------------------------
 * Recibe los mensajes de Telegram por WEBHOOK en el Worker de Cloudflare:
 * los botones responden en ~1 segundo, sin cron, sin offset, sin cola.
 *
 * Reemplaza a bot_audio.js (el cron de GitHub Actions). bot_notificaciones.js
 * NO se toca: sigue en su cron mandando las alertas de vencimiento.
 *
 * Misma lógica que bot_audio.js: botones (done/posponer/selector de fecha y
 * hora), respuesta con fecha escrita, audios con "check" (AssemblyAI + Groq),
 * y guardado en GitHub con fusión ante conflictos (dashboard/MCP escribiendo
 * a la vez).
 *
 * ========================= INSTALACIÓN (paso a paso) =======================
 * 1) SECRETOS en el Worker (Cloudflare dashboard -> tu Worker "kingdom" ->
 *    Settings -> Variables and Secrets -> Add). Tipo "Secret" cada uno:
 *      TELEGRAM_TOKEN     = token del bot (el mismo que usan los bots de GitHub)
 *      TELEGRAM_CHAT_ID   = 5678544136
 *      GITHUB_TOKEN       = un Personal Access Token con permiso de contenido
 *                           sobre el repo Kingdom (puede ser el mismo PAT que
 *                           ya usás en el dashboard)
 *      ASSEMBLYAI_KEY     = tu clave de AssemblyAI
 *      GROQ_API_KEY       = tu clave de Groq
 *
 * 2) CÓDIGO: pegá TODO este archivo dentro del código de tu Worker (arriba de
 *    lo que ya tiene), y en tu manejador fetch agregá al principio:
 *
 *      const { pathname } = new URL(request.url);
 *      const tg = await handleTelegramWebhook(request, env, ctx, pathname);
 *      if (tg) return tg;
 *
 * 3) REGISTRAR EL WEBHOOK (una sola vez, desde el navegador):
 *    abrí esta URL reemplazando <TOKEN> y <SEGMENTO> por los tuyos:
 *
 *    https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://kingdom.contacto-d13.workers.dev/<SEGMENTO>/telegram&drop_pending_updates=true
 *
 *    (drop_pending_updates=true descarta taps viejos de la cola del sistema
 *    anterior, para arrancar limpio). Tiene que responder {"ok":true,...}.
 *    Para verificar: .../getWebhookInfo
 *
 * 4) APAGAR EL BOT DE AUDIO EN GITHUB: editá .github/workflows/kingdom-bot.yml
 *    y BORRÁ el paso que ejecuta `node bot_audio.js` (dejá el de
 *    bot_notificaciones.js tal cual). Esto es OBLIGATORIO: Telegram no permite
 *    webhook y getUpdates a la vez; si el cron de audio sigue, va a fallar en
 *    rojo en cada corrida.
 *
 * VOLVER ATRÁS (si algo sale mal): abrí en el navegador
 *    https://api.telegram.org/bot<TOKEN>/deleteWebhook
 * y restaurá el paso de bot_audio.js en el yml. Todo vuelve a ser como antes.
 *
 * Límite conocido: los audios muy largos (transcripciones de más de ~25 s de
 * procesamiento) pueden cortarse sin confirmación; reenviá el audio si no
 * llegó respuesta. Las notas de voz habituales entran sobradas.
 * ===========================================================================
 */

const BRANCH = 'main';
const DATA_PATH = 'data.json';
const STATE_PATH = 'tg_state.json';

// ---------- base64 UTF-8 sin Buffer (apto Workers) ----------
function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function b64dec(b64) {
  const bin = atob((b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------- contexto por request (tokens y URLs desde env) ----------
function makeCtx(env) {
  const owner = env.GITHUB_OWNER || 'notclassic';
  const repo = env.GITHUB_REPO || 'Kingdom';
  return {
    TG: 'https://api.telegram.org/bot' + env.TELEGRAM_TOKEN,
    TELEGRAM_TOKEN: env.TELEGRAM_TOKEN,
    CHAT_ID: String(env.TELEGRAM_CHAT_ID || ''),
    ASSEMBLYAI_KEY: env.ASSEMBLYAI_KEY,
    GROQ_KEY: env.GROQ_API_KEY,
    GH_HEADERS: {
      authorization: 'Bearer ' + env.GITHUB_TOKEN,
      accept: 'application/vnd.github+json',
      'user-agent': 'kingdom-worker'
    },
    ghUrl: (path) => 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path
  };
}

// ---------- GitHub: leer/escribir JSON con fusión ante conflictos ----------
async function getJsonFile(C, path, fallback) {
  const r = await fetch(C.ghUrl(path) + '?ref=' + BRANCH, { headers: C.GH_HEADERS });
  if (!r.ok) return { data: fallback, sha: null };
  const j = await r.json();
  return { data: JSON.parse(b64dec(j.content)), sha: j.sha };
}

async function putJsonFile(C, path, data, sha, message) {
  const body = { message: message, content: b64enc(JSON.stringify(data, null, 2)), branch: BRANCH };
  if (sha) body.sha = sha;
  return fetch(C.ghUrl(path), {
    method: 'PUT',
    headers: { ...C.GH_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// data.json: si otro (dashboard/MCP) escribió en el medio, releer y volcar
// SOLO lo que este update cambió. Si tocaron la misma tarea, gana el botón.
async function putDataConReintento(C, dataLocal, sha, snapshotJson, message) {
  let r = await putJsonFile(C, DATA_PATH, dataLocal, sha, message);
  for (let intento = 0; (r.status === 409 || r.status === 422) && intento < 2; intento++) {
    const orig = JSON.parse(snapshotJson);
    const fresco = await getJsonFile(C, DATA_PATH, null);
    if (!fresco.data) return r;

    const origPorId = {};
    (orig.tasks || []).forEach(t => { origPorId[t.id] = JSON.stringify(t); });
    const nuestras = (dataLocal.tasks || []).filter(t => origPorId[t.id] !== JSON.stringify(t));

    fresco.data.tasks = fresco.data.tasks || [];
    const idx = {};
    fresco.data.tasks.forEach((t, i) => { idx[t.id] = i; });
    nuestras.forEach(t => { if (idx[t.id] != null) fresco.data.tasks[idx[t.id]] = t; else fresco.data.tasks.push(t); });

    const origProj = new Set((orig.projects || []).map(p => p.id));
    fresco.data.projects = fresco.data.projects || [];
    (dataLocal.projects || []).forEach(p => {
      if (!origProj.has(p.id) && !fresco.data.projects.some(x => x.id === p.id)) fresco.data.projects.push(p);
    });

    r = await putJsonFile(C, DATA_PATH, fresco.data, fresco.sha, message + ' (merge por conflicto)');
  }
  return r;
}

// tg_state.json: puede chocar con bot_notificaciones (sigue en cron). Fusionar.
async function putStateConReintento(C, state, sha, message) {
  let r = await putJsonFile(C, STATE_PATH, state, sha, message);
  for (let intento = 0; (r.status === 409 || r.status === 422) && intento < 2; intento++) {
    const fresco = await getJsonFile(C, STATE_PATH, {});
    const remoto = fresco.data || {};
    const merged = {
      ...remoto, ...state,
      dueAlerted: { ...(remoto.dueAlerted || {}), ...(state.dueAlerted || {}) },
      doneAlerted: { ...(remoto.doneAlerted || {}), ...(state.doneAlerted || {}) },
      alertMsgs: { ...(remoto.alertMsgs || {}), ...(state.alertMsgs || {}) }
    };
    r = await putJsonFile(C, STATE_PATH, merged, fresco.sha, message + ' (merge por conflicto)');
  }
  return r;
}

// ---------- Telegram ----------
async function sendMsg(C, text) {
  await fetch(C.TG + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: C.CHAT_ID, text: text })
  });
}
async function answerCallback(C, id, text) {
  await fetch(C.TG + '/answerCallbackQuery', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text: text || '' })
  });
}
async function editMessage(C, chatId, messageId, text) {
  await fetch(C.TG + '/editMessageText', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text, reply_markup: { inline_keyboard: [] } })
  });
}
async function editKeyboard(C, chatId, messageId, replyMarkup) {
  await fetch(C.TG + '/editMessageReplyMarkup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
  });
}
async function editTextWithKeyboard(C, chatId, messageId, text, replyMarkup) {
  await fetch(C.TG + '/editMessageText', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text, reply_markup: replyMarkup })
  });
}
async function getVoiceUrl(C, fileId) {
  const r = await fetch(C.TG + '/getFile?file_id=' + fileId);
  const j = await r.json();
  if (!j.ok) throw new Error('No pude obtener el archivo de Telegram');
  return 'https://api.telegram.org/file/bot' + C.TELEGRAM_TOKEN + '/' + j.result.file_path;
}

// ---------- transcripción (AssemblyAI) ----------
async function transcribe(C, audioUrl) {
  const submit = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: C.ASSEMBLYAI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl, language_code: 'es' })
  });
  const data = await submit.json();
  // menos intentos que en el cron: el Worker tiene ventana acotada tras responder
  let attempts = 0;
  while (attempts < 10) {
    const poll = await fetch('https://api.assemblyai.com/v2/transcript/' + data.id, { headers: { authorization: C.ASSEMBLYAI_KEY } });
    const t = await poll.json();
    if (t.status === 'completed') return t.text;
    if (t.status === 'error') throw new Error('Error en AssemblyAI: ' + t.error);
    await new Promise(res => setTimeout(res, 2500));
    attempts++;
  }
  throw new Error('La transcripción tardó demasiado; probá con un audio más corto.');
}

// ---------- fechas ----------
function hoyEnChile() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}
function diaSemanaEnChile() {
  return new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', weekday: 'long' });
}
function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
function validarFecha(fecha, hoy) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return '';
  const diff = (new Date(fecha + 'T12:00:00') - new Date(hoy + 'T12:00:00')) / 86400000;
  return (diff >= -1 && diff <= 365) ? fecha : '';
}
function validarHora(hora) {
  return (typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) ? hora : '';
}
function sumarDias(dueDate, dias) {
  let d;
  if (dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    const p = dueDate.split('-');
    d = new Date(p[0], p[1] - 1, p[2]);
  } else {
    d = new Date(hoyEnChile() + 'T00:00:00');
  }
  d.setDate(d.getDate() + dias);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function escalonDeFecha(dueDate) {
  const hoyStr = hoyEnChile();
  const diff = Math.round((new Date(dueDate + 'T00:00:00') - new Date(hoyStr + 'T00:00:00')) / 86400000);
  return diff < 0 ? 3 : diff === 0 ? 2 : diff === 1 ? 1 : 0;
}
function hoyChileDate() { return new Date(hoyEnChile() + 'T12:00:00'); }
function fmtYMD(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function etiquetaDia(d) {
  const w = d.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '');
  return w.charAt(0).toUpperCase() + w.slice(1) + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
}

// ---------- teclados ----------
function taskKeyboard(taskId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ya está', callback_data: 'done_' + taskId },
        { text: '📅 +1 día', callback_data: 'postpone1_' + taskId },
        { text: '📅 +1 sem', callback_data: 'postpone7_' + taskId }
      ],
      [{ text: '📅 Elegir fecha y hora', callback_data: 'pickdate_' + taskId }]
    ]
  };
}
function dateKeyboard(taskId) {
  const hoy = hoyChileDate();
  const plus = n => { const d = new Date(hoy); d.setDate(d.getDate() + n); return d; };
  const btn = (text, d) => ({ text, callback_data: 'pdD|' + taskId + '|' + fmtYMD(d) });
  return {
    inline_keyboard: [
      [btn('Hoy', plus(0)), btn('Mañana', plus(1)), btn('Pasado', plus(2))],
      [btn(etiquetaDia(plus(3)), plus(3)), btn(etiquetaDia(plus(4)), plus(4)), btn(etiquetaDia(plus(5)), plus(5))],
      [btn('+1 sem', plus(7)), btn('+2 sem', plus(14)), btn('+1 mes', plus(30))],
      [{ text: '✍️ Otra fecha (respondé con texto)', callback_data: 'picktext_' + taskId }],
      [{ text: '← Volver', callback_data: 'pdB|' + taskId }]
    ]
  };
}
function timeKeyboard(taskId, fecha) {
  const btn = (text, hora) => ({ text, callback_data: 'pdT|' + taskId + '|' + fecha + '|' + hora });
  return {
    inline_keyboard: [
      [btn('09:00', '09:00'), btn('12:00', '12:00'), btn('15:00', '15:00')],
      [btn('18:00', '18:00'), btn('20:00', '20:00'), { text: '✔️ Listo', callback_data: 'pdOK|' + taskId }]
    ]
  };
}

// ---------- fecha escrita en respuesta a una alerta ----------
function parseFechaTexto(texto) {
  const t = (texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const hoy = hoyChileDate();
  let dueTime = '';
  const mHora = t.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (mHora) {
    const h = parseInt(mHora[1], 10), min = parseInt(mHora[2], 10);
    if (h <= 23 && min <= 59) dueTime = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  }
  const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  if (/\bhoy\b/.test(t)) return { dueDate: fmt(hoy), dueTime };
  if (/\bpasado\s*manana\b/.test(t)) { const d = new Date(hoy); d.setDate(d.getDate() + 2); return { dueDate: fmt(d), dueTime }; }
  if (/\bmanana\b/.test(t)) { const d = new Date(hoy); d.setDate(d.getDate() + 1); return { dueDate: fmt(d), dueTime }; }

  const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  for (let i = 0; i < 7; i++) {
    if (new RegExp('\\b' + dias[i] + '\\b').test(t)) {
      const d = new Date(hoy);
      let delta = (i - d.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      d.setDate(d.getDate() + delta);
      return { dueDate: fmt(d), dueTime };
    }
  }

  const mFecha = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (mFecha) {
    const dd = parseInt(mFecha[1], 10), mm = parseInt(mFecha[2], 10);
    let yy = mFecha[3] ? parseInt(mFecha[3], 10) : hoy.getFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      let d = new Date(yy, mm - 1, dd, 12);
      if (d.getDate() !== dd || d.getMonth() !== mm - 1) return null;
      if (!mFecha[3] && d < hoy) d = new Date(yy + 1, mm - 1, dd, 12);
      if ((d - hoy) / 86400000 > 370) return null;
      return { dueDate: fmt(d), dueTime };
    }
  }
  return null;
}

function registrarMsgTarea(state, messageId, taskId) {
  if (!messageId) return;
  state.alertMsgs = state.alertMsgs || {};
  state.alertMsgs[messageId] = taskId;
  const keys = Object.keys(state.alertMsgs);
  if (keys.length > 150) keys.slice(0, keys.length - 150).forEach(k => delete state.alertMsgs[k]);
}

// ---------- Groq: nota de voz -> acción estructurada ----------
async function parseAudio(C, rawText, data) {
  const hoy = hoyEnChile();
  const fallback = { accion: 'tarea', text: rawText, dueDate: '', dueTime: '' };
  const mananaDate = new Date(hoy + 'T12:00:00');
  mananaDate.setDate(mananaDate.getDate() + 1);
  const manana = fmtYMD(mananaDate);
  const nombresAreas = (data.areas || []).map(a => a.name).join(', ');

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + C.GROQ_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant', temperature: 0, max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Convertís notas de voz en acciones para un gestor de tareas. Hoy es ' + diaSemanaEnChile() + ' ' + hoy + ' (zona horaria de Chile).\n' +
          'Respondé SOLO un objeto JSON.\n' +
          'Si la nota pide explícitamente CREAR UN PROYECTO (dice "crear proyecto" o "nuevo proyecto" o "agregar proyecto"):\n' +
          '{"accion":"proyecto","nombre":"...","descripcion":"..." o null,"area":"una de: ' + nombresAreas + '" o null,"tarea":"si además menciona una acción concreta a hacer" o null,"fecha":"YYYY-MM-DD si menciona fecha" o null,"hora":"HH:MM si menciona hora" o null}\n' +
          'Si pide explícitamente CREAR UN SUBPROYECTO dentro de otro proyecto (dice "crear subproyecto X en Y" o similar):\n' +
          '{"accion":"subproyecto","nombre":"...","descripcion":"..." o null,"proyecto_padre":"nombre del proyecto padre mencionado","tarea":"..." o null,"fecha":"..." o null,"hora":"..." o null}\n' +
          'En CUALQUIER otro caso es una tarea:\n' +
          '{"accion":"tarea","tarea":"texto breve, máx 20 palabras, sin explicaciones ni inventos","proyecto":"nombre del proyecto si la nota dice a qué proyecto va (ej: \'agregar tarea a Kingdom\', \'para el proyecto X\')" o null,"fecha":"YYYY-MM-DD" o null,"hora":"HH:MM" o null}\n' +
          'Reglas: "mañana" = ' + manana + '. "4 de la tarde" = "16:00". No inventes nada que no esté en la nota. Sacá del texto de la tarea las fechas/horas y el nombre del proyecto ya extraídos.\n' +
          'Ejemplo entrada: "llamar al contador mañana a las 4 de la tarde por las facturas"\n' +
          'Ejemplo salida: {"accion":"tarea","tarea":"Llamar al contador por las facturas","fecha":"' + manana + '","hora":"16:00"}' },
        { role: 'user', content: rawText }
      ]
    })
  });
  const j = await r.json();
  const out = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
  if (!out) return fallback;

  let p;
  try { p = JSON.parse(out); } catch (_) { return fallback; }

  if (p.accion === 'proyecto' && typeof p.nombre === 'string' && p.nombre.trim()) {
    return {
      accion: 'proyecto',
      nombre: p.nombre.trim().slice(0, 80),
      descripcion: (typeof p.descripcion === 'string' ? p.descripcion.trim().slice(0, 300) : ''),
      areaNombre: (typeof p.area === 'string' ? p.area.trim() : ''),
      tarea: (typeof p.tarea === 'string' ? p.tarea.trim().slice(0, 200) : ''),
      dueDate: validarFecha(p.fecha, hoy), dueTime: validarHora(p.hora)
    };
  }
  if (p.accion === 'subproyecto' && typeof p.nombre === 'string' && p.nombre.trim() && typeof p.proyecto_padre === 'string' && p.proyecto_padre.trim()) {
    return {
      accion: 'subproyecto',
      nombre: p.nombre.trim().slice(0, 80),
      descripcion: (typeof p.descripcion === 'string' ? p.descripcion.trim().slice(0, 300) : ''),
      proyectoPadre: p.proyecto_padre.trim(),
      tarea: (typeof p.tarea === 'string' ? p.tarea.trim().slice(0, 200) : ''),
      dueDate: validarFecha(p.fecha, hoy), dueTime: validarHora(p.hora)
    };
  }
  let text = (typeof p.tarea === 'string' ? p.tarea.trim() : '');
  if (!text || text.includes('\n') || text.length > rawText.length * 1.5 + 30) text = rawText;
  return {
    accion: 'tarea', text: text,
    dueDate: validarFecha(p.fecha, hoy), dueTime: validarHora(p.hora),
    proyecto: (typeof p.proyecto === 'string' ? p.proyecto.trim() : '')
  };
}

// ---------- creación de proyectos/tareas (idéntico a bot_audio) ----------
function crearProyecto(data, nombre, descripcion, areaNombre) {
  const areas = data.areas || [];
  let area = areas.find(a => normalizar(a.name) === normalizar(areaNombre));
  if (!area) area = areas.find(a => a.context === 'profesional') || areas[0];
  if (!area) return null;
  const proyecto = {
    id: 'p' + Date.now(), name: nombre, area: area.id,
    desc: descripcion || 'Creado por voz desde Telegram.', status: 'active',
    hasLeads: false, color: area.color || '#007aff', icon: '', driveUrl: '',
    driveFolderId: '', contacts: [], context: area.context || 'profesional', parentId: null
  };
  data.projects = data.projects || [];
  data.projects.push(proyecto);
  return { proyecto, areaNombre: area.name };
}

function crearSubproyecto(data, nombre, descripcion, nombrePadre) {
  const buscado = normalizar(nombrePadre);
  const candidatos = (data.projects || []).filter(p =>
    !p.parentId && p.status !== 'archived' &&
    (normalizar(p.name).includes(buscado) || buscado.includes(normalizar(p.name)))
  );
  if (candidatos.length !== 1) return { error: candidatos.length === 0 ? 'no-encontrado' : 'ambiguo', candidatos: candidatos.map(p => p.name) };
  const padre = candidatos[0];
  const sub = {
    id: 'p' + Date.now(), name: nombre, area: padre.area,
    desc: descripcion || 'Creado por voz desde Telegram.', status: 'active',
    hasLeads: false, color: padre.color || '#007aff', icon: '', driveUrl: '',
    driveFolderId: '', contacts: [], context: padre.context || 'profesional', parentId: padre.id
  };
  data.projects = data.projects || [];
  data.projects.push(sub);
  return { proyecto: sub, padre };
}

function resolverProyectoDestino(data, nombreMencionado) {
  if (!nombreMencionado) return { projectId: 'inbox', nota: '' };
  const buscado = normalizar(nombreMencionado);
  const candidatos = (data.projects || []).filter(p =>
    p.status !== 'archived' &&
    (normalizar(p.name).includes(buscado) || buscado.includes(normalizar(p.name)))
  );
  if (candidatos.length === 1) return { projectId: candidatos[0].id, nota: '📁 Proyecto: ' + candidatos[0].name };
  if (candidatos.length > 1) return { projectId: 'inbox', nota: '⚠️ "' + nombreMencionado + '" coincide con varios proyectos (' + candidatos.map(p => p.name).slice(0, 4).join(', ') + '). La dejé en Ideas — movela desde el dashboard.' };
  const res = crearProyecto(data, nombreMencionado, '', '');
  if (!res) return { projectId: 'inbox', nota: '⚠️ No pude crear el proyecto, la dejé en Ideas.' };
  return { projectId: res.proyecto.id, nota: '🆕 Proyecto NUEVO creado: ' + res.proyecto.name + ' (área ' + res.areaNombre + '). Si el nombre quedó mal transcripto, corregilo en el dashboard.', creado: true };
}

function crearTareaInicial(data, proyecto, parsed) {
  if (!parsed.tarea && !parsed.dueDate) return '';
  const texto = parsed.tarea || proyecto.name;
  data.tasks = data.tasks || [];
  data.tasks.push({
    id: 't' + Date.now(), projectId: proyecto.id, text: texto, done: false,
    dueDate: parsed.dueDate || '', dueTime: parsed.dueTime || '',
    priority: 'medium', emailAlert: false, alertSent: false, driveUrl: ''
  });
  let linea = '✅ Tarea adentro: ' + texto;
  if (parsed.dueDate) linea += '\n📅 Vence: ' + parsed.dueDate + (parsed.dueTime ? ' a las ' + parsed.dueTime : '');
  return linea;
}

// ---------- lógica de botones (idéntica a bot_audio, con contexto C) ----------
async function handleCallback(C, cb, data, state) {
  const raw = cb.data || '';

  if (raw.startsWith('pdD|') || raw.startsWith('pdT|') || raw.startsWith('pdB|') || raw.startsWith('pdOK|')) {
    const partes = raw.split('|');
    const tId = partes[1];
    const t = (data.tasks || []).find(x => x.id === tId);
    if (!t) { await answerCallback(C, cb.id, '❌ Tarea no encontrada (¿ya se borró?)'); return false; }

    if (raw.startsWith('pdB|')) {
      try { await answerCallback(C, cb.id, ''); } catch (_) {}
      if (cb.message) await editKeyboard(C, cb.message.chat.id, cb.message.message_id, taskKeyboard(tId));
      return false;
    }
    if (raw.startsWith('pdOK|')) {
      try { await answerCallback(C, cb.id, '✔️'); } catch (_) {}
      if (cb.message) await editKeyboard(C, cb.message.chat.id, cb.message.message_id, { inline_keyboard: [] });
      return false;
    }
    if (raw.startsWith('pdD|')) {
      const fecha = partes[2];
      t.dueDate = fecha;
      t.mcpUpdatedAt = new Date().toISOString();
      state.dueAlerted = state.dueAlerted || {};
      const esc = escalonDeFecha(fecha);
      if (esc > 0) state.dueAlerted[tId] = esc; else delete state.dueAlerted[tId];
      try {
        await answerCallback(C, cb.id, '📅 ' + fecha + ' guardada');
        if (cb.message) {
          await editTextWithKeyboard(C, cb.message.chat.id, cb.message.message_id,
            (cb.message.text || '') + '\n\n📅 Reprogramada: ' + t.text +
            '\nNuevo vencimiento: ' + fecha + (t.dueTime ? ' a las ' + t.dueTime + ' (hora original)' : '') +
            '\n🕐 Si querés cambiar la hora, tocá una. Si no, tocá ✔️ Listo.',
            timeKeyboard(tId, fecha));
        }
      } catch (_) {}
      return true;
    }
    // pdT: hora opcional
    const fecha = partes[2];
    const hora = (partes[3] && partes[3] !== '-') ? partes[3] : '';
    if (fecha) t.dueDate = fecha;
    if (hora) t.dueTime = hora;
    t.mcpUpdatedAt = new Date().toISOString();
    try {
      await answerCallback(C, cb.id, '🕐 ' + (hora || t.dueTime || ''));
      if (cb.message) {
        await editMessage(C, cb.message.chat.id, cb.message.message_id,
          (cb.message.text || '') + '\n\n🕐 Hora actualizada: ' + t.dueDate + (t.dueTime ? ' a las ' + t.dueTime : ''));
      }
    } catch (_) {}
    return true;
  }

  const [action, taskId] = raw.split('_');
  const task = (data.tasks || []).find(t => t.id === taskId);
  if (!task) { await answerCallback(C, cb.id, '❌ Tarea no encontrada (¿ya se borró?)'); return false; }

  let toast = '';
  let statusLine = '';
  const now = new Date().toISOString();

  if (action === 'pickdate') {
    registrarMsgTarea(state, cb.message && cb.message.message_id, taskId);
    try { await answerCallback(C, cb.id, 'Elegí la fecha'); } catch (_) {}
    if (cb.message) await editKeyboard(C, cb.message.chat.id, cb.message.message_id, dateKeyboard(taskId));
    return false;
  }
  if (action === 'picktext') {
    registrarMsgTarea(state, cb.message && cb.message.message_id, taskId);
    try { await answerCallback(C, cb.id, 'Respondé a ese mensaje con la fecha'); } catch (_) {}
    if (cb.message) {
      const yaExplicado = (cb.message.text || '').includes('Respondé a ESTE mensaje');
      if (!yaExplicado) {
        await editTextWithKeyboard(C, cb.message.chat.id, cb.message.message_id,
          (cb.message.text || '') + '\n\n✍️ Respondé a ESTE mensaje (deslizalo a la izquierda) con la nueva fecha y hora. Ejemplos: "15/07", "mañana 18:00", "viernes".',
          taskKeyboard(taskId));
      }
    }
    return false;
  }

  if (action === 'done') {
    task.done = true;
    task.mcpUpdatedAt = now;
    state.doneAlerted = state.doneAlerted || {};
    state.doneAlerted[taskId] = true;
    toast = '✅ Tarea completada';
    statusLine = '✅ Completada';
  } else if (action === 'postpone1' || action === 'postpone7') {
    const dias = action === 'postpone1' ? 1 : 7;
    task.dueDate = sumarDias(task.dueDate, dias);
    task.mcpUpdatedAt = now;
    state.dueAlerted = state.dueAlerted || {};
    const escalonNuevo = escalonDeFecha(task.dueDate);
    if (escalonNuevo > 0) state.dueAlerted[taskId] = escalonNuevo; else delete state.dueAlerted[taskId];
    toast = '📅 Pospuesta a ' + task.dueDate;
    statusLine = '📅 Pospuesta a ' + task.dueDate;
  } else {
    await answerCallback(C, cb.id, '❌ Acción no reconocida');
    return false;
  }

  try {
    await answerCallback(C, cb.id, toast);
    if (cb.message) await editMessage(C, cb.message.chat.id, cb.message.message_id, (cb.message.text || '') + '\n\n' + statusLine);
  } catch (_) {}
  return true;
}

// ---------- procesamiento de un update (el corazón del webhook) ----------
async function procesarUpdate(C, u) {
  // Estado y datos frescos por update (volumen bajo: no hace falta cache)
  const { data: state, sha: stateSha } = await getJsonFile(C, STATE_PATH, { dueAlerted: {}, doneAlerted: {} });
  const { data, sha: dataSha } = await getJsonFile(C, DATA_PATH, { tasks: [] });
  const dataSnapshot = JSON.stringify(data);
  let huboCambiosDeDatos = false;
  let huboCambiosDeEstado = false;

  if (u.callback_query) {
    try {
      huboCambiosDeDatos = await handleCallback(C, u.callback_query, data, state);
      huboCambiosDeEstado = true; // pickdate/picktext registran alertMsgs; done/postpone tocan flags
    } catch (e) {
      try { await answerCallback(C, u.callback_query.id, '⚠️ Error procesando este botón'); } catch (_) {}
    }
  } else if (u.message && u.message.text && u.message.reply_to_message && state.alertMsgs && state.alertMsgs[u.message.reply_to_message.message_id]) {
    const taskId = state.alertMsgs[u.message.reply_to_message.message_id];
    const task = (data.tasks || []).find(t => t.id === taskId);
    if (!task) { await sendMsg(C, '⚠️ Esa tarea ya no existe (¿se borró?).'); return; }
    const parsed = parseFechaTexto(u.message.text);
    if (!parsed) { await sendMsg(C, '⚠️ No entendí la fecha "' + u.message.text + '". Probá con: "15/07", "mañana 18:00", "viernes", "pasado mañana".'); return; }
    task.dueDate = parsed.dueDate;
    if (parsed.dueTime) task.dueTime = parsed.dueTime;
    task.mcpUpdatedAt = new Date().toISOString();
    state.dueAlerted = state.dueAlerted || {};
    const esc = escalonDeFecha(parsed.dueDate);
    if (esc > 0) state.dueAlerted[taskId] = esc; else delete state.dueAlerted[taskId];
    huboCambiosDeDatos = true;
    huboCambiosDeEstado = true;
    await sendMsg(C, '📅 Reprogramada: ' + task.text + '\nNuevo vencimiento: ' + parsed.dueDate + (parsed.dueTime ? ' a las ' + parsed.dueTime : ''));
  } else if (u.message && u.message.voice) {
    try {
      const url = await getVoiceUrl(C, u.message.voice.file_id);
      const raw = await transcribe(C, url);
      if (!raw.toLowerCase().includes('check')) {
        await sendMsg(C, '⚠️ No detecté "check" en el audio, no se creó la tarea.\nTranscripción: ' + raw);
        return;
      }
      const rawSinCheck = raw.replace(/check/gi, ' ').replace(/\s+/g, ' ').trim();
      const parsed = await parseAudio(C, rawSinCheck, data);

      if (parsed.accion === 'proyecto') {
        const res = crearProyecto(data, parsed.nombre, parsed.descripcion, parsed.areaNombre);
        if (!res) { await sendMsg(C, '⚠️ No pude crear el proyecto: no hay áreas definidas en el dashboard.'); return; }
        huboCambiosDeDatos = true;
        const lineaTarea = crearTareaInicial(data, res.proyecto, parsed);
        await sendMsg(C, '📁 Proyecto creado: ' + res.proyecto.name + '\n🗂️ Área: ' + res.areaNombre + (lineaTarea ? '\n' + lineaTarea : '') + '\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"');
      } else if (parsed.accion === 'subproyecto') {
        let res = crearSubproyecto(data, parsed.nombre, parsed.descripcion, parsed.proyectoPadre);
        if (res.error === 'no-encontrado') {
          const padreNuevo = crearProyecto(data, parsed.proyectoPadre, '', '');
          if (!padreNuevo) { await sendMsg(C, '⚠️ No pude crear el proyecto padre "' + parsed.proyectoPadre + '" (no hay áreas definidas).'); return; }
          res = crearSubproyecto(data, parsed.nombre, parsed.descripcion, padreNuevo.proyecto.name);
          huboCambiosDeDatos = true;
          if (res.error) {
            await sendMsg(C, '⚠️ Creé el proyecto "' + padreNuevo.proyecto.name + '" pero no pude crear el subproyecto adentro. Revisá el dashboard.');
          } else {
            const lt = crearTareaInicial(data, res.proyecto, parsed);
            await sendMsg(C, '🆕 Proyecto NUEVO creado: ' + padreNuevo.proyecto.name + ' (área ' + padreNuevo.areaNombre + ')\n📂 Subproyecto creado adentro: ' + res.proyecto.name + (lt ? '\n' + lt : '') + '\nSi el nombre quedó mal transcripto, corregilo en el dashboard.\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"');
          }
        } else if (res.error === 'ambiguo') {
          await sendMsg(C, '⚠️ No creé el subproyecto "' + parsed.nombre + '": "' + parsed.proyectoPadre + '" coincide con varios proyectos (' + res.candidatos.join(', ') + '). Decilo de nuevo con el nombre completo.');
        } else {
          huboCambiosDeDatos = true;
          const lt = crearTareaInicial(data, res.proyecto, parsed);
          await sendMsg(C, '📂 Subproyecto creado: ' + res.proyecto.name + '\n📁 Dentro de: ' + res.padre.name + (lt ? '\n' + lt : '') + '\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"');
        }
      } else {
        const destino = resolverProyectoDestino(data, parsed.proyecto);
        data.tasks = data.tasks || [];
        data.tasks.push({
          id: 't' + Date.now(), projectId: destino.projectId, text: parsed.text, done: false,
          dueDate: parsed.dueDate, dueTime: parsed.dueTime,
          priority: 'medium', emailAlert: false, alertSent: false, driveUrl: ''
        });
        huboCambiosDeDatos = true;
        let conf = '✅ Tarea agregada: ' + parsed.text;
        if (destino.nota) conf += '\n' + destino.nota;
        if (parsed.dueDate) conf += '\n📅 Vence: ' + parsed.dueDate + (parsed.dueTime ? ' a las ' + parsed.dueTime : '');
        else conf += '\n📅 Sin fecha (agregala en el dashboard si hace falta)';
        conf += '\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"';
        await sendMsg(C, conf);
      }
    } catch (e) {
      await sendMsg(C, '⚠️ Error en audio: ' + e.message);
    }
  } else {
    return; // otros tipos de update: ignorar en silencio
  }

  if (huboCambiosDeDatos) {
    await putDataConReintento(C, data, dataSha, dataSnapshot, 'Webhook: cambios de tareas');
  }
  if (huboCambiosDeEstado) {
    await putStateConReintento(C, state, stateSha, 'Webhook: estado de Telegram');
  }
}

// ---------- entrada del webhook: llamar desde el fetch del Worker ----------
// Devuelve una Response si la ruta es del webhook; null si no es para acá.
export async function handleTelegramWebhook(request, env, ctx, pathname) {
  if (!pathname.endsWith('/telegram')) return null;
  if (request.method !== 'POST') return new Response('ok', { status: 200 });

  let update;
  try { update = await request.json(); } catch (_) { return new Response('bad request', { status: 200 }); }

  const C = makeCtx(env);

  // Solo se procesan updates de TU chat (cualquier otro remitente se ignora).
  const fromChat =
    (update.message && update.message.chat && String(update.message.chat.id)) ||
    (update.callback_query && update.callback_query.message && String(update.callback_query.message.chat.id)) || '';
  if (C.CHAT_ID && fromChat && fromChat !== C.CHAT_ID) return new Response('ok', { status: 200 });

  // Responder 200 ya (Telegram no reintenta) y procesar en paralelo.
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(procesarUpdate(C, update).catch(e => console.error('[TG WEBHOOK] ' + e.message)));
  } else {
    await procesarUpdate(C, update).catch(e => console.error('[TG WEBHOOK] ' + e.message));
  }
  return new Response('ok', { status: 200 });
}
