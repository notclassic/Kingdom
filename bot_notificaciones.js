/*
 * Kingdom Bot - Módulo NOTIFICACIONES
 * --------------------------------------------------
 * Ya no escribe en data.json. El dedup de "ya avisé esta tarea" vivía
 * antes en task.alertSent dentro de data.json, y ese mismo campo lo usa
 * también el dashboard (app.js) para su propio sistema de alertas por
 * email — dos sistemas distintos pisándose el mismo campo. Ahora el
 * estado de qué se avisó por Telegram vive en tg_state.json, separado
 * y exclusivo de estos bots.
 */
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const GH_TOKEN         = process.env.GITHUB_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const REPO_OWNER  = process.env.GITHUB_OWNER || 'notclassic';
const REPO_NAME   = process.env.GITHUB_REPO || 'Kingdom';
const BRANCH      = 'main';
const DATA_PATH   = 'data.json';
const STATE_PATH  = 'tg_state.json';
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

function taskKeyboard(taskId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ya está', callback_data: 'done_' + taskId },
        { text: '📅 +1 día',  callback_data: 'postpone1_' + taskId },
        { text: '📅 +1 sem',  callback_data: 'postpone7_' + taskId }
      ],
      [
        { text: '📅 Otra fecha (respondé a este mensaje)', callback_data: 'pickdate_' + taskId }
      ]
    ]
  };
}

// Envía y devuelve el message_id (o null), para poder vincular respuestas.
async function sendMsg(text, replyMarkup) {
  const body = { chat_id: TELEGRAM_CHAT_ID, text: text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const r = await fetch(TG + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => null);
  return (j && j.ok && j.result) ? j.result.message_id : null;
}

// Registra mensaje->tarea en el estado para que una respuesta al mensaje
// pueda reprogramar la tarea. Se podan los más viejos para no crecer infinito.
function registrarMsgTarea(state, messageId, taskId) {
  if (!messageId) return;
  state.alertMsgs = state.alertMsgs || {};
  state.alertMsgs[messageId] = taskId;
  const keys = Object.keys(state.alertMsgs);
  if (keys.length > 150) {
    keys.slice(0, keys.length - 150).forEach(k => delete state.alertMsgs[k]);
  }
}

async function main() {
  console.log('[NOTIF BOT] Iniciando revision...');

  const { data, sha: dataSha } = await getJsonFile(DATA_PATH, null);
  if (!data) { console.log('[NOTIF BOT] No hay data.json aún.'); return; }

  const { data: state, sha: stateSha } = await getJsonFile(STATE_PATH, { lastOffset: 0, dueAlerted: {}, doneAlerted: {} });
  state.dueAlerted = state.dueAlerted || {};
  state.doneAlerted = state.doneAlerted || {};

  let huboCambiosEstado = false;

  // "Hoy" en zona horaria de Chile. El runner corre en UTC (3-4 hs adelantado):
  // sin esto, desde las ~20-21 hs de Chile el bot ya cree que es mañana y
  // manda "vence HOY" / "VENCIDA" un día antes de tiempo.
  const hoyStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const hoy = new Date(hoyStr + 'T00:00:00');

  // Escalones de aviso: 1 = "vence mañana", 2 = "vence HOY", 3 = "VENCIDA".
  // Se avisa solo cuando la tarea SUBE de escalón, así recibís hasta 3 avisos
  // escalonados por tarea en vez de uno solo para siempre.
  // Compatibilidad: los valores `true` guardados por la versión anterior se
  // tratan como escalón 3 (ya totalmente avisada) para no repetir todo.
  function escalon(diffDias) {
    if (diffDias < 0) return 3;
    if (diffDias === 0) return 2;
    if (diffDias === 1) return 1;
    return 0;
  }
  function escalonGuardado(v) {
    if (v === true) return 3;
    return (typeof v === 'number') ? v : 0;
  }

  for (const task of (data.tasks || [])) {
    // 1. Avisar si se completó una tarea
    if (task.done && !state.doneAlerted[task.id]) {
      await sendMsg('🎉 ¡Bien hecho! Completaste: ' + task.text);
      state.doneAlerted[task.id] = true;
      huboCambiosEstado = true;
    }

    // 2. Avisar sobre fechas de vencimiento, por escalón
    if (!task.done && task.dueDate && task.dueDate !== '') {
      const partes = task.dueDate.split('-');
      const fechaTarea = new Date(partes[0], partes[1] - 1, partes[2]);
      fechaTarea.setHours(0,0,0,0);

      const diffDias = Math.round((fechaTarea - hoy) / (1000 * 60 * 60 * 24));
      const actual = escalon(diffDias);
      const previo = escalonGuardado(state.dueAlerted[task.id]);

      if (actual > previo) {
        let msgId = null;
        if (actual === 3) {
          msgId = await sendMsg('🚨 ¡TAREA VENCIDA! ' + task.text + ' (Venció el ' + task.dueDate + ')', taskKeyboard(task.id));
        } else if (actual === 2) {
          msgId = await sendMsg('⏰ ¡Vence HOY! ' + task.text, taskKeyboard(task.id));
        } else {
          msgId = await sendMsg('📅 Mañana vence: ' + task.text, taskKeyboard(task.id));
        }
        registrarMsgTarea(state, msgId, task.id);
        state.dueAlerted[task.id] = actual;
        huboCambiosEstado = true;
      }
    }
  }

  if (huboCambiosEstado) {
    const putRes = await putJsonFile(STATE_PATH, state, stateSha, 'Bot Notif: estado de alertas actualizado');
    if (!putRes.ok) {
      const errBody = await putRes.text();
      console.error('[NOTIF BOT] Falló el guardado de tg_state.json (' + putRes.status + '): ' + errBody);
      process.exit(1);
    }
    console.log('[NOTIF BOT] Notificaciones enviadas, estado guardado.');
  } else {
    console.log('[NOTIF BOT] Nada nuevo que notificar.');
  }
}

main().catch(e => { console.error('[NOTIF BOT] ERROR:', e.message); process.exit(1); });
