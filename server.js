const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const ASSEMBLYAI_KEY   = process.env.ASSEMBLYAI_KEY;
const GROQ_KEY         = process.env.GROQ_API_KEY;
const GH_TOKEN         = process.env.GITHUB_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const REPO_OWNER = process.env.GITHUB_OWNER || 'notclassic';
const REPO_NAME  = process.env.GITHUB_REPO || 'Kingdom';
const BRANCH     = 'main';
const FILE_PATH  = 'data.json';
const TG = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;

app.get('/', (req, res) => res.send('Bot Kingdom despierto.'));

async function getData() {
  const api = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + FILE_PATH;
  const headers = { authorization: 'Bearer ' + GH_TOKEN, accept: 'application/vnd.github+json' };
  const res = await fetch(api + '?ref=' + BRANCH, { headers });
  
  if (res.status === 404) {
    console.log('data.json no existe. Creandolo...');
    const createRes = await fetch(api, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Bot: Crear data.json inicial',
        content: Buffer.from(JSON.stringify({ tasks: [], meta: { lastOffset: 0 } }, null, 2)).toString('base64'),
        branch: BRANCH
      })
    });
    if (!createRes.ok) {
       const errBody = await createRes.text();
       console.error('ERROR MORTAL AL CREAR: ', createRes.status, errBody);
       return null;
    }
    const res2 = await fetch(api + '?ref=' + BRANCH, { headers });
    const file2 = await res2.json();
    return { sha: file2.sha, data: { tasks: [], meta: { lastOffset: 0 } } };
  }

  if (!res.ok) {
    const errBody = await res.text();
    console.error('ERROR MORTAL AL LEER: ', res.status, errBody);
    return null;
  }

  const file = await res.json();
  return { sha: file.sha, data: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) };
}

async function saveData(fileSha, newData, commitMsg) {
  const api = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + FILE_PATH;
  const headers = { authorization: 'Bearer ' + GH_TOKEN, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  const res = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: commitMsg,
      content: Buffer.from(JSON.stringify(newData, null, 2)).toString('base64'),
      sha: fileSha,
      branch: BRANCH
    })
  });
  if (!res.ok) {
    console.error('ERROR MORTAL AL GUARDAR: ', res.status, await res.text());
  }
}

async function sendMsg(text) {
  await fetch(TG + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
  });
}

async function getVoiceUrl(fileId) {
  const r = await fetch(TG + '/getFile?file_id=' + fileId);
  const j = await r.json();
  return 'https://api.telegram.org/file/bot' + TELEGRAM_TOKEN + '/' + j.result.file_path;
}

async function transcribe(audioUrl) {
  const submit = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl, language_code: 'es' })
  });
  const data = await submit.json();
  const id = data.id;
  let attempts = 0;
  while (attempts < 20) {
    const poll = await fetch('https://api.assemblyai.com/v2/transcript/' + id, { headers: { authorization: ASSEMBLYAI_KEY } });
    const t = await poll.json();
    if (t.status === 'completed') return t.text;
    if (t.status === 'error') throw new Error('Error AssemblyAI: ' + t.error);
    await new Promise(r => setTimeout(r, 3000));
    attempts++;
  }
  throw new Error('Transcripcion tardo demasiado.');
}

async function toTask(rawText) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + GROQ_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: 'Converti la nota de voz en una sola tarea breve y clara, en español. Devolve solo el texto.' },
        { role: 'user', content: rawText }
      ]
    })
  });
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || rawText).trim();
}

async function audioLoop(offset) {
  try {
    const r = await fetch(TG + '/getUpdates?timeout=20&offset=' + (offset || ''));
    const j = await r.json();
    const updates = j.result || [];

    for (const u of updates) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg || !msg.voice) continue;

      try {
        const url = await getVoiceUrl(msg.voice.file_id);
        const raw = await transcribe(url);
        const taskText = await toTask(raw);
        
        const repoData = await getData();
        if (!repoData) throw new Error('No se pudo leer data.json (revisar logs)');
        
        repoData.data.tasks = repoData.data.tasks || [];
        repoData.data.tasks.push({
          id: 't' + Date.now(), projectId: 'inbox', text: taskText, done: false,
          dueDate: '', priority: 'medium', emailAlert: false, alertSent: false
        });
        repoData.data.meta = { lastOffset: offset };
        
        await saveData(repoData.sha, repoData.data, 'Bot Audio: Nueva tarea por voz');
        await sendMsg('[OK] Tarea agregada: ' + taskText);
      } catch (e) {
        await sendMsg('[ERROR] ' + e.message);
      }
    }
  } catch (e) {
    console.error('Error en loop de audio:', e.message);
  }
  audioLoop(offset);
}

async function notifLoop() {
  try {
    const repoData = await getData();
    if (!repoData) { setTimeout(notifLoop, 30000); return; }
    
    let huboCambios = false;
    const hoy = new Date(); hoy.setHours(0,0,0,0);

    for (let task of (repoData.data.tasks || [])) {
      if (task.done && !task.alertSent) {
        await sendMsg('[BIEN] Completaste: ' + task.text);
        task.alertSent = true; huboCambios = true;
      }
      if (!task.done && task.dueDate && task.dueDate !== '') {
        const partes = task.dueDate.split('-');
        const fechaTarea = new Date(partes[0], partes[1] - 1, partes[2]); fechaTarea.setHours(0,0,0,0);
        const diffDias = Math.round((fechaTarea - hoy) / (1000 * 60 * 60 * 24));

        if (diffDias < 0 && !task.alertSent) {
          await sendMsg('[VENCIDA] TAREA VENCIDA: ' + task.text);
          task.alertSent = true; huboCambios = true;
        } else if (diffDias === 0 && !task.alertSent) {
          await sendMsg('[HOY] Vence hoy: ' + task.text);
          task.alertSent = true; huboCambios = true;
        } else if (diffDias === 1 && !task.alertSent) {
          await sendMsg('[MANIANA] Manana vence: ' + task.text);
          task.alertSent = true; huboCambios = true;
        }
      }
    }

    if (huboCambios) {
      await saveData(repoData.sha, repoData.data, 'Bot Notif: Alertas actualizadas');
      console.log('Notificaciones enviadas.');
    }
  } catch (e) {
    console.error('Error en loop de notificaciones:', e.message);
  }
  setTimeout(notifLoop, 30000);
}

app.listen(port, async () => {
  console.log('Servidor web encendido en puerto ' + port);
  
  let startOffset = 0;
  const repoData = await getData();
  if (repoData && repoData.data.meta && repoData.data.meta.lastOffset) {
    startOffset = repoData.data.meta.lastOffset;
  }
  
  console.log('Iniciando bucle de audio...');
  audioLoop(startOffset);
  
  console.log('Iniciando bucle de notificaciones...');
  notifLoop();
});
