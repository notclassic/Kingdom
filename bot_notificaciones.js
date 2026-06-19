/*
 * Kingdom Bot - Módulo NOTIFICACIONES
 * --------------------------------------------------
 */
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const GH_TOKEN         = process.env.GITHUB_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const REPO_OWNER = process.env.GITHUB_OWNER || 'notclassic';
const REPO_NAME  = process.env.GITHUB_REPO || 'Kingdom';
const BRANCH     = 'main';
const FILE_PATH  = 'data.json';
const TG = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;

async function sendMsg(text) {
  await fetch(TG + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
  });
}

async function main() {
  console.log('[NOTIF BOT] Iniciando revision...');
  const api = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + FILE_PATH;
  const headers = { authorization: 'Bearer ' + GH_TOKEN, accept: 'application/vnd.github+json' };

  const getRes = await fetch(api + '?ref=' + BRANCH, { headers });
  if (!getRes.ok) { console.log('[NOTIF BOT] No hay data.json aún.'); return; }
  
  const file = await getRes.json();
  const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  let huboCambios = false;

  const hoy = new Date(); hoy.setHours(0,0,0,0);

  for (let task of (data.tasks || [])) {
    // 1. Avisar si se completó una tarea
    if (task.done && !task.alertSent) {
      await sendMsg('🎉 ¡Bien hecho! Completaste: ' + task.text);
      task.alertSent = true; // Para no avisar de nuevo
      huboCambios = true;
    }

    // 2. Avisar sobre fechas de vencimiento
    if (!task.done && task.dueDate && task.dueDate !== '') {
      // Formato esperado: YYYY-MM-DD
      const partes = task.dueDate.split('-');
      const fechaTarea = new Date(partes[0], partes[1] - 1, partes[2]);
      fechaTarea.setHours(0,0,0,0);

      const diffDias = Math.round((fechaTarea - hoy) / (1000 * 60 * 60 * 24));

      if (diffDias < 0 && !task.alertSent) {
        await sendMsg('🚨 ¡TAREA VENCIDA! ' + task.text + ' (Venció el ' + task.dueDate + ')');
        task.alertSent = true;
        huboCambios = true;
      } else if (diffDias === 0 && !task.alertSent) {
        await sendMsg('⏰ ¡Vence HOY! ' + task.text);
        task.alertSent = true;
        huboCambios = true;
      } else if (diffDias === 1 && !task.alertSent) {
        await sendMsg(' Mañana vence: ' + task.text);
        task.alertSent = true;
        huboCambios = true;
      }
    }
  }

  if (huboCambios) {
    const putBody = {
      message: 'Bot Notif: Estado de alertas actualizado',
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      sha: file.sha,
      branch: BRANCH
    };
    await fetch(api, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(putBody) });
    console.log('[NOTIF BOT] Notificaciones enviadas y guardadas.');
  } else {
    console.log('[NOTIF BOT] Nada nuevo que notificar.');
  }
}

main().catch(e => { console.error('[NOTIF BOT] ERROR:', e.message); process.exit(1); });