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

async function toTask(rawText) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + GROQ_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0,
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'Sos un conversor de notas de voz a tareas. Reglas estrictas:\n' +
          '1. Devolvé SOLO el texto de la tarea, en una sola línea, en español.\n' +
          '2. NO expliques, NO definas términos, NO agregues introducciones ni comentarios.\n' +
          '3. NO inventes contenido que no esté en la nota. Si la nota es confusa, devolvela tal cual, apenas limpiada.\n' +
          '4. Máximo 20 palabras.\n' +
          'Ejemplo entrada: "eh... tengo que llamar al contador mañana por el tema de las facturas"\n' +
          'Ejemplo salida: Llamar al contador mañana por las facturas' },
        { role: 'user', content: rawText }
      ]
    })
  });
  const j = await r.json();
  const out = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();

  // Validación anti-divague: si Groq devolvió algo vacío, con saltos de
  // línea (señal de que está "explicando"), o bastante más largo que la
  // transcripción original, se descarta y se usa la transcripción cruda.
  // Mejor una tarea literal que una alucinación guardada como tarea.
  const sospechoso = !out || out.includes('\n') || out.length > rawText.length * 1.5 + 30;
  return sospechoso ? rawText : out;
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
    d = new Date();
    d.setHours(0, 0, 0, 0);
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
    state.dueAlerted = state.dueAlerted || {};
    delete state.dueAlerted[taskId]; // para que vuelva a avisar en la nueva fecha
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
      const taskText = await toTask(rawSinCheck);

      data.tasks = data.tasks || [];
      data.tasks.push({
        id: 't' + Date.now(),
        projectId: 'inbox', text: taskText, done: false, dueDate: '',
        priority: 'medium', emailAlert: false, alertSent: false, driveUrl: ''
      });

      huboCambiosDeDatos = true;
      await sendMsg('✅ Tarea agregada: ' + taskText + '\n\n🎙️ Lo que escuché: "' + rawSinCheck + '"');
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
