/*
 * Kingdom Bot - Módulo AUDIO
 * --------------------------------------------------
 * Cambios sobre la versión original:
 *  - El offset de Telegram y los flags de "ya avisé" ya NO viven en
 *    data.json (el dashboard lo pisa en cada sync). Viven en un archivo
 *    propio: tg_state.json, que solo tocan estos dos bots.
 *  - Procesa callback_query (botones inline: completar / posponer).
 *  - Cuando el bot modifica una tarea existente (done / dueDate), le
 *    pone mcpUpdatedAt para que el merge del dashboard (app.js) respete
 *    el cambio en vez de pisarlo con la copia vieja del navegador.
 *  - Requiere la palabra "check" en algún lugar del audio para crear
 *    la tarea; si no aparece, avisa y no guarda nada.
 */
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const ASSEMBLYAI_KEY   = process.env.ASSEMBLYAI_KEY;
const GROQ_KEY         = process.env.GROQ_API_KEY;
const GH_TOKEN         = process.env.GITHUB_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const REPO_OWNER   = process.env.GITHUB_OWNER || 'notclassic';
const REPO_NAME    = process.env.GITHUB_REPO || 'Kingdom';
const BRANCH       = 'main';
const DATA_PATH    = 'data.json';
const STATE_PATH   = 'tg_state.json';
const TG = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;
const GH_HEADERS = { authorization: 'Bearer ' + GH_TOKEN, accept: 'application/vnd.github+json' };

function ghUrl(path) {
  return 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + path;
}

async function getJsonFile(path, fallback) {
  const r = await fetch(ghUrl(path) + '?ref=' + BRANCH, { headers: GH_HEADERS });
  if (!r.ok) return { data: fallback, sha: null };
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}

async function putJsonFile(path, data, sha, message) {
  const body = {
    message: message,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  return fetch(ghUrl(path), {
    method: 'PUT',
    headers: { ...GH_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// Guarda tg_state.json tolerando que el OTRO bot lo haya escrito entre nuestra
// lectura y nuestro guardado (conflicto de sha: GitHub responde 409/422).
// En ese caso: relee la versión fresca, fusiona y reintenta UNA vez.
// Sin esto, el conflicto mataba el proceso con exit(1), el offset no avanzaba
// y los botones apretados quedaban sin procesar (botón "muerto").
// Límite conocido del merge: si nosotros BORRAMOS una clave de dueAlerted
// (al reprogramar) y el otro bot la tenía, el merge puede resucitarla y
// generar a lo sumo un aviso repetido. Es el costo de no perder estado.
async function putStateConReintento(state, sha, message) {
  let r = await putJsonFile(STATE_PATH, state, sha, message);
  if (r.status === 409 || r.status === 422) {
    console.log('[AUDIO BOT] Conflicto guardando tg_state.json; releyendo y fusionando...');
    const fresco = await getJsonFile(STATE_PATH, {});
    const remoto = fresco.data || {};
    const merged = {
      ...remoto,
      ...state,
      lastOffset: Math.max(remoto.lastOffset || 0, state.lastOffset || 0),
      dueAlerted: { ...(remoto.dueAlerted || {}), ...(state.dueAlerted || {}) },
      doneAlerted: { ...(remoto.doneAlerted || {}), ...(state.doneAlerted || {}) },
      alertMsgs: { ...(remoto.alertMsgs || {}), ...(state.alertMsgs || {}) }
    };
    r = await putJsonFile(STATE_PATH, merged, fresco.sha, message + ' (merge por conflicto)');
  }
  return r;
}

async function getUpdates(offset) {
  const r = await fetch(TG + '/getUpdates?timeout=10&offset=' + (offset || ''));
  const j = await r.json();
  return j.result || [];
}

async function getVoiceUrl(fileId) {
  const r = await fetch(TG + '/getFile?file_id=' + fileId);
  const j = await r.json();
  if (!j.ok) throw new Error('No pude obtener el archivo de Telegram');
  return 'https://api.telegram.org/file/bot' + TELEGRAM_TOKEN + '/' + j.result.file_path;
}

async function transcribe(audioUrl) {
  const submit = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl, language_code: 'es' })
  });
  const data = await submit.json();
  let attempts = 0;
  while (attempts < 20) {
    const poll = await fetch('https://api.assemblyai.com/v2/transcript/' + data.id, { headers: { authorization: ASSEMBLYAI_KEY } });
    const t = await poll.json();
    if (t.status === 'completed') return t.text;
    if (t.status === 'error') throw new Error('Error en AssemblyAI: ' + t.error);
    await new Promise((res) => setTimeout(res, 3000));
    attempts++;
  }
  throw new Error('La transcripcion tardo demasiado.');
}

// Fecha actual en zona horaria de Chile (el runner de GitHub Actions corre
// en UTC, 3-4 hs adelantado; sin esto, "mañana" dicho a la noche resuelve mal).
function hoyEnChile() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // YYYY-MM-DD
}

