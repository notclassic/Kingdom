const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const DATA_PATH = 'data.json';

// ====== HELPERS ======
function tg(method, body){
  return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(r=>r.json());
}

async function getDataJson(){
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`,
    { headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, Accept:'application/vnd.github+json' } }
  );
  if(!res.ok) return null;
  const json = await res.json();
  const content = Buffer.from(json.content.replace(/\n/g,''), 'base64').toString('utf8');
  return { data: JSON.parse(content), sha: json.sha };
}

async function saveDataJson(data, sha){
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`,
    {
      method: 'PUT',
      headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, Accept:'application/vnd.github+json', 'Content-Type':'application/json' },
      body: JSON.stringify({ message:'Bot: actualizar tareas', content, sha, branch:'main' })
    }
  );
}

function formatDate(d){
  if(!d) return '';
  const [y,m,dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

// ====== ALERTAS DE VENCIMIENTO ======
async function checkOverdue(){
  const result = await getDataJson();
  if(!result) { console.log('No se pudo leer data.json'); return; }
  const { data } = result;
  const today = new Date().toISOString().slice(0,10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10);

  const overdue = data.tasks.filter(t => !t.done && t.dueDate && t.dueDate < today);
  const dueTomorrow = data.tasks.filter(t => !t.done && t.dueDate && t.dueDate === tomorrow);

  let msg = '🦁 *Kingdom — Resumen diario*\n\n';

  if(overdue.length > 0){
    msg += `⚠️ *VENCIDAS (${overdue.length})*\n`;
    overdue.forEach(t => {
      const p = data.projects.find(p=>p.id===t.projectId);
      msg += `• ${t.text} — _${p?p.name:'?'}_ — Vencida el ${formatDate(t.dueDate)}\n`;
    });
    msg += '\n';
  }

  if(dueTomorrow.length > 0){
    msg += `📅 *VENCEN MAÑANA (${dueTomorrow.length})*\n`;
    dueTomorrow.forEach(t => {
      const p = data.projects.find(p=>p.id===t.projectId);
      msg += `• ${t.text} — _${p?p.name:'?'}_\n`;
    });
    msg += '\n';
  }

  if(overdue.length === 0 && dueTomorrow.length === 0){
    msg += '✅ Todo al día, sin vencimientos pendientes.';
  }

  msg += `\n🔗 [Abrir Kingdom](https://notclassic.github.io/Kingdom/dashboard.html)`;

  await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' });
  console.log('Alerta enviada');
}

// ====== TRANSCRIPCIÓN DE AUDIO ======
async function transcribeAudio(fileUrl){
  // 1. subir audio a AssemblyAI
  const audioRes = await fetch(fileUrl);
  const audioBuffer = await audioRes.buffer();
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_KEY, 'content-type': 'application/octet-stream' },
    body: audioBuffer
  });
  const { upload_url } = await uploadRes.json();

  // 2. solicitar transcripción en español
  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, language_code: 'es' })
  });
  const { id } = await transcriptRes.json();

  // 3. esperar resultado (polling)
  let text = null;
  for(let i=0; i<20; i++){
    await new Promise(r=>setTimeout(r,3000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: ASSEMBLYAI_KEY }
    }).then(r=>r.json());
    if(poll.status === 'completed'){ text = poll.text; break; }
    if(poll.status === 'error'){ break; }
  }
  return text;
}

function parseTask(text){
  // busca proyecto mencionado (nombre parcial, insensible a mayúsculas/tildes)
  return text;
}

async function handleAudio(message){
  const voice = message.voice || message.audio;
  if(!voice) return;

  await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: '🎙️ Transcribiendo tu audio...' });

  // obtener URL del archivo
  const fileInfo = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${voice.file_id}`).then(r=>r.json());
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.result.file_path}`;

  const transcription = await transcribeAudio(fileUrl);
  if(!transcription){
    await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: '❌ No pude transcribir el audio. Intentá de nuevo.' });
    return;
  }

  // crear tarea con el texto transcripto
  const result = await getDataJson();
  if(!result){ await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: '❌ No pude leer los datos de Kingdom.' }); return; }
  const { data, sha } = result;

  // detectar proyecto mencionado — busca coincidencias parciales en el nombre completo
  let projectId = null;
  const lower = transcription.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quitar tildes
  
  // primero busca coincidencia exacta de cualquier palabra del nombre del proyecto
  for(const p of data.projects){
    const pName = p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const words = pName.split(/\s+/).filter(w=>w.length>3);
    if(words.some(w => lower.includes(w))){
      projectId = p.id;
      break;
    }
  }
  // si no encontró, usa el primer proyecto activo
  if(!projectId) projectId = data.projects.find(p=>p.status==='active')?.id || data.projects[0]?.id;

  // detectar fecha mencionada en el audio
  let due = new Date(Date.now() + 86400000).toISOString().slice(0,10); // default: mañana
  let dueTime = '12:00';
  const dateMatch = transcription.match(/(\d{1,2})\s*de\s*(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i);
  if(dateMatch){
    const months = {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12};
    const day = parseInt(dateMatch[1]);
    const month = months[dateMatch[2].toLowerCase()];
    const year = new Date().getFullYear();
    due = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const timeMatch = transcription.match(/(\d{1,2})\s*(de la mañana|am|de la tarde|pm|del mediodía|del medio día)/i);
  if(timeMatch){
    let hour = parseInt(timeMatch[1]);
    const period = timeMatch[2].toLowerCase();
    if(period.includes('tarde') || period.includes('pm')) hour = hour < 12 ? hour+12 : hour;
    if(period.includes('mañana') || period.includes('am')) hour = hour === 12 ? 0 : hour;
    if(period.includes('medio')) hour = 12;
    dueTime = `${String(hour).padStart(2,'0')}:00`;
  }
  const newTask = {
    id: 't' + Date.now(),
    projectId,
    text: transcription,
    done: false,
    dueDate: due,
    dueTime: dueTime,
    priority: 'medium',
    emailAlert: false,
    alertSent: false,
    driveUrl: ''
  };
  data.tasks.push(newTask);
  await saveDataJson(data, sha);

  const p = data.projects.find(p=>p.id===projectId);
  await tg('sendMessage', {
    chat_id: TELEGRAM_CHAT_ID,
    text: `✅ *Tarea creada en "${p?.name}"*\n\n_${transcription}_\n\n📅 Vence: ${formatDate(due)}`,
    parse_mode: 'Markdown'
  });
}

// ====== PROCESAR MENSAJES ENTRANTES ======
async function processUpdates(){
  // leer offset guardado
  let offset = 0;
  if(fs.existsSync('/tmp/tg_offset.txt')) offset = parseInt(fs.readFileSync('/tmp/tg_offset.txt','utf8')) || 0;

  const updates = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=5`).then(r=>r.json());
  if(!updates.result?.length) return;

  for(const upd of updates.result){
    offset = upd.update_id + 1;
    const msg = upd.message;
    if(!msg) continue;
    if(msg.voice || msg.audio) await handleAudio(msg);
    else if(msg.text){
      await tg('sendMessage', {
        chat_id: TELEGRAM_CHAT_ID,
        text: `🦁 Kingdom Bot activo.\n\nMandame un *audio* para crear una tarea por voz.\nRecibís el resumen diario automáticamente a las 9:00 AM.`,
        parse_mode: 'Markdown'
      });
    }
  }
  fs.writeFileSync('/tmp/tg_offset.txt', String(offset));
}

// ====== MAIN ======
(async()=>{
  console.log('Kingdom Bot iniciando...');
  await checkOverdue();
  await processUpdates();
  console.log('Kingdom Bot finalizado.');
})();
