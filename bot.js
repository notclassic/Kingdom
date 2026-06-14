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

// quita tildes y pasa a minúsculas (para comparar texto de forma robusta)
function norm(s){
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function getDataJson(){
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`,
    { headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, Accept:'application/vnd.github+json' } }
  );
  if(!res.ok){
    console.error('getDataJson falló:', res.status, await res.text().catch(()=>''));
    return null;
  }
  const json = await res.json();
  const content = Buffer.from(json.content.replace(/\n/g,''), 'base64').toString('utf8');
  return { data: JSON.parse(content), sha: json.sha };
}

async function saveDataJson(data, sha){
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`,
    {
      method: 'PUT',
      headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, Accept:'application/vnd.github+json', 'Content-Type':'application/json' },
      body: JSON.stringify({ message:'Bot: actualizar tareas', content, sha, branch:'main' })
    }
  );
  // CAMBIO CLAVE: antes no se chequeaba res.ok y el error se tragaba en silencio.
  if(!res.ok){
    const errText = await res.text().catch(()=> '');
    throw new Error(`PUT data.json ${res.status}: ${errText.slice(0,200)}`);
  }
  return res.json();
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
  if(!uploadRes.ok){
    console.error('AssemblyAI upload falló:', uploadRes.status, await uploadRes.text().catch(()=>''));
    return null;
  }
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
    if(poll.status === 'error'){ console.error('AssemblyAI error:', poll.error); break; }
  }
  return text;
}

// Detecta el proyecto mencionado. Devuelve { projectId, detected }.
// Compara contra el texto normal Y contra una versión sin espacios,
// para que "chile autos data bot" matchee con "chileautos databot".
function detectProject(transcription, projects){
  const normText = norm(transcription);
  const collapsed = normText.replace(/\s+/g, ''); // "chile autos" -> "chileautos"

  let projectId = null;
  let bestScore = 0;

  for(const p of projects){
    const words = norm(p.name).split(/\s+/).filter(w => w.length > 3);
    let score = 0;
    for(const w of words){
      if(normText.includes(w) || collapsed.includes(w)) score++;
    }
    if(score > bestScore){ bestScore = score; projectId = p.id; }
  }

  const detected = bestScore > 0;
  if(!projectId){
    projectId = projects.find(p => p.status === 'active')?.id || projects[0]?.id;
  }
  return { projectId, detected };
}

// Detecta fecha y hora mencionadas en el texto.
function detectDateTime(transcription){
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

  // hora: comparamos sobre texto sin tildes
  const timeMatch = norm(transcription).match(/(\d{1,2})\s*(de la manana|am|de la tarde|pm|de la noche|del mediodia|del medio dia|del dia)/);
  if(timeMatch){
    let hour = parseInt(timeMatch[1]);
    const period = timeMatch[2];
    if(period.includes('tarde') || period.includes('noche') || period === 'pm'){
      hour = hour < 12 ? hour + 12 : hour;
    } else if(period.includes('manana') || period === 'am'){
      hour = (hour === 12 ? 0 : hour);
    } else if(period.includes('medio') || period.includes('dia')){
      hour = 12;
    }
    dueTime = `${String(hour).padStart(2,'0')}:00`;
  }

  return { due, dueTime };
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

  // leer datos
  const result = await getDataJson();
  if(!result){ await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: '❌ No pude leer los datos de Kingdom.' }); return; }
  const { data, sha } = result;

  const { projectId, detected } = detectProject(transcription, data.projects);
  const { due, dueTime } = detectDateTime(transcription);

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

  // CAMBIO CLAVE: si el guardado falla, avisamos en vez de mentir con un "✅".
  try {
    await saveDataJson(data, sha);
  } catch(err){
    console.error('Error guardando tarea:', err.message);
    await tg('sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: `❌ Transcribí el audio pero NO pude guardar la tarea en GitHub.\n\nError: \`${err.message}\`\n\n_${transcription}_`,
      parse_mode: 'Markdown'
    });
    return;
  }

  const p = data.projects.find(p=>p.id===projectId);
  const aviso = detected ? '' : '\n\n⚠️ _No detecté el proyecto en el audio; lo asigné por defecto. Corregilo en el dashboard._';
  await tg('sendMessage', {
    chat_id: TELEGRAM_CHAT_ID,
    text: `✅ *Tarea creada en "${p?.name}"*\n\n_${transcription}_\n\n📅 Vence: ${formatDate(due)} ${dueTime}${aviso}`,
    parse_mode: 'Markdown'
  });
}

// ====== PROCESAR MENSAJES ENTRANTES ======
async function processUpdates(){
  // leer offset guardado (en el runner de Actions /tmp se borra entre corridas,
  // por eso al final confirmamos los updates a Telegram para no reprocesarlos)
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

  // CAMBIO: confirmar a Telegram que ya procesamos estos updates.
  // Sin esto, la próxima corrida (con /tmp borrado) los volvería a procesar -> tareas duplicadas.
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=1`).catch(()=>{});
}

// ====== MAIN ======
(async()=>{
  console.log('Kingdom Bot iniciando...');
  await checkOverdue();
  await processUpdates();
  console.log('Kingdom Bot finalizado.');
})();