function diaSemanaEnChile() {
  return new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', weekday: 'long' });
}

// Normaliza para comparar nombres: minúsculas y sin tildes.
function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Valida fecha YYYY-MM-DD dentro de [ayer, +365 días]. Devuelve '' si no vale.
function validarFecha(fecha, hoy) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return '';
  const f = new Date(fecha + 'T12:00:00');
  const h = new Date(hoy + 'T12:00:00');
  const diff = (f - h) / 86400000;
  return (diff >= -1 && diff <= 365) ? fecha : '';
}

// Valida hora HH:MM 24hs. Devuelve '' si no vale.
function validarHora(hora) {
  return (typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) ? hora : '';
}

// Convierte la transcripción en una acción estructurada usando Groq:
//   { accion: 'tarea',       text, dueDate, dueTime }
//   { accion: 'proyecto',    nombre, descripcion, areaNombre }
//   { accion: 'subproyecto', nombre, descripcion, proyectoPadre }
// Si el JSON no parsea o no valida, cae a tarea con la transcripción cruda.
async function parseAudio(rawText, data) {
  const hoy = hoyEnChile();
  const fallback = { accion: 'tarea', text: rawText, dueDate: '', dueTime: '' };

  // "mañana" para el ejemplo del prompt, con aritmética real de fechas
  // (sumar 1 al string rompería a fin de mes: 2026-07-32).
  const mananaDate = new Date(hoy + 'T12:00:00');
  mananaDate.setDate(mananaDate.getDate() + 1);
  const manana = mananaDate.getFullYear() + '-' + String(mananaDate.getMonth() + 1).padStart(2, '0') + '-' + String(mananaDate.getDate()).padStart(2, '0');

  const nombresAreas = (data.areas || []).map(a => a.name).join(', ');

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + GROQ_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0,
      max_tokens: 200,
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
      dueDate: validarFecha(p.fecha, hoy),
      dueTime: validarHora(p.hora)
    };
  }

  if (p.accion === 'subproyecto' && typeof p.nombre === 'string' && p.nombre.trim() && typeof p.proyecto_padre === 'string' && p.proyecto_padre.trim()) {
    return {
      accion: 'subproyecto',
      nombre: p.nombre.trim().slice(0, 80),
      descripcion: (typeof p.descripcion === 'string' ? p.descripcion.trim().slice(0, 300) : ''),
      proyectoPadre: p.proyecto_padre.trim(),
      tarea: (typeof p.tarea === 'string' ? p.tarea.trim().slice(0, 200) : ''),
      dueDate: validarFecha(p.fecha, hoy),
      dueTime: validarHora(p.hora)
    };
  }

  // Tarea (default para todo lo demás)
  let text = (typeof p.tarea === 'string' ? p.tarea.trim() : '');
  if (!text || text.includes('\n') || text.length > rawText.length * 1.5 + 30) text = rawText;

  return {
    accion: 'tarea', text: text,
    dueDate: validarFecha(p.fecha, hoy), dueTime: validarHora(p.hora),
    proyecto: (typeof p.proyecto === 'string' ? p.proyecto.trim() : '')
  };
}

