const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const DATA_PATH = 'data.json';

// Modelo de Groq. Si algun dia falla con "model not found", revisa
// console.groq.com/docs/models y reemplaza este nombre por uno vigente.
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ====== HELPERS ======
function tg(method, body){
  return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(r=>r.json());
}

function norm(s){
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function getDataJson(){
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`,
    { headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, Accept:'application/vnd.github+json' } }
  );
  if(!res.ok){
    console.error('getDataJson fallo:', res.status, await res.text().catch(()=>''));
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

  let msg = '\u{1F981} *Kingdom \u2014 Resumen diario*\n\n';

  if(overdue.length > 0){
    msg += `\u26A0\uFE0F *VENCIDAS (${overdue.length})*\n`;
    overdue.forEach(t => {
      const p = data.projects.find(p=>p.id===t.projectId);
      msg += `\u2022 ${t.text} \u2014 _${p?p.name:'?'}_ \u2014 Vencida el ${formatDate(t.dueDate)}\n`;
    });
    msg += '\n';
  }

  if(dueTomorrow.length > 0){
    msg += `\u{1F4C5} *VENCEN MANANA (${dueTomorrow.length})*\n`;
    dueTomorrow.forEach(t => {
      const p = data.projects.find(p=>p.id===t.projectId);
      msg += `\u2022 ${t.text} \u2014 _${p?p.name:'?'}_\n`;
    });
    msg += '\n';
  }

  if(overdue.length === 0 && dueTomorrow.length === 0){
    msg += '\u2705 Todo al dia, sin vencimientos pendientes.';
  }

  msg += `\n\u{1F517} [Abrir Kingdom](https://notclassic.github.io/Kingdom/dashboard.html)`;

  await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' });
  console.log('Alerta enviada');
}

// ====== TRANSCRIPCION DE AUDIO (AssemblyAI) ======
async function transcribeAudio(fileUrl){
  const audioRes = await fetch(fileUrl);
  const audioBuffer = await audioRes.buffer();
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_KEY, 'content-type': 'application/octet-stream' },
    body: audioBuffer
  });
  if(!uploadRes.ok){
    console.error('AssemblyAI upload fallo:', uploadRes.status, await uploadRes.text().catch(()=>''));
    return null;
  }
  const { upload_url } = await uploadRes.json();

  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, language_code: 'es' })
  });
  const { id } = await transcriptRes.json();

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

