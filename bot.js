/*
 * Kingdom — Bot de Telegram
 * --------------------------------------------------
 * Voz de Telegram -> AssemblyAI -> Groq -> tarea en data.json en GitHub.
 * Requiere Node 18+. 
 * Variables de entorno: TELEGRAM_TOKEN, ASSEMBLYAI_KEY, GROQ_KEY, GH_TOKEN, TELEGRAM_CHAT_ID
 */

const requiredEnvVars = ['TELEGRAM_TOKEN', 'ASSEMBLYAI_KEY', 'GROQ_KEY', 'GH_TOKEN', 'TELEGRAM_CHAT_ID'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error('Error: Falta la variable de entorno ' + envVar);
    process.exit(1);
  }
}

const REPO = { owner: 'notclassic', name: 'Kingdom', branch: 'main', path: 'data.json' };

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const ASSEMBLYAI_KEY   = process.env.ASSEMBLYAI_KEY;
const GROQ_KEY         = process.env.GROQ_KEY;
const GH_TOKEN         = process.env.GH_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TG = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;

async function getUpdates(offset) {
  const r = await fetch(TG + '/getUpdates?timeout=30&offset=' + (offset || ''));
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
  const id = data.id;

  let attempts = 0;
  while (attempts < 20) {
    const poll = await fetch('https://api.assemblyai.com/v2/transcript/' + id, {
      headers: { authorization: ASSEMBLYAI_KEY }
    });
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
      messages: [
        { role: 'system', content: 'Converti la nota de voz en una sola tarea breve y clara, en español. Devolve solo el texto de la tarea, sin comillas ni explicaciones.' },
        { role: 'user', content: rawText }
      ]
    })
  });
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || rawText).trim();
}

async function appendTask(text) {
  const api = 'https://api.github.com/repos/' + REPO.owner + '/' + REPO.name + '/contents/' + REPO.path;
  const headers = { authorization: 'Bearer ' + GH_TOKEN, accept: 'application/vnd.github+json' };

  const getRes = await fetch(api + '?ref=' + REPO.branch, { headers });
  if (!getRes.ok) throw new Error('No pude leer data.json (HTTP ' + getRes.status + ')');
  const file = await getRes.json();
  const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

  const task = {
    id: 't' + Date.now(),
    projectId: 'inbox', 
    text: text,
    done: false,
    dueDate: '',
    priority: 'medium',
    emailAlert: false,
    alertSent: false
  };
  
  data.tasks = data.tasks || [];
  data.tasks.push(task);

  const put = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'Bot: nueva tarea por voz',
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      sha: file.sha,
      branch: REPO.branch
    })
  });
  if (!put.ok) {
    const errBody = await put.json();
    throw new Error('Error al subir a GitHub: ' + errBody.message);
  }
}

async function sendMsg(text) {
  await fetch(TG + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
  });
}

async function startBot() {
  console.log('Kingdom Bot iniciado. Escuchando notas de voz...');
  let offset = 0; 

  while (true) {
    try {
      const updates = await getUpdates(offset);
      
      for (const u of updates) {
        offset = u.update_id + 1;
        const msg = u.message;
        if (!msg || !msg.voice) continue;

        try {
          const url = await getVoiceUrl(msg.voice.file_id);
          const raw = await transcribe(url);
          const taskText = await toTask(raw);
          await appendTask(taskText);
          await sendMsg('✅ Tarea agregada: ' + taskText);
        } catch (e) {
          await sendMsg('⚠️ Error procesando la nota: ' + e.message);
        }
      }
    } catch (e) {
      console.error('Error en el bucle principal:', e.message);
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

startBot();