// Resuelve el proyecto destino de una tarea según la regla acordada:
//  - sin mención de proyecto -> inbox (Ideas)
//  - mención que matchea exactamente 1 proyecto -> ese
//  - mención que matchea varios -> inbox, avisando los candidatos
//  - mención que no matchea ninguno -> se CREA el proyecto y va ahí
function resolverProyectoDestino(data, nombreMencionado) {
  if (!nombreMencionado) return { projectId: 'inbox', nota: '' };

  const buscado = normalizar(nombreMencionado);
  const candidatos = (data.projects || []).filter(p =>
    p.status !== 'archived' &&
    (normalizar(p.name).includes(buscado) || buscado.includes(normalizar(p.name)))
  );

  if (candidatos.length === 1) {
    return { projectId: candidatos[0].id, nota: '📁 Proyecto: ' + candidatos[0].name };
  }
  if (candidatos.length > 1) {
    return { projectId: 'inbox', nota: '⚠️ "' + nombreMencionado + '" coincide con varios proyectos (' + candidatos.map(p => p.name).slice(0, 4).join(', ') + '). La dejé en Ideas — movela desde el dashboard.' };
  }
  // No existe: se crea el proyecto y la tarea va adentro.
  const res = crearProyecto(data, nombreMencionado, '', '');
  if (!res) return { projectId: 'inbox', nota: '⚠️ No pude crear el proyecto, la dejé en Ideas.' };
  return { projectId: res.proyecto.id, nota: '🆕 Proyecto NUEVO creado: ' + res.proyecto.name + ' (área ' + res.areaNombre + '). Si el nombre quedó mal transcripto, corregilo en el dashboard.', creado: true };
}

// Crea un proyecto raíz. Área: la que dijo Groq si matchea una real;
// si no, la primera área profesional; si no hay, la primera que exista.
function crearProyecto(data, nombre, descripcion, areaNombre) {
  const areas = data.areas || [];
  let area = areas.find(a => normalizar(a.name) === normalizar(areaNombre));
  if (!area) area = areas.find(a => a.context === 'profesional') || areas[0];
  if (!area) return null;

  const proyecto = {
    id: 'p' + Date.now(),
    name: nombre,
    area: area.id,
    desc: descripcion || 'Creado por voz desde Telegram.',
    status: 'active',
    hasLeads: false,
    color: area.color || '#007aff',
    icon: '',
    driveUrl: '',
    driveFolderId: '',
    contacts: [],
    context: area.context || 'profesional',
    parentId: null
  };
  data.projects = data.projects || [];
  data.projects.push(proyecto);
  return { proyecto: proyecto, areaNombre: area.name };
}

// Crea un subproyecto. El padre se busca por coincidencia parcial de nombre;
// si no se encuentra, devuelve null y NO se crea nada.
function crearSubproyecto(data, nombre, descripcion, nombrePadre) {
  const buscado = normalizar(nombrePadre);
  const candidatos = (data.projects || []).filter(p =>
    !p.parentId && p.status !== 'archived' &&
    (normalizar(p.name).includes(buscado) || buscado.includes(normalizar(p.name)))
  );
  if (candidatos.length !== 1) return { error: candidatos.length === 0 ? 'no-encontrado' : 'ambiguo', candidatos: candidatos.map(p => p.name) };

  const padre = candidatos[0];
  const sub = {
    id: 'p' + Date.now(),
    name: nombre,
    area: padre.area,
    desc: descripcion || 'Creado por voz desde Telegram.',
    status: 'active',
    hasLeads: false,
    color: padre.color || '#007aff',
    icon: '',
    driveUrl: '',
    driveFolderId: '',
    contacts: [],
    context: padre.context || 'profesional',
    parentId: padre.id
  };
  data.projects = data.projects || [];
  data.projects.push(sub);
  return { proyecto: sub, padre: padre };
}

async function sendMsg(text) {
  await fetch(TG + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
  });
}

async function answerCallback(id, text) {
  await fetch(TG + '/answerCallbackQuery', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text: text || '' })
  });
}

async function editMessage(chatId, messageId, text) {
  await fetch(TG + '/editMessageText', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text,
      reply_markup: { inline_keyboard: [] }
    })
  });
}

function sumarDias(dueDate, dias) {
  // Si la tarea no tiene fecha válida (ej: creada por audio con dueDate ''),
  // el postponer parte desde hoy. Sin este guard, '' produce 'NaN-NaN-NaN'.
  let d;
  if (dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    const partes = dueDate.split('-');
    d = new Date(partes[0], partes[1] - 1, partes[2]);
  } else {
    // "hoy" en zona Chile, no UTC del runner (que a la noche ya va en mañana)
    const hoyStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    d = new Date(hoyStr + 'T00:00:00');
  }
  d.setDate(d.getDate() + dias);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function taskKeyboard(taskId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ya está', callback_data: 'done_' + taskId },
        { text: '📅 +1 día',  callback_data: 'postpone1_' + taskId },
        { text: '📅 +1 sem',  callback_data: 'postpone7_' + taskId }
      ],
      [
        { text: '📅 Elegir fecha y hora', callback_data: 'pickdate_' + taskId }
      ]
    ]
  };
}