// ====== PARSEO DEL TEXTO CON GROQ ======
async function parseWithGroq(transcription, data){
  const today = new Date().toISOString().slice(0,10);
  const projectsList = (data.projects||[])
    .map(p=>`- id ${p.id}: "${p.name}" (${p.context||'profesional'})`).join('\n') || '(ninguno)';
  const areasList = (data.areas||[]).map(a=>`"${a.name}"`).join(', ') || '(ninguna)';

  const system = 'Convertis instrucciones dadas por voz en espanol a un objeto JSON. Respondes SOLO con el JSON, sin ningun texto adicional, sin explicaciones y sin comillas de codigo.';

  const user = `Fecha de hoy: ${today}

Proyectos existentes:
${projectsList}

Areas disponibles: ${areasList}

Transcripcion del audio:
"${transcription}"

Devolve un JSON con esta forma exacta:
{
  "project_existing_id": "id de un proyecto de la lista si la tarea claramente pertenece a uno; null si ninguno",
  "project_create": "true SOLO si el usuario pide explicitamente crear un proyecto nuevo que no esta en la lista; si no false",
  "project_name": "nombre del proyecto mencionado, limpio (ej: Dentista); null si no menciona ninguno",
  "project_context": "personal o profesional si lo dice; null si no",
  "project_area": "el nombre de area mas parecido de la lista de areas; null si ninguno aplica",
  "task_text": "solo la accion a realizar, sin la parte del proyecto ni la fecha (ej: agendar hora); cadena vacia si solo se pide crear un proyecto",
  "due_date": "fecha de vencimiento YYYY-MM-DD resolviendo expresiones relativas respecto a la fecha de hoy (manana = hoy+1, pasado manana = hoy+2, en N dias = hoy+N); null si no menciona fecha",
  "due_time": "hora HH:MM en formato 24hs si la menciona (9 de la manana = 09:00, 4 de la tarde = 16:00, 12 del dia = 12:00); null si no menciona hora"
}`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST',
    headers:{ Authorization:`Bearer ${GROQ_API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [ {role:'system', content: system}, {role:'user', content: user} ]
    })
  });
  if(!res.ok){
    throw new Error(`Groq ${res.status}: ${(await res.text().catch(()=>'')).slice(0,200)}`);
  }
  const out = await res.json();
  let content = out.choices?.[0]?.message?.content || '{}';
  content = content.replace(/```json/g,'').replace(/```/g,'').trim();
  return JSON.parse(content);
}

function createProjectObject(name, context, areaName, areas){
  let area = null;
  if(areaName){
    const an = norm(areaName);
    area = areas.find(a => { const n = norm(a.name); return n.includes(an) || an.includes(n); });
  }
  const ctx = context || (area && area.context) || 'profesional';
  return {
    id: 'p' + Date.now(),
    name: String(name).trim(),
    area: area ? area.id : '',
    context: ctx,
    color: (area && area.color) ? area.color : '#007aff',
    description: '',
    status: 'active',
    driveUrl: '',
    icon: '',
    contacts: [],
    hasLeads: false,
    driveFolderId: ''
  };
}

async function handleAudio(message){
  const voice = message.voice || message.audio;
  if(!voice) return;

  await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: '\u{1F399}\uFE0F Transcribiendo tu audio...' });

  const fileInfo = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${voice.file_id}`).then(r=>r.json());
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.result.file_path}`;

  const transcription = await transcribeAudio(fileUrl);
  if(!transcription){
    await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: '\u274C No pude transcribir el audio. Intenta de nuevo.' });
    return;
  }

  const result = await getDataJson();
  if(!result){ await tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text: '\u274C No pude leer los datos de Kingdom.' }); return; }
  const { data, sha } = result;

  // parsear con Groq (si falla, seguimos con defaults y avisamos)
  let parsed = null, groqError = null;
  try { parsed = await parseWithGroq(transcription, data); }
  catch(err){ groqError = err.message; console.error('Groq parse fallo:', err.message); }

  // resolver el proyecto destino
  let projectId = null, createdProject = null;
  if(parsed){
    if(parsed.project_existing_id && data.projects.some(p=>p.id===parsed.project_existing_id)){
      projectId = parsed.project_existing_id;
    }
    if(!projectId && parsed.project_name){
      const target = norm(parsed.project_name);
      const tc = target.replace(/\s+/g,'');
      const found = data.projects.find(p=>{
        const pn = norm(p.name); const pc = pn.replace(/\s+/g,'');
        return pn===target || pc===tc || pn.includes(target) || target.includes(pn);
      });
      if(found) projectId = found.id;
    }
    if(!projectId && (parsed.project_create === true || parsed.project_create === 'true') && parsed.project_name){
      createdProject = createProjectObject(parsed.project_name, parsed.project_context, parsed.project_area, data.areas||[]);
      data.projects.push(createdProject);
      projectId = createdProject.id;
    }
  }
  const projectDetected = !!projectId;
  if(!projectId) projectId = data.projects.find(p=>p.status==='active')?.id || data.projects[0]?.id;

  const taskText = (parsed && parsed.task_text && String(parsed.task_text).trim())
    ? String(parsed.task_text).trim() : transcription;
  const due = (parsed && parsed.due_date) ? parsed.due_date
    : new Date(Date.now()+86400000).toISOString().slice(0,10);
  const dueTime = (parsed && parsed.due_time) ? parsed.due_time : '12:00';

  const newTask = {
    id: 't' + Date.now(),
    projectId,
    text: taskText,
    done: false,
    dueDate: due,
    dueTime: dueTime,
    priority: 'medium',
    emailAlert: false,
    alertSent: false,
    driveUrl: ''
  };
  data.tasks.push(newTask);

  // guardar (si falla, avisar en vez de mentir con un OK)
  try {
    await saveDataJson(data, sha);
  } catch(err){
    console.error('Error guardando tarea:', err.message);
    await tg('sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: `\u274C Transcribi el audio pero NO pude guardar en GitHub.\n\nError: \`${err.message}\`\n\n_${transcription}_`,
      parse_mode: 'Markdown'
    });
    return;
  }

  const p = data.projects.find(p=>p.id===projectId);
  let header = createdProject
    ? `\u{1F195} *Proyecto nuevo: "${createdProject.name}"* (${createdProject.context})\n\u2705 *Tarea creada adentro*`
    : `\u2705 *Tarea creada en "${p?.name}"*`;

  let avisos = '';
  if(createdProject && !createdProject.area) avisos += '\n\n\u26A0\uFE0F _Asigna el area del proyecto nuevo en el dashboard._';
  if(!projectDetected && !createdProject) avisos += '\n\n\u26A0\uFE0F _No detecte el proyecto; lo asigne por defecto. Corregilo en el dashboard._';
  if(groqError) avisos += `\n\n\u26A0\uFE0F _No pude estructurar el audio (Groq: ${groqError}). Guarde el texto crudo._`;

  await tg('sendMessage', {
    chat_id: TELEGRAM_CHAT_ID,
    text: `${header}\n\n_${taskText}_\n\n\u{1F4C5} Vence: ${formatDate(due)} ${dueTime}${avisos}`,
    parse_mode: 'Markdown'
  });
}

// ====== PROCESAR MENSAJES ENTRANTES ======
async function processUpdates(){
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
        text: `\u{1F981} Kingdom Bot activo.\n\nMandame un *audio* para crear una tarea por voz.\nRecibis el resumen diario automaticamente a las 9:00 AM.`,
        parse_mode: 'Markdown'
      });
    }
  }
  fs.writeFileSync('/tmp/tg_offset.txt', String(offset));

  // confirmar a Telegram que ya procesamos estos updates (evita duplicados en la proxima corrida)
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=1`).catch(()=>{});
}

// ====== MAIN ======
(async()=>{
  console.log('Kingdom Bot iniciando...');
  await checkOverdue();
  await processUpdates();
  console.log('Kingdom Bot finalizado.');
})();
