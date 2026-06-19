/*
 * Kingdom Bot (Versión para GitHub Actions - Cron)
 * --------------------------------------------------
 * Se ejecuta, procesa mensajes pendientes, guarda en data.json y termina.
 */

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const ASSEMBLYAI_KEY   = process.env.ASSEMBLYAI_KEY;
const GROQ_KEY         = process.env.GROQ_API_KEY; // Corregido para que coincida con tu YAML
const GH_TOKEN         = process.env.GITHUB_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const REPO_OWNER = process.env.GITHUB_OWNER || 'notclassic';
const REPO_NAME  = process.env.GITHUB_REPO || 'Kingdom';
const BRANCH     = 'main';
const FILE_PATH  = 'data.json';

const TG = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;

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

async function sendMsg(text) {
  await fetch(TG + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
  });
}

async function main() {
  console.log('Iniciando Kingdom Bot...');
  
  const api = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + FILE_PATH;
  const headers = { authorization: 'Bearer ' + GH_TOKEN, accept: 'application/vnd.github+json' };

  // 1. Leer data.json (o crearlo si no existe)
  let fileSha = null;
  let data = { tasks: [], meta: { lastOffset: 0 } };
  
  const getRes = await fetch(api + '?ref=' + BRANCH, { headers });
  if (getRes.status === 404) {
    console.log('data.json no existe. Se creará uno nuevo al guardar.');
  } else if (getRes.ok) {
    const file = await getRes.json();
    fileSha = file.sha;
    data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  } else {
    throw new Error('No pude leer data.json (HTTP ' + getRes.status + ')');
  }

  let offset = (data.meta && data.meta.lastOffset) ? data.meta.lastOffset : 0;
  console.log('Buscando mensajes nuevos desde el offset: ' + offset);

  // 2. Buscar mensajes nuevos
  const updates = await getUpdates(offset);
  console.log('Se encontraron ' + updates.length + ' mensajes nuevos.');

  // 3. Procesar solo notas de voz
  for (const u of updates) {
    offset = u.update_id + 1; // Actualizamos el offset para no leer este mensaje de nuevo
    const msg = u.message;
    
    if (!msg || !msg.voice) continue;

    try {
      console.log('Procesando nota de voz...');
      const url = await getVoiceUrl(msg.voice.file_id);
      const raw = await transcribe(url);
      const taskText = await toTask(raw);
      
      const task = {
        id: 't' + Date.now(),
        projectId: 'inbox', 
        text: taskText,
        done: false,
        dueDate: '',
        priority: 'medium',
        emailAlert: false,
        alertSent: false
      };
      
      data.tasks = data.tasks || [];
      data.tasks.push(task);
      console.log('Tarea agregada: ' + taskText);
      
      await sendMsg('✅ Tarea agregada: ' + taskText);
    } catch (e) {
      console.error('Error procesando nota de voz:', e.message);
      await sendMsg('⚠️ Error procesando la nota: ' + e.message);
    }
  }

  // 4. Guardar el offset actualizado y las nuevas tareas en GitHub
  data.meta = { lastOffset: offset };
  
  const putBody = {
    message: 'Bot: Actualizacion de tareas y offset',
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
    branch: BRANCH
  };
  
  // Solo enviamos el SHA si el archivo ya existía
  if (fileSha) {
    putBody.sha = fileSha;
  }

  const put = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(putBody)
  });

  if (!put.ok) {
    const errBody = await put.json();
    throw new Error('Error al subir a GitHub: ' + errBody.message);
  }

  console.log('Proceso finalizado correctamente. Bot apagándose.');
}

main().catch((e) => { 
  console.error('ERROR FATAL:', e.message); 
  process.exit(1); 
});