// ---------- Selector de fecha y hora por botones ----------
// Flujo: [📅 Elegir fecha y hora] -> grilla de fechas -> grilla de horas -> listo.
// Cada tap se procesa en la SIGUIENTE corrida del cron (no es instantáneo).
// El callback_data de este flujo usa '|' como separador para no chocar con
// el parseo por '_' de los botones viejos: pdD|taskId|fecha, pdT|taskId|fecha|hora.

function hoyChileDate() {
  const hoyStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  return new Date(hoyStr + 'T12:00:00');
}

function fmtYMD(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function etiquetaDia(d) {
  const w = d.toLocaleDateString('es-CL', { weekday: 'short' }); // "jue."
  const wLimpio = w.replace('.', '');
  return wLimpio.charAt(0).toUpperCase() + wLimpio.slice(1) + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
}

function dateKeyboard(taskId) {
  const hoy = hoyChileDate();
  function plus(n) { const d = new Date(hoy); d.setDate(d.getDate() + n); return d; }
  function btn(text, d) { return { text: text, callback_data: 'pdD|' + taskId + '|' + fmtYMD(d) }; }
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
  function btn(text, hora) { return { text: text, callback_data: 'pdT|' + taskId + '|' + fecha + '|' + hora }; }
  return {
    inline_keyboard: [
      [btn('Sin hora', '-'), btn('09:00', '09:00'), btn('12:00', '12:00')],
      [btn('15:00', '15:00'), btn('18:00', '18:00'), btn('20:00', '20:00')],
      [{ text: '← Cambiar fecha', callback_data: 'pickdate_' + taskId }]
    ]
  };
}

async function editKeyboard(chatId, messageId, replyMarkup) {
  await fetch(TG + '/editMessageReplyMarkup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
  });
}

// Escalón de aviso para una fecha (mismo criterio que bot_notificaciones):
// 3=vencida, 2=hoy, 1=mañana, 0=más adelante.
function escalonDeFecha(dueDate) {
  const hoyStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const diff = Math.round((new Date(dueDate + 'T00:00:00') - new Date(hoyStr + 'T00:00:00')) / 86400000);
  return diff < 0 ? 3 : diff === 0 ? 2 : diff === 1 ? 1 : 0;
}

