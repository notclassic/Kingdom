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

// Devuelve true si modificó data.tasks (para saber si hay que guardar data.json)
async function handleCallback(cb, data, state) {
  const [action, taskId] = cb.data.split('_');
  const task = (data.tasks || []).find(t => t.id === taskId);

  if (!task) {
    await answerCallback(cb.id, '❌ Tarea no encontrada (¿ya se borró?)');
    return false;
  }

  let toast = '';
  let statusLine = '';
  const now = new Date().toISOString();

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
    if (!msg || !msg.voice) continue;

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
    const putRes = await putJsonFile(STATE_PATH, state, stateSha, 'Bot Audio: actualizar estado de Telegram');
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