// Parsea una fecha escrita por el usuario en respuesta a una alerta.
// Acepta: "15/07", "15-07-2026", "hoy", "mañana", "pasado mañana",
// días de semana ("viernes"), y hora opcional ("18:00", "18.30").
// Devuelve { dueDate, dueTime } o null si no se entiende.
function parseFechaTexto(texto) {
  const t = (texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const hoyStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const hoy = new Date(hoyStr + 'T12:00:00');

  // hora opcional: 18:00 / 18.30
  let dueTime = '';
  const mHora = t.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (mHora) {
    const h = parseInt(mHora[1], 10), min = parseInt(mHora[2], 10);
    if (h <= 23 && min <= 59) dueTime = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  }

  function fmt(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // palabras clave
  if (/\bhoy\b/.test(t)) return { dueDate: fmt(hoy), dueTime: dueTime };
  if (/\bpasado\s*manana\b/.test(t)) { const d = new Date(hoy); d.setDate(d.getDate() + 2); return { dueDate: fmt(d), dueTime: dueTime }; }
  if (/\bmanana\b/.test(t)) { const d = new Date(hoy); d.setDate(d.getDate() + 1); return { dueDate: fmt(d), dueTime: dueTime }; }

  // día de semana -> la próxima ocurrencia (1 a 7 días adelante)
  const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  for (let i = 0; i < 7; i++) {
    if (new RegExp('\\b' + dias[i] + '\\b').test(t)) {
      const d = new Date(hoy);
      let delta = (i - d.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      d.setDate(d.getDate() + delta);
      return { dueDate: fmt(d), dueTime: dueTime };
    }
  }

  // dd/mm o dd-mm, con año opcional. Cuidado de no confundir con la hora:
  // se busca un separador / o - explícito.
  const mFecha = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (mFecha) {
    const dd = parseInt(mFecha[1], 10), mm = parseInt(mFecha[2], 10);
    let yy = mFecha[3] ? parseInt(mFecha[3], 10) : hoy.getFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      let d = new Date(yy, mm - 1, dd, 12);
      if (d.getDate() !== dd || d.getMonth() !== mm - 1) return null; // fecha inexistente (31/02)
      // sin año explícito y la fecha ya pasó -> asumir el año que viene
      if (!mFecha[3] && d < hoy) d = new Date(yy + 1, mm - 1, dd, 12);
      // sanity: no más de un año adelante
      if ((d - hoy) / 86400000 > 370) return null;
      return { dueDate: fmt(d), dueTime: dueTime };
    }
  }

  return null;
}

// Registra mensaje->tarea (mismo mecanismo que bot_notificaciones).
function registrarMsgTarea(state, messageId, taskId) {
  if (!messageId) return;
  state.alertMsgs = state.alertMsgs || {};
  state.alertMsgs[messageId] = taskId;
  const keys = Object.keys(state.alertMsgs);
  if (keys.length > 150) {
    keys.slice(0, keys.length - 150).forEach(k => delete state.alertMsgs[k]);
  }
}

// Devuelve true si modificó data.tasks (para saber si hay que guardar data.json)
async function handleCallback(cb, data, state) {
  const raw = cb.data || '';

  // --- Selector de fecha/hora (callbacks con separador '|') ---
  if (raw.startsWith('pdD|') || raw.startsWith('pdT|') || raw.startsWith('pdB|')) {
    const partes = raw.split('|');
    const tId = partes[1];
    const t = (data.tasks || []).find(x => x.id === tId);
    if (!t) {
      await answerCallback(cb.id, '❌ Tarea no encontrada (¿ya se borró?)');
      return false;
    }

    // Volver a los botones originales
    if (raw.startsWith('pdB|')) {
      try { await answerCallback(cb.id, ''); } catch (_) {}
      if (cb.message) await editKeyboard(cb.message.chat.id, cb.message.message_id, taskKeyboard(tId));
      return false;
    }

    // Eligió fecha -> mostrar grilla de horas
    if (raw.startsWith('pdD|')) {
      const fecha = partes[2];
      try { await answerCallback(cb.id, 'Fecha ' + fecha + ' — ahora la hora'); } catch (_) {}
      if (cb.message) await editKeyboard(cb.message.chat.id, cb.message.message_id, timeKeyboard(tId, fecha));
      return false;
    }

    // Eligió hora ('-' = sin hora) -> aplicar y cerrar
    const fecha = partes[2];
    const hora = (partes[3] && partes[3] !== '-') ? partes[3] : '';
    t.dueDate = fecha;
    t.dueTime = hora;
    t.mcpUpdatedAt = new Date().toISOString();
    state.dueAlerted = state.dueAlerted || {};
    const esc = escalonDeFecha(fecha);
    if (esc > 0) state.dueAlerted[tId] = esc;
    else delete state.dueAlerted[tId];
    try {
      await answerCallback(cb.id, '📅 ' + fecha + (hora ? ' ' + hora : ''));
      if (cb.message) {
        await editMessage(cb.message.chat.id, cb.message.message_id,
          (cb.message.text || '') + '\n\n📅 Reprogramada: ' + t.text + '\nNuevo vencimiento: ' + fecha + (hora ? ' a las ' + hora : ''));
      }
    } catch (e) {
      console.error('[AUDIO BOT] Cambio aplicado pero falló la confirmación en Telegram: ' + e.message);
    }
    return true;
  }

  const [action, taskId] = raw.split('_');
  const task = (data.tasks || []).find(t => t.id === taskId);

  if (!task) {
    await answerCallback(cb.id, '❌ Tarea no encontrada (¿ya se borró?)');
    return false;
  }

  let toast = '';
  let statusLine = '';
  const now = new Date().toISOString();

  if (action === 'pickdate') {
    // Muestra la grilla de fechas. Se registra el vínculo mensaje->tarea
    // igual, así también funciona responder al mensaje con una fecha escrita.
    registrarMsgTarea(state, cb.message && cb.message.message_id, taskId);
    try { await answerCallback(cb.id, 'Elegí la fecha'); } catch (_) {}
    if (cb.message) await editKeyboard(cb.message.chat.id, cb.message.message_id, dateKeyboard(taskId));
    return false; // no cambió data.json; el estado se guarda igual porque hubo updates
  }

  if (action === 'picktext') {
    // Flujo por texto: registra este mensaje como vinculado a la tarea y
    // explica cómo responder con la fecha escrita.
    registrarMsgTarea(state, cb.message && cb.message.message_id, taskId);
    try { await answerCallback(cb.id, 'Respondé a ese mensaje con la fecha'); } catch (_) {}
    if (cb.message) {
      const yaExplicado = (cb.message.text || '').includes('Respondé a ESTE mensaje');
      if (!yaExplicado) {
        await fetch(TG + '/editMessageText', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: (cb.message.text || '') + '\n\n✍️ Respondé a ESTE mensaje (deslizalo a la izquierda) con la nueva fecha y hora. Ejemplos: "15/07", "mañana 18:00", "viernes".',
            reply_markup: taskKeyboard(taskId)
          })
        });
      }
    }
    return false;
  }

  if (action === 'done') {
    task.done = true;
    task.mcpUpdatedAt = now; // para que el dashboard respete este cambio en el próximo sync
    state.doneAlerted = state.doneAlerted || {};
    state.doneAlerted[taskId] = true; // evita el "🎉 Bien hecho" duplicado de bot_notificaciones
    toast = '✅ Tarea completada';
    statusLine = '✅ Completada';
  } else if (action === 'postpone1' || action === 'postpone7') {
    const dias = action === 'postpone1' ? 1 : 7;
    task.dueDate = sumarDias(task.dueDate, dias);
    task.mcpUpdatedAt = now;
    // Marca de aviso = escalón de la fecha NUEVA (1=mañana, 2=hoy, 3=vencida, 0=lejos).
    // Así no te repite al instante el aviso del nivel que acabás de elegir
    // conscientemente, pero los escalones superiores siguen avisando.
    state.dueAlerted = state.dueAlerted || {};
    const hoyStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const diffNueva = Math.round((new Date(task.dueDate + 'T00:00:00') - new Date(hoyStr + 'T00:00:00')) / 86400000);
    const escalonNuevo = diffNueva < 0 ? 3 : diffNueva === 0 ? 2 : diffNueva === 1 ? 1 : 0;
    if (escalonNuevo > 0) state.dueAlerted[taskId] = escalonNuevo;
    else delete state.dueAlerted[taskId];
    toast = '📅 Pospuesta a ' + task.dueDate;
    statusLine = '📅 Pospuesta a ' + task.dueDate;
  } else {
    await answerCallback(cb.id, '❌ Acción no reconocida');
    return false;
  }

  // La mutación del dato ya está hecha en este punto. La mensajería a
  // Telegram (toast + edición del mensaje) va en su propio try/catch:
  // si falla — por ejemplo un callback viejo cuyo toast Telegram ya
  // expiró — el cambio en la tarea se guarda igual.
  try {
    await answerCallback(cb.id, toast);
    if (cb.message) {
      await editMessage(cb.message.chat.id, cb.message.message_id, (cb.message.text || '') + '\n\n' + statusLine);
    }
  } catch (e) {
    console.error('[AUDIO BOT] Cambio aplicado pero falló la confirmación en Telegram: ' + e.message);
  }
  return true;
}

// Si el audio de creación de proyecto/subproyecto mencionó una tarea o fecha,
// crea la tarea inicial adentro. Sin tarea explícita pero con fecha, la tarea
// toma el nombre del proyecto. Devuelve la línea de confirmación o ''.
function crearTareaInicial(data, proyecto, parsed) {
  if (!parsed.tarea && !parsed.dueDate) return '';
  const texto = parsed.tarea || proyecto.name;
  data.tasks = data.tasks || [];
  data.tasks.push({
    id: 't' + Date.now(),
    projectId: proyecto.id, text: texto, done: false,
    dueDate: parsed.dueDate || '', dueTime: parsed.dueTime || '',
    priority: 'medium', emailAlert: false, alertSent: false, driveUrl: ''
  });
  let linea = '✅ Tarea adentro: ' + texto;
  if (parsed.dueDate) linea += '\n📅 Vence: ' + parsed.dueDate + (parsed.dueTime ? ' a las ' + parsed.dueTime : '');
  return linea;
}

async function main() {
  console.log('[AUDIO BOT] Iniciando...');

  const { data: state, sha: stateSha } = await getJsonFile(STATE_PATH, { lastOffset: 0, dueAlerted: {}, doneAlerted: {} });
  const { data, sha: dataSha } = await getJsonFile(DATA_PATH, { tasks: [] });

  let offset = state.lastOffset || 0;
  const updates = await getUpdates(offset);
  let huboCambiosDeDatos = false;

  for (const u of updates) {
    offset = u.update_id + 1;

    if (u.callback_query) {
      // try/catch por callback: si uno falla (dato corrupto, error de red),
      // se avisa y se sigue con los demás. Antes, una excepción acá mataba
      // el proceso entero sin guardar offset ni los cambios ya aplicados,
      // dejando toda la tanda de botones sin procesar.
      try {
        const cambio = await handleCallback(u.callback_query, data, state);
        if (cambio) huboCambiosDeDatos = true;
      } catch (e) {
        console.error('[AUDIO BOT] Error en callback ' + (u.callback_query.data || '?') + ': ' + e.message);
        try { await answerCallback(u.callback_query.id, '⚠️ Error procesando este botón'); } catch (_) {}
      }
      continue;
    }

    const msg = u.message;
    if (!msg) continue;

    // Respuesta a un mensaje del bot vinculado a una tarea -> reprogramar
    // con la fecha escrita ("15/07", "mañana 18:00", "viernes"...).
    if (msg.text && msg.reply_to_message && state.alertMsgs && state.alertMsgs[msg.reply_to_message.message_id]) {
      const taskId = state.alertMsgs[msg.reply_to_message.message_id];
      const task = (data.tasks || []).find(t => t.id === taskId);
      if (!task) {
        await sendMsg('⚠️ Esa tarea ya no existe (¿se borró?).');
        continue;
      }
      const parsed = parseFechaTexto(msg.text);
      if (!parsed) {
        await sendMsg('⚠️ No entendí la fecha "' + msg.text + '". Probá con: "15/07", "mañana 18:00", "viernes", "pasado mañana".');
        continue;
      }
      task.dueDate = parsed.dueDate;
      if (parsed.dueTime) task.dueTime = parsed.dueTime;
      task.mcpUpdatedAt = new Date().toISOString();
      state.dueAlerted = state.dueAlerted || {};
      const esc = escalonDeFecha(parsed.dueDate);
      if (esc > 0) state.dueAlerted[taskId] = esc;
      else delete state.dueAlerted[taskId];
      huboCambiosDeDatos = true;
      await sendMsg('📅 Reprogramada: ' + task.text + '\nNuevo vencimiento: ' + parsed.dueDate + (parsed.dueTime ? ' a las ' + parsed.dueTime : ''));
      continue;
    }

    if (!msg.voice) continue;

    try {
      const url = await getVoiceUrl(msg.voice.file_id);
      const raw = await transcribe(url);

      // Solo se crea la tarea si el audio incluye "check" en cualquier parte.
      if (!raw.toLowerCase().includes('check')) {
        await sendMsg('⚠️ No detecté "check" en el audio, no se creó la tarea.\nTranscripción: ' + raw);
        continue;
      }

      const rawSinCheck = raw.replace(/check/gi, ' ').replace(/\s+/g, ' ').trim();
      const parsed = await parseAudio(rawSinCheck, data);

      if (parsed.accion === 'proyecto') {
        const res = crearProyecto(data, parsed.nombre, parsed.descripcion, parsed.areaNombre);
        if (!res) {
          await sendMsg('⚠️ No pude crear el proyecto: no hay áreas definidas en el dashboard.');
          continue;
        }
        huboCambiosDeDatos = true;
        const lineaTarea = crearTareaInicial(data, res.proyecto, parsed);
        await sendMsg('📁 Proyecto creado: ' + res.proyecto.name + '\n🗂️ Área: ' + res.areaNombre +
          (lineaTarea ? '\n' + lineaTarea : '') +
          '\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"');
        continue;
      }

      if (parsed.accion === 'subproyecto') {
        let res = crearSubproyecto(data, parsed.nombre, parsed.descripcion, parsed.proyectoPadre);
        if (res.error === 'no-encontrado') {
          // Regla acordada: si el padre no existe, se crea primero.
          const padreNuevo = crearProyecto(data, parsed.proyectoPadre, '', '');
          if (!padreNuevo) {
            await sendMsg('⚠️ No pude crear el proyecto padre "' + parsed.proyectoPadre + '" (no hay áreas definidas).');
            continue;
          }
          res = crearSubproyecto(data, parsed.nombre, parsed.descripcion, padreNuevo.proyecto.name);
          if (res.error) {
            await sendMsg('⚠️ Creé el proyecto "' + padreNuevo.proyecto.name + '" pero no pude crear el subproyecto adentro. Revisá el dashboard.');
            huboCambiosDeDatos = true;
            continue;
          }
          huboCambiosDeDatos = true;
          const lineaTareaNuevo = crearTareaInicial(data, res.proyecto, parsed);
          await sendMsg('🆕 Proyecto NUEVO creado: ' + padreNuevo.proyecto.name + ' (área ' + padreNuevo.areaNombre + ')\n📂 Subproyecto creado adentro: ' + res.proyecto.name +
            (lineaTareaNuevo ? '\n' + lineaTareaNuevo : '') +
            '\nSi el nombre quedó mal transcripto, corregilo en el dashboard.\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"');
          continue;
        }
        if (res.error === 'ambiguo') {
          await sendMsg('⚠️ No creé el subproyecto "' + parsed.nombre + '": "' + parsed.proyectoPadre + '" coincide con varios proyectos (' + res.candidatos.join(', ') + '). Decilo de nuevo con el nombre completo.');
          continue;
        }
        huboCambiosDeDatos = true;
        const lineaTareaSub = crearTareaInicial(data, res.proyecto, parsed);
        await sendMsg('📂 Subproyecto creado: ' + res.proyecto.name + '\n📁 Dentro de: ' + res.padre.name +
          (lineaTareaSub ? '\n' + lineaTareaSub : '') +
          '\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"');
        continue;
      }

      // Acción por defecto: tarea. Destino según proyecto mencionado (o Ideas).
      const destino = resolverProyectoDestino(data, parsed.proyecto);

      data.tasks = data.tasks || [];
      data.tasks.push({
        id: 't' + Date.now(),
        projectId: destino.projectId, text: parsed.text, done: false,
        dueDate: parsed.dueDate, dueTime: parsed.dueTime,
        priority: 'medium', emailAlert: false, alertSent: false, driveUrl: ''
      });

      huboCambiosDeDatos = true;
      let confirmacion = '✅ Tarea agregada: ' + parsed.text;
      if (destino.nota) confirmacion += '\n' + destino.nota;
      if (parsed.dueDate) confirmacion += '\n📅 Vence: ' + parsed.dueDate + (parsed.dueTime ? ' a las ' + parsed.dueTime : '');
      else confirmacion += '\n📅 Sin fecha (agregala en el dashboard si hace falta)';
      confirmacion += '\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"';
      await sendMsg(confirmacion);
    } catch (e) {
      await sendMsg('⚠️ Error en audio: ' + e.message);
    }
  }

  // data.json: solo se guarda si de verdad cambió algo (tarea nueva o editada por botón).
  if (huboCambiosDeDatos) {
    const putRes = await putJsonFile(DATA_PATH, data, dataSha, 'Bot Audio: actualizar tareas');
    if (!putRes.ok) {
      const errBody = await putRes.text();
      console.error('[AUDIO BOT] Falló el guardado de data.json (' + putRes.status + '): ' + errBody);
      process.exit(1);
    }
    console.log('[AUDIO BOT] data.json actualizado.');
  } else {
    console.log('[AUDIO BOT] Sin cambios de tareas.');
  }

  // tg_state.json: se guarda si hubo updates (avanza offset) o si cambiaron los flags de alerta.
  if (updates.length > 0) {
    state.lastOffset = offset;
    const putRes = await putStateConReintento(state, stateSha, 'Bot Audio: actualizar estado de Telegram');
    if (!putRes.ok) {
      const errBody = await putRes.text();
      console.error('[AUDIO BOT] Falló el guardado de tg_state.json (' + putRes.status + '): ' + errBody);
      process.exit(1);
    }
    console.log('[AUDIO BOT] tg_state.json actualizado (offset=' + offset + ').');
  } else {
    console.log('[AUDIO BOT] Sin updates nuevos.');
  }
}

main().catch(e => { console.error('[AUDIO BOT] ERROR:', e.message); process.exit(1); });
