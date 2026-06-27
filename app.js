/* ====== CONFIGURACIÓN DE ÁREAS ====== */
function renderAreaSettings(){
  renderGoogleSection();
  const autoInfo = document.getElementById('githubAutoSyncInfo');
  if(getGithubToken()){
    document.getElementById('githubTokenInput').placeholder = '✓ Token guardado (oculto)';
    if(autoInfo) autoInfo.textContent = '🔄 Auto-sync activo: descarga al abrir, sube ~4s después de cada cambio.';
  }else if(autoInfo){
    autoInfo.textContent = '';
  }
  const cont = document.getElementById('areaSettings');
  // separar por contexto
  const proAreas = data.areas.filter(a=>(a.context||'profesional')==='profesional');
  const perAreas = data.areas.filter(a=>a.context==='personal');

  const renderArea = a => {
    const count = data.projects.filter(p=>p.area===a.id).length;
    const isPro = (a.context||'profesional')==='profesional';
    return `
    <div class="row" style="--accent-color:${a.color}; grid-template-columns:1fr; gap:6px; align-items:start;">
      <div style="min-width:0;">
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="color" value="${a.color}" class="color-dot" title="Cambiar color"
                 onchange="editAreaColor('${a.id}', this.value)">
          <div class="row-name" contenteditable="true" spellcheck="false"
               onblur="editAreaName('${a.id}', this.textContent)"
               onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}"
               title="Click para editar el nombre" style="flex:1; min-width:0;">${a.name}</div>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:6px;">
          <div class="row-desc">${count} proyecto${count===1?'':'s'}</div>
          <button class="priority-btn ${isPro?'active':''}" data-area-ctx="profesional"
            onclick="editAreaContext('${a.id}','profesional')"
            style="padding:2px 8px; font-size:.65rem; min-width:0;">💼 Prof.</button>
          <button class="priority-btn ${!isPro?'active':''}" data-area-ctx="personal"
            onclick="editAreaContext('${a.id}','personal')"
            style="padding:2px 8px; font-size:.65rem; min-width:0;">🏠 Pers.</button>
          <button class="danger" onclick="deleteArea('${a.id}')"
            style="padding:2px 10px; font-size:.65rem; border-radius:999px; border:1px solid var(--red); background:transparent; color:var(--red); cursor:pointer;">🗑</button>
        </div>
      </div>
    </div>`;
  };

  cont.innerHTML =
    `<div class="row-desc" style="font-weight:700; margin-bottom:6px;">💼 Profesional</div>` +
    proAreas.map(renderArea).join('') +
    `<div class="row-desc" style="font-weight:700; margin:14px 0 6px;">🏠 Personal</div>` +
    perAreas.map(renderArea).join('') +
    `<button class="btn-toggle" onclick="addArea()">+ Nueva categoría</button>`;

  // proyectos: color + contactos en una sola fila
  const projCont = document.getElementById('projectColorSettings');
  projCont.innerHTML = data.projects.map(p=>{
    const area = areaInfo(p.area);
    const contacts = p.contacts.map((c,i)=>`
      <div class="checkrow" style="justify-content:space-between; padding:4px 0;">
        <span style="color:var(--text);">${c.name ? c.name+' · ' : ''}${c.email}</span>
        <button class="task-del" onclick="removeContact('${p.id}', ${i})">✕</button>
      </div>`).join('') || '<div class="empty" style="padding:4px 0; text-align:left;">Sin contactos vinculados.</div>';
    return `
    <div class="row" style="--accent-color:${p.color}; grid-template-columns:24px 1fr 60px; align-items:start;">
      <div></div>
      <div>
        <div class="row-name" style="margin-bottom:2px;">${p.name}</div>
        <div class="area-tag" style="background:${area.color}22; color:${area.color}; margin-bottom:6px;">${area.name}</div>
        ${contacts}
        <div class="row2" style="margin-top:8px;">
          <input type="text" placeholder="Nombre (opcional)" id="cname-${p.id}">
          <input type="email" placeholder="email@ejemplo.com" id="cemail-${p.id}">
          <button class="btn-toggle" style="margin-top:0;" onclick="addContact('${p.id}')">+ Agregar</button>
        </div>
        <input type="text" placeholder="Carpeta de Drive (ID, opcional)" value="${p.driveFolderId}"
               style="margin-top:6px;" onblur="editDriveFolder('${p.id}', this.value)"
               onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}">
      </div>
      <input type="color" value="${p.color}" style="height:36px; padding:2px; cursor:pointer;"
             onchange="editProjectColor('${p.id}', this.value)">
    </div>`;
  }).join('');
}
function addArea(){
  const name = prompt('Nombre de la nueva categoría:');
  if(!name || !name.trim()) return;
  const colors = ['#007aff','#34c759','#af52de','#ff9f0a','#ff3b30','#5856d6','#00c7be','#ff2d55','#8e8e93'];
  const color = colors[data.areas.length % colors.length];
  data.areas.push({id:uid('a'), name:name.trim(), color});
  save(); renderAll(); renderAreaSettings();
}
function editProjectColor(id, newColor){
  const p = projectInfo(id);
  p.color = newColor;
  save(); renderAll(); renderAreaSettings();
}
function editAreaName(id, newName){
  const name = newName.trim();
  if(!name) { renderAreaSettings(); return; }
  const area = data.areas.find(a=>a.id===id);
  area.name = name;
  save(); renderAll(); renderAreaSettings();
}
function editAreaColor(id, newColor){
  const area = data.areas.find(a=>a.id===id);
  area.color = newColor;
  save(); renderAll(); renderAreaSettings();
}
function editAreaContext(id, ctx){
  const area = data.areas.find(a=>a.id===id);
  if(!area) return;
  area.context = ctx;
  save(); renderAll(); renderAreaSettings();
}
function deleteArea(id){
  const count = data.projects.filter(p=>p.area===id).length;
  if(count > 0){ alert(`No se puede eliminar: tiene ${count} proyecto${count===1?'':'s'} asignado${count===1?'':'s'}. Movelos a otra área primero.`); return; }
  if(!confirm('¿Eliminar esta categoría?')) return;
  data.areas = data.areas.filter(a=>a.id!==id);
  data.deletedAreaIds = data.deletedAreaIds || [];
  if(!data.deletedAreaIds.includes(id)) data.deletedAreaIds.push(id);
  save(); renderAll(); renderAreaSettings();
}
function editProjectArea(id, areaId){
  const p = data.projects.find(x=>x.id===id);
  if(!p) return;
  p.area = areaId;
  const ai = areaInfo(areaId);
  if(ai && ai.context) p.context = ai.context;
  save(); renderAll();
}
function _areaOptions(sel){
  const ctxs = [['profesional','Profesional'],['personal','Personal'],['otro','Otro']];
  let html = '';
  ctxs.forEach(([c,label])=>{
    const as = data.areas.filter(a=>(a.context||'profesional')===c);
    if(!as.length) return;
    html += `<optgroup label="${label}">` + as.map(a=>`<option value="${a.id}" ${a.id===sel?'selected':''}>${a.name}</option>`).join('') + `</optgroup>`;
  });
  return html;
}

/* ====== CONTACTOS POR PROYECTO ====== */
function addContact(projectId){
  const name = document.getElementById(`cname-${projectId}`).value.trim();
  const email = document.getElementById(`cemail-${projectId}`).value.trim();
  if(!email){ alert('Falta el email del contacto'); return; }
  const p = projectInfo(projectId);
  p.contacts.push({name, email});
  save(); renderAreaSettings();
}
function removeContact(projectId, idx){
  const p = projectInfo(projectId);
  p.contacts.splice(idx, 1);
  save(); renderAreaSettings();
}
function editDriveFolder(projectId, value){
  const p = projectInfo(projectId);
  p.driveFolderId = value.trim();
  save();
}

/* ====== TABS ====== */
let _currentTab = 'main';
function setTab(tab){
  _currentTab = tab;
  document.getElementById('tab-main').style.display = tab==='main' ? '' : 'none';
  document.getElementById('tab-leads').style.display = tab==='leads' ? '' : 'none';
  document.getElementById('tab-tasks').style.display = tab==='tasks' ? '' : 'none';
  document.getElementById('tab-settings').style.display = tab==='settings' ? '' : 'none';
  document.querySelectorAll('.tab').forEach((el,i)=>{
    el.classList.toggle('active', (i===0 && tab==='main') || (i===1 && tab==='tasks') || (i===2 && tab==='leads') || (i===3 && tab==='settings'));
  });
  updateAppMenuActive();
  if(tab==='leads') renderLeadProjects();
  if(tab==='tasks' && calView) renderCalendar();
  if(tab==='settings') renderAreaSettings();
}
function toggleAppMenu(e){
  if(e) e.stopPropagation();
  const m = document.getElementById('appMenu');
  if(m.classList.contains('open')){ closeAppMenu(); return; }
  const btn = document.getElementById('hamburgerBtn');
  if(btn){
    const r = btn.getBoundingClientRect();
    m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    m.style.left = 'auto';
    if(r.top > window.innerHeight/2){
      m.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      m.style.top = 'auto';
    } else {
      m.style.top = (r.bottom + 6) + 'px';
      m.style.bottom = 'auto';
    }
  }
  updateAppMenuActive();
  m.classList.add('open');
  document.getElementById('appMenuOverlay').classList.add('open');
}
function closeAppMenu(){
  document.getElementById('appMenu').classList.remove('open');
  document.getElementById('appMenuOverlay').classList.remove('open');
}
function setTabFromMenu(tab){ setTab(tab); closeAppMenu(); }
function updateAppMenuActive(){
  document.querySelectorAll('.appmenu-item').forEach(b=> b.classList.toggle('active', b.dataset.tab===_currentTab));
}
let _lastScrollY = 0, _barTick = false;
function _updateBarShrink(){
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const bar = document.getElementById('bottomNav');
  const hdr = document.getElementById('appHeader');
  // histéresis por posición: achica pasando 140px, vuelve bajo 70px.
  // La banda ancha (70px) evita que tiemble con micro-movimientos del scroll.
  if(y > 140){
    if(bar) bar.classList.add('shrink');
    if(hdr) hdr.classList.add('collapsed');
  } else if(y < 70){
    if(bar) bar.classList.remove('shrink');
    if(hdr) hdr.classList.remove('collapsed');
  }
  _barTick = false;
}
window.addEventListener('scroll', function(){ if(!_barTick){ _barTick=true; requestAnimationFrame(_updateBarShrink); } }, {passive:true});

/* ====== DATOS INICIALES ====== */
const DEFAULT_AREAS = [
  {id:'a1', name:'Inteligencia & Software', color:'#007aff', context:'profesional'},
  {id:'a2', name:'Operaciones Comerciales & Trading', color:'#34c759', context:'profesional'},
  {id:'a3', name:'Clientes & Agencia', color:'#af52de', context:'profesional'}
];
const PERSONAL_AREAS = [
  {id:'pa1', name:'👨‍👩‍👧 Familia', color:'#ff6b6b', context:'personal'},
  {id:'pa2', name:'🏥 Salud', color:'#2a9d8f', context:'personal'},
  {id:'pa3', name:'🏠 Hogar', color:'#f5ac2f', context:'personal'},
  {id:'pa4', name:'💰 Finanzas Personales', color:'#1d4ed8', context:'personal'},
  {id:'pa5', name:'✈️ Viajes', color:'#af52de', context:'personal'}
];
const IDEAS_PROJECT = {id:'inbox', color:'#8a919e', name:'💡 Ideas', area:null, desc:'Ideas sueltas y recordatorios rápidos.', status:'active', hasLeads:false, context:'otro'};

const DEFAULT_DATA = {
  areas: JSON.parse(JSON.stringify(DEFAULT_AREAS)),
  projects: [
    {id:'p1', color:'#007aff', name:'Chileautos Databot', area:'a1', desc:'Analítica interna con potencial SaaS futuro.', status:'active', hasLeads:false},
    {id:'p2', color:'#5856d6', name:'Chatbot IA', area:'a1', desc:'Desarrollo y prospección por rubro.', status:'active', hasLeads:true},
    {id:'p3', color:'#34c759', name:'Aprendizaje Claude', area:'a1', desc:'I+D y capacitación continua en automatizaciones.', status:'active', hasLeads:false},
    {id:'p4', color:'#ff9f0a', name:'Compra y Venta de Autos', area:'a2', desc:'Operación de trading alimentada por el Databot.', status:'active', hasLeads:false},
    {id:'p5', color:'#ff3b30', name:'Pintura a Domicilio', area:'a2', desc:'Servicio presencial / alianza con taller.', status:'active', hasLeads:false},
    {id:'p6', color:'#00c7be', name:'Venta Ecommerce', area:'a2', desc:'Operación general de venta online.', status:'active', hasLeads:false},
    {id:'p7', color:'#a2845e', name:'Mankeleathers', area:'a2', desc:'E-commerce de bolsos de cuero, reactivación.', status:'active', hasLeads:false},
    {id:'p8', color:'#ff2d55', name:'Jibplaza', area:'a2', desc:'Módulos de snowpark, web y catálogo.', status:'active', hasLeads:false},
    {id:'p9', color:'#af52de', name:'Grupo Arte', area:'a3', desc:'Cliente NotClassic: PPT, Ads, cobros.', status:'active', hasLeads:true},
    {id:'p10', color:'#8e8e93', name:'NotClassic', area:'a3', desc:'Optimización del sitio principal.', status:'active', hasLeads:false}
  ],
  tasks: [
    {id:'t1', projectId:'p1', text:'Configurar alertas de oportunidades de compra (bajo km, baratos, único dueño, nicho)', done:false, dueDate:'2026-06-16', emailAlert:false, alertSent:false},
    {id:'t2', projectId:'p1', text:'Configurar alertas de información de la industria', done:false, dueDate:'2026-06-18', emailAlert:false, alertSent:false},
    {id:'t3', projectId:'p2', text:'Generar email de salida', done:false, dueDate:'2026-06-15', emailAlert:false, alertSent:false},
    {id:'t4', projectId:'p2', text:'Armar listado de rubros', done:false, dueDate:'2026-06-15', emailAlert:false, alertSent:false},
    {id:'t5', projectId:'p2', text:'Buscar leads por rubro', done:false, dueDate:'2026-06-17', emailAlert:false, alertSent:false},
    {id:'t6', projectId:'p2', text:'Preparar bot por rubro', done:false, dueDate:'2026-06-19', emailAlert:false, alertSent:false},
    {id:'t7', projectId:'p3', text:'Pruebas e investigación de automatizaciones con Claude', done:false, dueDate:'2026-06-20', emailAlert:false, alertSent:false},
    {id:'t8', projectId:'p4', text:'Evaluar alertas de oportunidades', done:false, dueDate:'2026-06-16', emailAlert:false, alertSent:false},
    {id:'t9', projectId:'p4', text:'Gestionar capital y ofertas de compra', done:false, dueDate:'2026-06-22', emailAlert:false, alertSent:false},
    {id:'t10', projectId:'p4', text:'Preparar y vender vehículos', done:false, dueDate:'2026-06-25', emailAlert:false, alertSent:false},
    {id:'t11', projectId:'p5', text:'Redactar plan de negocio de pintura', done:false, dueDate:'2026-06-17', emailAlert:false, alertSent:false},
    {id:'t12', projectId:'p5', text:'Agendar reunión con dueño del taller', done:false, dueDate:'2026-06-19', emailAlert:false, alertSent:false},
    {id:'t13', projectId:'p5', text:'Proponer modelo de negocio', done:false, dueDate:'2026-06-23', emailAlert:false, alertSent:false},
    {id:'t14', projectId:'p6', text:'Crear/optimizar publicaciones', done:false, dueDate:'2026-06-15', emailAlert:false, alertSent:false},
    {id:'t15', projectId:'p6', text:'Hacer web scraping de competidores', done:false, dueDate:'2026-06-18', emailAlert:false, alertSent:false},
    {id:'t16', projectId:'p6', text:'Captar leads', done:false, dueDate:'2026-06-21', emailAlert:false, alertSent:false},
    {id:'t17', projectId:'p7', text:'Reactivar web y plataforma ecommerce', done:false, dueDate:'2026-06-24', emailAlert:false, alertSent:false},
    {id:'t18', projectId:'p7', text:'Definir estrategia de marketing para liquidar stock', done:false, dueDate:'2026-06-26', emailAlert:false, alertSent:false},
    {id:'t19', projectId:'p8', text:'Crear página web desde cero', done:false, dueDate:'2026-06-20', emailAlert:false, alertSent:false},
    {id:'t20', projectId:'p8', text:'Actualizar catálogo de productos', done:false, dueDate:'2026-06-22', emailAlert:false, alertSent:false},
    {id:'t21', projectId:'p8', text:'Prospectar clientes potenciales', done:false, dueDate:'2026-06-27', emailAlert:false, alertSent:false},
    {id:'t22', projectId:'p9', text:'Diseñar presentaciones (PPT)', done:false, dueDate:'2026-06-16', emailAlert:false, alertSent:false},
    {id:'t23', projectId:'p9', text:'Gestionar campañas de Google Ads', done:false, dueDate:'2026-06-19', emailAlert:false, alertSent:false},
    {id:'t24', projectId:'p9', text:'Control y seguimiento de cobros', done:false, dueDate:'2026-06-30', emailAlert:false, alertSent:false},
    {id:'t25', projectId:'p10', text:'Arreglar y optimizar el sitio notclassic.com', done:false, dueDate:'2026-06-23', emailAlert:false, alertSent:false}
  ],
  leads: [
    {id:'l1', name:'Bodega Mar y Tierra', projectId:'p2', stage:'contactados'},
    {id:'l2', name:'California', projectId:'p2', stage:'contactados'},
    {id:'l3', name:'Grupo Arte', projectId:'p9', stage:'ganados'}
  ]
};

const STAGES = [
  {id:'descubiertos', name:'Descubiertos / Scrapping', color:'#8e8e93'},
  {id:'contactados', name:'Contactados', color:'#007aff'},
  {id:'negociacion', name:'En Negociación', color:'#ff9f0a'},
  {id:'ganados', name:'Cerrados / Ganados', color:'#34c759'}
];

/* ====== CONFIGURACIÓN EMAILJS ====== */
/* Para activar el envío de correos por tarea vencida:
   1. Creá una cuenta gratuita en https://www.emailjs.com
   2. Configurá un Email Service (ej. Gmail) y copiá el SERVICE_ID
   3. Creá un Template con variables {{task_text}}, {{project_name}}, {{due_date}}, {{to_email}}
      y copiá el TEMPLATE_ID
   4. En Account > General copiá tu PUBLIC_KEY
   5. Pegá los 3 valores abajo y tu email de destino en TO_EMAIL */
const EMAILJS_CONFIG = {
  SERVICE_ID: '',
  TEMPLATE_ID: '',
  PUBLIC_KEY: '',
  TO_EMAIL: ''
};
const EMAILJS_READY = EMAILJS_CONFIG.SERVICE_ID && EMAILJS_CONFIG.TEMPLATE_ID && EMAILJS_CONFIG.PUBLIC_KEY && EMAILJS_CONFIG.TO_EMAIL;

/* ====== CONFIGURACIÓN GOOGLE DRIVE ====== */
/* Para activar "Conectar Google Drive":
   1. console.cloud.google.com -> proyecto nuevo -> habilitar "Google Drive API"
   2. Credenciales -> crear OAuth Client ID (tipo "Aplicación web")
   3. En "Orígenes de JavaScript autorizados" agregar la URL donde hosteás este dashboard
      (https://, no file://)
   4. Pegar el Client ID acá abajo (termina en .apps.googleusercontent.com)
   5. La cuenta contacto@notclassic.com debe ser la que uses para iniciar sesión
      cuando aparezca el popup de Google */
const GOOGLE_CONFIG = {
  CLIENT_ID: '',
  SCOPES: 'https://www.googleapis.com/auth/drive.readonly'
};
const GOOGLE_READY = !!GOOGLE_CONFIG.CLIENT_ID;
let googleToken = null;
if(EMAILJS_READY && typeof emailjs !== 'undefined'){ emailjs.init(EMAILJS_CONFIG.PUBLIC_KEY); }

/* ====== CONFIGURACIÓN SINCRONIZACIÓN CON GITHUB ====== */
/* Repo donde se guarda data.json. El token NO se guarda en este archivo,
   se ingresa una vez y queda en localStorage de ese navegador (GITHUB_TOKEN_KEY). */
const GITHUB_CONFIG = {
  OWNER: 'notclassic',
  REPO: 'Kingdom',
  PATH: 'data.json',
  BRANCH: 'main'
};
const GITHUB_TOKEN_KEY = 'github_pat_dashboard';
function getGithubToken(){ return localStorage.getItem(GITHUB_TOKEN_KEY) || ''; }
function setGithubToken(t){ localStorage.setItem(GITHUB_TOKEN_KEY, t); }
function ghApiUrl(){ return `https://api.github.com/repos/${GITHUB_CONFIG.OWNER}/${GITHUB_CONFIG.REPO}/contents/${GITHUB_CONFIG.PATH}`; }
function b64EncodeUnicode(str){
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str){
  return decodeURIComponent(escape(atob(str)));
}

/* ====== ESTADO ====== */
const STORAGE_KEY = 'dashboard_portafolio_v1';
let data = load();
purgeOldTrash();
let activeArea = 'all';
let activeContext = 'all';
let activeProjects = new Set();
let expandedProjects = new Set();
let collapsedProjects = new Set((()=>{ try{ return JSON.parse(localStorage.getItem('kingdom_collapsed')||'[]'); }catch(_){ return []; } })());
function saveCollapsed(){ try{ localStorage.setItem('kingdom_collapsed', JSON.stringify([...collapsedProjects])); }catch(_){} }
let activeLeadsProjects = new Set();
let taskFilter = 'pending';

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(!parsed.areas) parsed.areas = JSON.parse(JSON.stringify(DEFAULT_AREAS));
      // migrate personal areas if not present
      parsed.deletedAreaIds = parsed.deletedAreaIds || []; PERSONAL_AREAS.forEach(pa=>{ if(!parsed.deletedAreaIds.includes(pa.id) && !parsed.areas.find(a=>a.id===pa.id)) parsed.areas.push(pa); });
      // tag existing areas as profesional if missing context
      parsed.areas.forEach(a=>{ if(!a.context) a.context='profesional'; });
      if(!parsed.projects.find(p=>p.id==='inbox')) parsed.projects.push(JSON.parse(JSON.stringify(IDEAS_PROJECT)));
      parsed.projects.forEach(p=>{
        if(!p.color){
          const a = parsed.areas.find(a=>a.id===p.area);
          p.color = a ? a.color : '#007aff';
        }
        if(p.driveUrl===undefined) p.driveUrl='';
        if(p.icon===undefined) p.icon='';
        if(!p.contacts) p.contacts=[];
        if(p.driveFolderId===undefined) p.driveFolderId='';
        if(!p.context) p.context='profesional';
      });
      assignDefaultTimes(parsed.tasks);
      if(!parsed.deletedTaskIds) parsed.deletedTaskIds = [];
      if(!parsed.deletedProjectIds) parsed.deletedProjectIds = [];
      if(!parsed.trash) parsed.trash = [];
      if(!parsed.alertConfig) parsed.alertConfig = {high:30, medium:60, low:120};
      return parsed;
    }
  }catch(e){}
  const def = JSON.parse(JSON.stringify(DEFAULT_DATA));
  assignDefaultTimes(def.tasks);
  def.deletedTaskIds = [];
  def.deletedProjectIds = [];
  def.trash = [];
  def.alertConfig = {high:30, medium:60, low:120};
  return def;
}
function assignDefaultTimes(tasks){
  const byDate = {};
  tasks.forEach(t=>{
    if(t.dueTime===undefined) t.dueTime='';
    if(t.driveUrl===undefined) t.driveUrl='';
    if(t.priority===undefined) t.priority='medium';
    if(t.dueTime || !t.dueDate) return;
    if(!byDate[t.dueDate]) byDate[t.dueDate] = [];
    byDate[t.dueDate].push(t);
  });
  Object.values(byDate).forEach(group=>{
    group.forEach((t, i)=>{
      const hour = 12 + i;
      t.dueTime = String(hour).padStart(2,'0') + ':00';
    });
  });
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}
function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  try{ localStorage.setItem('kingdom_dirty','1'); }catch(_){}
  // auto-push con fusión: conserva lo que escribió el bot (ver pushToGitHub)
  scheduleAutoPush();
}
function saveGithubToken(){
  const val = document.getElementById('githubTokenInput').value.trim();
  if(!val){ alert('Pegá el token primero.'); return; }
  setGithubToken(val);
  document.getElementById('githubTokenInput').value = '';
  document.getElementById('githubTokenInput').placeholder = '✓ Token guardado (oculto)';
  document.getElementById('githubSyncStatus').textContent = 'Token guardado en este navegador.';
}
/* ====== SINCRONIZACIÓN CON GITHUB (data.json en el repo) ====== */
function applyImportedData(parsed, skipAutoPush){
  if(!parsed.areas) parsed.areas = JSON.parse(JSON.stringify(DEFAULT_AREAS));
  parsed.deletedAreaIds = parsed.deletedAreaIds || []; PERSONAL_AREAS.forEach(pa=>{ if(!parsed.deletedAreaIds.includes(pa.id) && !parsed.areas.find(a=>a.id===pa.id)) parsed.areas.push(pa); });
  parsed.areas.forEach(a=>{ if(!a.context) a.context="profesional"; });
  if(!parsed.projects.find(p=>p.id==='inbox')) parsed.projects.push(JSON.parse(JSON.stringify(IDEAS_PROJECT)));
  parsed.projects.forEach(p=>{
    if(!p.color){ const a = parsed.areas.find(a=>a.id===p.area); p.color = a ? a.color : '#007aff'; }
    if(p.driveUrl===undefined) p.driveUrl='';
    if(p.icon===undefined) p.icon='';
    if(!p.contacts) p.contacts=[];
    if(p.hasLeads===undefined) p.hasLeads=false;
    if(p.driveFolderId===undefined) p.driveFolderId='';
    if(!p.context) p.context='profesional';
  });
  assignDefaultTimes(parsed.tasks);
  if(!parsed.deletedTaskIds) parsed.deletedTaskIds = [];
  if(!parsed.deletedProjectIds) parsed.deletedProjectIds = [];
  if(!parsed.trash) parsed.trash = [];
  if(!parsed.alertConfig) parsed.alertConfig = {high:30, medium:60, low:120};
  data = parsed;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if(!skipAutoPush) scheduleAutoPush();
  activeProjects.clear(); activeLeadsProjects.clear(); expandedProjects.clear();
  activeArea='all'; activeContext='all';
  renderAll();
}
async function pullFromGitHub(silent){
  const token = getGithubToken();
  const banner = document.getElementById('githubSyncStatus');
  if(!token){ if(!silent) alert('Primero guardá tu token de GitHub.'); return; }
  if(banner) banner.textContent = 'Descargando desde GitHub…';
  try{
    const res = await fetch(ghApiUrl()+`?ref=${GITHUB_CONFIG.BRANCH}`, {
      headers:{Authorization:'Bearer '+token, Accept:'application/vnd.github+json'}
    });
    if(res.status===404){
      if(banner) banner.textContent = silent ? '' : 'Todavía no existe data.json en el repo. Usá "Subir datos ahora" para crearlo con lo que tenés acá.';
      return;
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    const content = b64DecodeUnicode(json.content.replace(/\n/g,''));
    const parsed = JSON.parse(content);
    if(!silent && !confirm('Esto va a reemplazar los datos locales por los del repo (última versión subida). Antes guardo un respaldo por las dudas. ¿Continuar?')) { banner.textContent=''; return; }
    saveBackupSnapshot('antes de descargar de GitHub');
    applyImportedData(parsed, true);
    if(banner) banner.textContent = silent ? '✓ Sincronizado con GitHub al abrir.' : '✓ Datos actualizados desde GitHub.';
  }catch(err){
    if(banner) banner.textContent = (silent?'Auto-sync: ':'Error al descargar: ')+err.message;
  }
}
function mergeRepoIntoLocal(repoData){
  // Suma al estado local lo que esté en el repo y no tengamos (ni hayamos borrado).
  // NUNCA elimina ni reemplaza tareas/proyectos locales.
  if(!repoData || !Array.isArray(repoData.tasks)) return false;
  const localTaskIds = new Set(data.tasks.map(t=>t.id));
  const localProjIds = new Set(data.projects.map(p=>p.id));
  const delTasks = new Set(data.deletedTaskIds||[]);
  const delProjs = new Set(data.deletedProjectIds||[]);
  const addTasks = repoData.tasks.filter(t=> !localTaskIds.has(t.id) && !delTasks.has(t.id));
  const addProjects = (repoData.projects||[]).filter(p=> !localProjIds.has(p.id) && !delProjs.has(p.id));
  // Adoptar ediciones hechas por el MCP (Claude) en tareas que YA existen local.
  // Solo afecta tareas con mcpUpdatedAt (campo que escribe unicamente el MCP),
  // asi no se pisa lo del bot ni el resto del estado local.
  const repoTaskById = new Map(repoData.tasks.map(t=>[t.id, t]));
  let mcpChanged = false;
  for(const t of data.tasks){
    const r = repoTaskById.get(t.id);
    if(r && r.mcpUpdatedAt && r.mcpUpdatedAt !== t.mcpUpdatedAt){
      t.done = r.done; t.text = r.text; t.priority = r.priority; t.dueDate = r.dueDate;
      t.result = r.result; t.resultType = r.resultType; t.resultAt = r.resultAt;
      t.mcpUpdatedAt = r.mcpUpdatedAt;
      mcpChanged = true;
    }
  }
  // Adoptar ediciones del MCP en PROYECTOS que YA existen local (nombre/desc).
  // Mismo criterio que tareas: solo si el proyecto del repo trae mcpUpdatedAt distinto.
  const repoProjById = new Map((repoData.projects||[]).map(p=>[p.id, p]));
  for(const p of data.projects){
    const r = repoProjById.get(p.id);
    if(r && r.mcpUpdatedAt && r.mcpUpdatedAt !== p.mcpUpdatedAt){
      p.name = r.name; p.desc = r.desc;
      p.mcpUpdatedAt = r.mcpUpdatedAt;
      mcpChanged = true;
    }
  }
  if(addTasks.length || addProjects.length || mcpChanged){
    data.tasks = [...data.tasks, ...addTasks];
    data.projects = [...data.projects, ...addProjects];
    return true;
  }
  return false;
}
async function autoPullOnLoad(){
  const token = getGithubToken();
  if(!token) return;
  const banner = document.getElementById('githubSyncStatus');
  const hasLocal = (data.tasks && data.tasks.length) ||
                   (data.projects && data.projects.filter(p=>p.id!=='inbox').length);
  try{
    const res = await fetch(ghApiUrl()+`?ref=${GITHUB_CONFIG.BRANCH}`, {
      headers:{Authorization:'Bearer '+token, Accept:'application/vnd.github+json'}
    });
    if(res.status===404){ await pushToGitHub(true); return; }
    if(!res.ok) throw new Error('HTTP '+res.status);
    const gj = await res.json();
    let repoData=null; try{ repoData = JSON.parse(b64DecodeUnicode(gj.content.replace(/\n/g,''))); }catch(_){ repoData=null; }
    if(!hasLocal && repoData){
      // Primer uso en este equipo (no hay nada local): adoptamos lo del repo.
      saveBackupSnapshot('antes de bajar de GitHub (equipo sin datos)');
      applyImportedData(repoData, true);
      if(banner) banner.textContent = '✓ Sincronizado con GitHub al abrir.';
      return;
    }
    // Hay datos locales: NUNCA pisamos. Fusionamos lo que falte y subimos.
    saveBackupSnapshot('antes de fusionar al abrir');
    const changed = mergeRepoIntoLocal(repoData);
    if(changed){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); renderAll(); }
    await pushToGitHub(true);
  }catch(err){
    if(banner) banner.textContent = 'Auto-sync al abrir no pudo conectar ('+err.message+'). Tus datos locales están intactos.';
  }
}
async function pushToGitHub(silent){
  const token = getGithubToken();
  const banner = document.getElementById('githubSyncStatus');
  if(!token){ if(!silent) alert('Primero guardá tu token de GitHub.'); return; }
  if(banner) banner.textContent = silent ? 'Sincronizando…' : 'Subiendo a GitHub…';
  try{
    // 1. leer la versión actual del repo (para sha y para fusionar)
    let sha = undefined;
    let repoData = null;
    const getRes = await fetch(ghApiUrl()+`?ref=${GITHUB_CONFIG.BRANCH}`, {
      headers:{Authorization:'Bearer '+token, Accept:'application/vnd.github+json'}
    });
    if(getRes.ok){
      const gj = await getRes.json();
      sha = gj.sha;
      try{ repoData = JSON.parse(b64DecodeUnicode(gj.content.replace(/\n/g,''))); }catch(e){ repoData = null; }
    } else if(getRes.status !== 404){
      throw new Error('no pude leer la versión del repo (HTTP '+getRes.status+'); no subí para no pisar datos');
    }

    // 2. fusionar: sumar lo que el bot agregó al repo y que no tengo local ni borré
    let payload = data;
    if(repoData && Array.isArray(repoData.tasks)){
      const localTaskIds = new Set(data.tasks.map(t=>t.id));
      const localProjIds = new Set(data.projects.map(p=>p.id));
      const delTasks = new Set(data.deletedTaskIds||[]);
      const delProjs = new Set(data.deletedProjectIds||[]);
      const botTasks = repoData.tasks.filter(t=> !localTaskIds.has(t.id) && !delTasks.has(t.id));
      const botProjects = (repoData.projects||[]).filter(p=> !localProjIds.has(p.id) && !delProjs.has(p.id));
      // Adoptar ediciones del MCP (Claude) sobre tareas existentes antes de subir,
      // para no pisar lo que Claude escribio recien en el repo.
      const repoTaskById = new Map(repoData.tasks.map(t=>[t.id, t]));
      const mergedLocalTasks = data.tasks.map(t=>{
        const r = repoTaskById.get(t.id);
        if(r && r.mcpUpdatedAt && r.mcpUpdatedAt !== t.mcpUpdatedAt){
          return { ...t, done:r.done, text:r.text, priority:r.priority, dueDate:r.dueDate,
                   result:r.result, resultType:r.resultType, resultAt:r.resultAt, mcpUpdatedAt:r.mcpUpdatedAt };
        }
        return t;
      });
      // Adoptar ediciones del MCP sobre PROYECTOS existentes (nombre/desc) antes de subir.
      const repoProjById = new Map((repoData.projects||[]).map(p=>[p.id, p]));
      const mergedLocalProjects = data.projects.map(p=>{
        const r = repoProjById.get(p.id);
        if(r && r.mcpUpdatedAt && r.mcpUpdatedAt !== p.mcpUpdatedAt){
          return { ...p, name:r.name, desc:r.desc, mcpUpdatedAt:r.mcpUpdatedAt };
        }
        return p;
      });
      payload = { ...data, tasks: [...mergedLocalTasks, ...botTasks], projects: [...mergedLocalProjects, ...botProjects] };
    }

    const body = {
      message: 'Actualizar data.json desde el dashboard',
      content: b64EncodeUnicode(JSON.stringify(payload, null, 2)),
      branch: GITHUB_CONFIG.BRANCH
    };
    if(sha) body.sha = sha;

    const putRes = await fetch(ghApiUrl(), {
      method:'PUT',
      headers:{Authorization:'Bearer '+token, Accept:'application/vnd.github+json', 'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if(!putRes.ok){
      const errJson = await putRes.json().catch(()=>({}));
      throw new Error(putRes.status+' '+(errJson.message||''));
    }
    // 3. adoptar el resultado fusionado como estado local (así se ven las tareas del bot)
    if(payload !== data){
      data = payload;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      renderAll();
    }
    if(banner) banner.textContent = silent ? '✓ Sincronizado con GitHub.' : '✓ Datos subidos a GitHub correctamente.';
    try{ localStorage.setItem('kingdom_dirty','0'); }catch(_){}
  }catch(err){
    const m = (err.message||'');
    let txt;
    if(m.includes('401') || m.includes('403')){
      txt = '⚠️ No se pudo subir: el token de GitHub no es válido o venció. Andá a Configuración y pegá uno nuevo. Tus datos están guardados en este navegador y se subirán cuando el token funcione.';
    } else {
      txt = (silent?'Error de auto-sync: ':'Error al subir: ')+m+'. Tus datos locales están intactos.';
    }
    if(banner) banner.textContent = txt;
  }
}
let autoPushTimer = null;
function scheduleAutoPush(){
  if(!getGithubToken()) return;
  if(autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(()=>{ autoPushTimer=null; pushToGitHub(true); }, 600);
}
function flushAutoPush(){
  if(autoPushTimer){ clearTimeout(autoPushTimer); autoPushTimer=null; if(getGithubToken()) pushToGitHub(true); }
}
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) flushAutoPush(); });
window.addEventListener('pagehide', flushAutoPush);

/* ====== RESPALDO: EXPORTAR / IMPORTAR ====== */
function exportData(){
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  a.href = url;
  a.download = `dashboard_backup_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function importData(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!parsed.projects || !parsed.tasks){
        alert('El archivo no parece un respaldo válido de este dashboard.');
        return;
      }
      if(!confirm('Esto va a reemplazar TODOS los datos actuales (proyectos, tareas, leads, configuración) por los del archivo importado. ¿Continuar?')) return;
      applyImportedData(parsed);
      alert('Datos importados correctamente.');
    }catch(err){
      alert('No se pudo leer el archivo: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

/* ====== EXPORT / IMPORT MARKDOWN (asistente IA) ====== */
function _mdEsc(s){ return (s||'').replace(/\r?\n/g,' ').trim(); }
function _priWord(p){ return p==='high'?'alta':(p==='low'?'baja':'media'); }
function _priKey(w){ w=(w||'').toLowerCase(); return w.startsWith('alt')?'high':(w.startsWith('baj')?'low':'medium'); }
function exportMarkdown(){
  const L = [];
  L.push('# Kingdom — Exportación de proyectos');
  L.push('<!--');
  L.push('INSTRUCCIONES PARA LA IA:');
  L.push('- Conservá SIEMPRE los marcadores [[id]] tal cual; no los borres ni los cambies.');
  L.push('- Podés mejorar redacción y ortografía del texto que va DESPUÉS del marcador, y de las descripciones (líneas que empiezan con >).');
  L.push('- Fechas: (fecha: AAAA-MM-DD). Prioridad: (prioridad: alta|media|baja).');
  L.push('- Para AGREGAR algo nuevo usá [[new]] en vez de un id, en el lugar correcto (tarea dentro de su proyecto; subproyecto como ###).');
  L.push('- No cambies la estructura: "## " proyecto, "### " subproyecto, "- [ ] " tarea, "> " descripción.');
  L.push('-->','');
  const byId = {}; data.projects.forEach(p=>byId[p.id]=p);
  const roots = data.projects.filter(p=>p.status!=='done' && (!p.parentId || !byId[p.parentId]));
  function emit(p, level){
    const area = (typeof areaInfo==='function') ? areaInfo(p.area) : null;
    const hd = level>=2 ? '###' : '##';
    L.push(`${hd} [[${p.id}]] ${_mdEsc(p.name)}  (área: ${area?area.name:'—'} · estado: ${p.status||'activo'})`);
    if(p.desc) L.push('> ' + _mdEsc(p.desc));
    if(p.driveUrl) L.push('Drive: ' + p.driveUrl);
    else if(p.driveFolderId) L.push('Drive: https://drive.google.com/drive/folders/' + p.driveFolderId);
    data.tasks.filter(t=>t.projectId===p.id).forEach(t=>{
      let line = `- [${t.done?'x':' '}] [[${t.id}]] ${_mdEsc(t.text)}`;
      if(t.dueDate) line += ` (fecha: ${t.dueDate})`;
      line += ` (prioridad: ${_priWord(t.priority)})`;
      L.push(line);
    });
    L.push('');
    data.projects.filter(c=>c.status!=='done' && c.parentId===p.id).forEach(c=>emit(c, level+1));
  }
  roots.forEach(r=>emit(r,1));
  const blob = new Blob([L.join('\n')], {type:'text/markdown'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  a.href=url; a.download=`kingdom_proyectos_${stamp}.md`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function _parseTaskMeta(rest){
  let dueDate=null, priority='medium';
  const fd = rest.match(/\(fecha:\s*(\d{4}-\d{2}-\d{2})\)/i); if(fd) dueDate=fd[1];
  const pr = rest.match(/\(prioridad:\s*([a-záéíóúñ]+)\)/i); if(pr) priority=_priKey(pr[1]);
  const txt = rest.replace(/\(fecha:[^)]*\)/ig,'').replace(/\(prioridad:[^)]*\)/ig,'').trim();
  return {dueDate, priority, txt};
}
function _applyMarkdown(text, D){
  D = D || data;
  const lines = text.split(/\r?\n/);
  let curProj=null, lastTop=null, upd=0, cre=0, skip=0;
  const order=[];
  const findP = id=>D.projects.find(p=>p.id===id);
  const findT = id=>D.tasks.find(t=>t.id===id);
  for(let raw of lines){
    const line = raw.replace(/<!--[\s\S]*?-->/g,'').replace(/\s+$/,'');
    if(!line.trim()) continue;
    let m;
    m = line.match(/^(#{2,6})\s+\[\[(.+?)\]\]\s*(.*)$/);
    if(m){
      const level = m[1].length, id = m[2].trim();
      let rest = m[3], name = rest, status = null;
      const meta = rest.match(/\(([^)]*)\)\s*$/);
      if(meta){
        name = rest.slice(0, meta.index).trim();
        const st = meta[1].match(/estado:\s*([a-záéíóúñ]+)/i);
        if(st){ const s=st[1].toLowerCase(); status = s.startsWith('paus')?'paused':(s.startsWith('term')?'done':'active'); }
      }
      name = name.trim();
      if(id==='new'){
        const parent = level>=3 ? lastTop : null;
        const base = parent ? findP(parent) : null;
        const np = {id:uid('p'), name:name||'Nuevo proyecto', area: base?base.area:null, desc:'', status:status||'active', hasLeads:false, color: base?base.color:'#8a919e', icon:'', driveUrl:'', driveFolderId:'', contacts:[], context: base?(base.context||'profesional'):'profesional', parentId: parent};
        D.projects.push(np); curProj=np.id; if(level<3) lastTop=np.id; cre++;
      } else {
        const p = findP(id);
        if(p){ if(name) p.name=name; if(status) p.status=status; if(level>=3 && lastTop) p.parentId=lastTop; curProj=id; if(level<3) lastTop=id; upd++; }
        else { curProj=null; skip++; }
      }
      continue;
    }
    m = line.match(/^>\s?(.*)$/);
    if(m){ if(curProj){ const p=findP(curProj); if(p) p.desc=m[1].trim(); } continue; }
    m = line.match(/^[-*]\s*\[([ xX])\]\s*\[\[(.+?)\]\]\s*(.*)$/);
    if(m){
      const done = m[1].toLowerCase()==='x', id = m[2].trim();
      const meta = _parseTaskMeta(m[3]);
      if(id==='new'){
        if(curProj){ const nt={id:uid('t'), projectId:curProj, text:meta.txt||'Nueva tarea', done, dueDate:meta.dueDate, dueTime:'', priority:meta.priority, emailAlert:false, alertSent:false, driveUrl:''}; D.tasks.push(nt); order.push(nt.id); cre++; }
        else skip++;
      } else {
        const t = findT(id);
        if(t){ if(meta.txt) t.text=meta.txt; t.done=done; t.dueDate=meta.dueDate; t.priority=meta.priority; if(curProj) t.projectId=curProj; order.push(id); upd++; }
        else skip++;
      }
      continue;
    }
    skip++;
  }
  if(order.length){
    const pos={}; order.forEach((id,i)=>{ if(!(id in pos)) pos[id]=i; });
    D.tasks.sort((a,b)=>{ const pa=(a.id in pos)?pos[a.id]:Infinity, pb=(b.id in pos)?pos[b.id]:Infinity; return pa-pb; });
  }
  return {upd, cre, skip};
}
function importMarkdown(event){
  const file = event.target.files[0];
  if(!file){ return; }
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      if(!confirm('Voy a aplicar el archivo: actualizo lo existente por su id y agrego lo marcado como [[new]]. No borro nada. ¿Continuar?')){ return; }
      const r = _applyMarkdown(e.target.result);
      save(); renderAll(); if(typeof renderAreaSettings==='function') renderAreaSettings();
      alert('Listo. Actualizados: '+r.upd+' · Nuevos: '+r.cre + (r.skip?(' · Líneas ignoradas: '+r.skip):''));
    }catch(err){ alert('No se pudo procesar el archivo: '+err.message); }
  };
  reader.readAsText(file);
  event.target.value='';
}

/* ====== GESTIONAR CAMBIOS (pegar + previsualizar + aplicar + respaldos) ====== */
const BACKUPS_KEY = 'kingdom_backups';
function getBackups(){ try{ return JSON.parse(localStorage.getItem(BACKUPS_KEY)||'[]'); }catch(_){ return []; } }
function saveBackupSnapshot(label){
  try{
    const arr = getBackups();
    arr.unshift({ts: Date.now(), label: label||'Respaldo', data: JSON.parse(JSON.stringify(data))});
    while(arr.length>10) arr.pop();
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(arr));
  }catch(e){ /* si el almacenamiento está lleno, seguimos sin respaldo local */ }
}
function _fmtTs(ts){ const d=new Date(ts); return d.toLocaleDateString()+' '+d.toLocaleTimeString().slice(0,5); }
function renderBackupsList(){
  const box = document.getElementById('manageBackups'); if(!box) return;
  const arr = getBackups();
  if(!arr.length){ box.innerHTML = '<div style="color:var(--muted);font-size:.8rem;">Todavía no hay respaldos.</div>'; return; }
  box.innerHTML = arr.map((b,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:.8rem;">${_fmtTs(b.ts)} · <span style="color:var(--muted);">${b.label}</span> <span style="color:var(--muted);">(${(b.data.projects||[]).length} proy · ${(b.data.tasks||[]).length} tareas)</span></span>
      <button class="btn-toggle" onclick="restoreBackup(${i})">Restaurar</button>
    </div>`).join('');
}
async function restoreBackup(i){
  const arr = getBackups(); const b = arr[i]; if(!b) return;
  if(!confirm('¿Restaurar el respaldo del '+_fmtTs(b.ts)+'? Antes guardo la versión actual por las dudas.')) return;
  saveBackupSnapshot('antes de restaurar');
  data = JSON.parse(JSON.stringify(b.data));
  // Guardar local SIN disparar el auto-push con fusión (que volvería a traer las ediciones del MCP).
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if(autoPushTimer){ clearTimeout(autoPushTimer); autoPushTimer=null; }
  renderAll(); if(typeof renderAreaSettings==='function') renderAreaSettings();
  renderBackupsList();
  // Subir a GitHub PISANDO el repo (sin fusionar), para que la versión restaurada gane
  // y no vuelva a aparecer lo que había editado el MCP por la sincronización.
  await overwriteGitHub();
  alert('Restaurado el respaldo del '+_fmtTs(b.ts)+'. Esta versión quedó como la definitiva.');
}
function overwriteGitHub(){
  const token = getGithubToken();
  const banner = document.getElementById('githubSyncStatus');
  if(!token) return Promise.resolve();
  return (async ()=>{
    try{
      let sha;
      const getRes = await fetch(ghApiUrl()+`?ref=${GITHUB_CONFIG.BRANCH}`, {
        headers:{Authorization:'Bearer '+token, Accept:'application/vnd.github+json'}
      });
      if(getRes.ok){ const gj = await getRes.json(); sha = gj.sha; }
      else if(getRes.status !== 404){ throw new Error('HTTP '+getRes.status); }
      const body = {
        message: 'Restaurar respaldo desde el dashboard (pisa la version anterior)',
        content: b64EncodeUnicode(JSON.stringify(data, null, 2)),
        branch: GITHUB_CONFIG.BRANCH
      };
      if(sha) body.sha = sha;
      const putRes = await fetch(ghApiUrl(), {
        method:'PUT',
        headers:{Authorization:'Bearer '+token, Accept:'application/vnd.github+json', 'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      if(!putRes.ok){ const e = await putRes.json().catch(()=>({})); throw new Error(putRes.status+' '+(e.message||'')); }
      try{ localStorage.setItem('kingdom_dirty','0'); }catch(_){}
      if(banner) banner.textContent = '✓ Respaldo restaurado y subido a GitHub.';
    }catch(err){
      if(banner) banner.textContent = 'Restauré local, pero no pude pisar GitHub ('+err.message+'). La sincronización podría traer lo anterior.';
    }
  })();
}
function openManage(){
  var t=document.getElementById('manageMdInput'); if(t) t.value='';
  var pv=document.getElementById('managePreview'); if(pv) pv.innerHTML='';
  renderBackupsList();
  document.getElementById('manageOverlay').classList.add('open');
}
function closeManage(){ document.getElementById('manageOverlay').classList.remove('open'); }
function previewManage(){
  const text = (document.getElementById('manageMdInput').value||'');
  const pv = document.getElementById('managePreview');
  if(!text.trim()){ pv.innerHTML='<span style="color:var(--muted);">Pegá el Markdown arriba para previsualizar.</span>'; return; }
  let res;
  try{ const clone = JSON.parse(JSON.stringify(data)); res = _applyMarkdown(text, clone); }
  catch(err){ pv.innerHTML = '<span style="color:var(--red);">Error al leer: '+err.message+'</span>'; return; }
  pv.innerHTML = `<div style="font-size:.85rem;line-height:1.5;">Si aplicás, se van a:<br>
    · <b>${res.upd}</b> actualizar/mover (existentes)<br>
    · <b>${res.cre}</b> crear (nuevas)<br>
    · <b>${res.skip}</b> ignorar (líneas que no calzan)<br>
    <span style="color:var(--muted);">No se borra nada. Se guarda un respaldo antes de aplicar.</span></div>`;
}
function applyManage(){
  const text = (document.getElementById('manageMdInput').value||'');
  if(!text.trim()){ alert('No hay nada pegado para aplicar.'); return; }
  if(!confirm('¿Aplicar los cambios? Guardo un respaldo de la versión actual antes.')) return;
  saveBackupSnapshot('antes de aplicar cambios');
  let r;
  try{ r = _applyMarkdown(text); }
  catch(err){ alert('No se pudo aplicar: '+err.message); return; }
  save(); renderAll(); if(typeof renderAreaSettings==='function') renderAreaSettings();
  renderBackupsList();
  alert('Aplicado. Actualizados/movidos: '+r.upd+' · Nuevos: '+r.cre+(r.skip?(' · Ignorados: '+r.skip):'')+'\nRespaldo guardado por si querés volver atrás.');
}

/* ====== IMPORTAR SUGERENCIAS DE IA (pegar, solo [[new]]) ====== */
function openAiPaste(){ var t=document.getElementById('aiPasteText'); if(t) t.value=''; document.getElementById('aiPasteOverlay').classList.add('open'); }
function closeAiPaste(){ document.getElementById('aiPasteOverlay').classList.remove('open'); }
function importAISuggestions(){
  const text = (document.getElementById('aiPasteText').value || '');
  const lines = text.split(/\r?\n/);
  const toAdd = [];
  for(let raw of lines){
    if(raw.indexOf('[[new]]') < 0) continue;
    let s = raw.replace('[[new]]','').replace(/^[\s*\-\u2022]+/,'').trim();
    let dueDate=null, priority='medium';
    const fd = s.match(/\(fecha:\s*(\d{4}-\d{2}-\d{2})\)/i); if(fd) dueDate=fd[1];
    const pr = s.match(/\(prioridad:\s*([a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]+)\)/i); if(pr) priority=_priKey(pr[1]);
    s = s.replace(/\(fecha:[^)]*\)/ig,'').replace(/\(prioridad:[^)]*\)/ig,'');
    s = s.replace(/\[\[[^\]]*\]\]/g,'');
    s = s.replace(/\s*\d+\s*$/,'').trim();
    s = s.replace(/\s+/g,' ').trim();
    if(s) toAdd.push({text:s, dueDate, priority});
  }
  if(toAdd.length===0){ alert('No encontré líneas con [[new]] para importar.'); return; }
  let inbox = data.projects.find(p=>p.id==='ia-inbox');
  if(!inbox){
    inbox = {id:'ia-inbox', name:'💡 Sugerencias IA', area:null, desc:'Tareas sugeridas por la IA. Arrastralas a su proyecto.', status:'active', hasLeads:false, color:'#8a919e', icon:'', driveUrl:'', driveFolderId:'', contacts:[], context:'otro'};
    data.projects.push(inbox);
  }
  toAdd.forEach(o=>{ data.tasks.push({id:uid('t'), projectId:'ia-inbox', text:o.text, done:false, dueDate:o.dueDate, dueTime:'', priority:o.priority, emailAlert:false, alertSent:false, driveUrl:''}); });
  save(); renderAll();
  closeAiPaste();
  alert('Importé ' + toAdd.length + ' sugerencias a "💡 Sugerencias IA". Arrastralas a sus proyectos.');
}


function areaInfo(id){ return data.areas.find(a=>a.id===id) || PERSONAL_AREAS.find(a=>a.id===id) || {name:'—', color:'#8a919e', context:'profesional'}; }
function projectInfo(id){ return data.projects.find(p=>p.id===id); }
function uid(prefix){ return prefix + Date.now() + Math.floor(Math.random()*1000); }
function selectPriority(p){
  document.querySelectorAll('.priority-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.priority===p);
  });
  // auto-calcular fecha/hora según importancia
  const now = new Date();
  let date, time;
  if(p==='high'){
    // quedó la caga: +2 horas
    const d = new Date(now.getTime() + 2*60*60*1000);
    date = d.toISOString().slice(0,10);
    time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } else if(p==='medium'){
    // pa mañana: si son después de las 18:00, pasado mañana a las 9:00; si no, mañana misma hora
    const hour = now.getHours();
    if(hour >= 18){
      const d = new Date(now.getTime() + 2*24*60*60*1000);
      date = d.toISOString().slice(0,10);
      time = '09:00';
    } else {
      const d = new Date(now.getTime() + 24*60*60*1000);
      date = d.toISOString().slice(0,10);
      time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }
  } else {
    // no pasa nada: +3 días, 12:00
    const d = new Date(now.getTime() + 3*24*60*60*1000);
    date = d.toISOString().slice(0,10);
    time = '12:00';
  }
  document.getElementById('nt-due').value = date;
  document.getElementById('nt-time').value = time;
}
function getSelectedPriority(){
  const btn = document.querySelector('.priority-btn.active');
  return btn ? btn.dataset.priority : 'medium';
}
const PRIORITY_EMOJI = { high:':(', medium:':/', low:':)' };
const ALERT_LEAD_OPTIONS = [15, 30, 45, 60, 90, 120, 180];
function selectProjectContext(ctx){
  document.querySelectorAll('[data-ctx]').forEach(b=>b.classList.toggle('active', b.dataset.ctx===ctx));
  document.getElementById('np-context').value = ctx;
  const areaSel = document.getElementById('np-area');
  if(areaSel){
    const areas = data.areas.filter(a=>(a.context||'profesional')===ctx);
    areaSel.innerHTML = areas.length ? areas.map(a=>`<option value="${a.id}">${a.name}</option>`).join('') : '<option value="">Sin área</option>';
  }
}
function npParentChanged(){
  const isSub = !!(document.getElementById('np-parent') && document.getElementById('np-parent').value);
  const areaSel = document.getElementById('np-area');
  const ctxSel = document.getElementById('np-context-selector');
  const note = document.getElementById('np-parent-note');
  if(areaSel) areaSel.style.display = isSub ? 'none' : '';
  if(ctxSel) ctxSel.style.display = isSub ? 'none' : '';
  if(note) note.style.display = isSub ? '' : 'none';
}
function openProjectModal(){
  populateSelects();
  // pre-seleccionar según el contexto activo
  const ctx = (activeContext === 'all') ? 'profesional' : activeContext;
  selectProjectContext(ctx);
  const npp = document.getElementById('np-parent'); if(npp) npp.value='';
  npParentChanged();
  document.getElementById('projectModalOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('np-name').focus(), 50);
}
function closeProjectModal(){
  document.getElementById('projectModalOverlay').classList.remove('open');
}
function openTaskModal(projectId){
  populateSelects();
  if(projectId){
    setTaskProject(projectId);
  } else {
    setTaskProject('');
  }
  selectPriority('medium'); // default: pa mañana
  document.getElementById('taskModalOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('nt-text').focus(), 50);
}
function closeTaskModal(){
  document.getElementById('taskModalOverlay').classList.remove('open');
}
function readIconFile(file, cb){
  const img = new Image();
  const reader = new FileReader();
  reader.onload = ev=>{
    img.onload = ()=>{
      const size=96;
      const canvas = document.createElement('canvas');
      canvas.width=size; canvas.height=size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size/img.width, size/img.height);
      const w=img.width*scale, h=img.height*scale;
      ctx.drawImage(img, (size-w)/2, (size-h)/2, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}
function setProjectIcon(id){
  const p = projectInfo(id);
  const choice = prompt('Ícono del proyecto:\n- Escribí un EMOJI (ej. 🚀)\n- Escribí "foto" para subir una imagen desde tu dispositivo\n- Dejalo vacío para volver a la inicial con color', p.icon&&!p.icon.startsWith('data:')&&!p.icon.startsWith('http')?p.icon:'');
  if(choice===null) return;
  if(choice.trim().toLowerCase()==='foto'){
    const input = document.createElement('input');
    input.type='file'; input.accept='image/*';
    input.onchange = e=>{
      const file = e.target.files[0];
      if(!file) return;
      readIconFile(file, dataUrl=>{ p.icon = dataUrl; save(); renderAll(); });
    };
    input.click();
    return;
  }
  p.icon = choice.trim();
  save(); renderAll();
}
function openDrive(id){
  const p = projectInfo(id);
  if(p.driveUrl){
    window.open(p.driveUrl, '_blank');
  }else{
    promptDriveUrl(p);
  }
}
function editDrive(id){
  const p = projectInfo(id);
  promptDriveUrl(p);
}
function promptDriveUrl(obj){
  const url = prompt('Pegá el link de la carpeta o documento de Google Drive (dejalo vacío para quitar el vínculo):', obj.driveUrl||'');
  if(url===null) return;
  obj.driveUrl = url.trim();
  save(); renderAll();
}
/* ====== CARPETA DE DRIVE (modal) ====== */
function manageDrive(id){
  const p = projectInfo(id);
  document.getElementById('dr-id').value = id;
  document.getElementById('dr-url').value = p.driveUrl || '';
  document.getElementById('driveOverlay').classList.add('open');
}
function closeDrive(){ document.getElementById('driveOverlay').classList.remove('open'); }
function openDriveLink(){
  const u = document.getElementById('dr-url').value.trim();
  if(u) window.open(u, '_blank');
  else alert('No hay link guardado. Pegá uno y tocá Guardar.');
}
function saveDrive(){
  const id = document.getElementById('dr-id').value;
  const p = projectInfo(id);
  p.driveUrl = document.getElementById('dr-url').value.trim();
  save(); renderAll(); closeDrive();
}
/* ====== EDITAR PROYECTO (modal) ====== */
function openEditProject(id){
  const p = data.projects.find(x=>x.id===id);
  if(!p) return;
  document.getElementById('ep-id').value = id;
  document.getElementById('ep-name').value = p.name || '';
  document.getElementById('ep-desc').value = p.desc || '';
  document.getElementById('ep-color').value = (p.color && p.color.startsWith('#')) ? p.color : '#007aff';
  const isSub = !!p.parentId && data.projects.some(x=>x.id===p.parentId);
  document.getElementById('ep-cat-wrap').style.display = isSub ? 'none' : '';
  document.getElementById('ep-cat-note').style.display = isSub ? '' : 'none';
  if(!isSub) document.getElementById('ep-area').innerHTML = _areaOptions(p.area);
  document.getElementById('editProjectOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('ep-name').focus(), 50);
}
function closeEditProject(){ document.getElementById('editProjectOverlay').classList.remove('open'); }
function saveEditProject(){
  const id = document.getElementById('ep-id').value;
  const p = data.projects.find(x=>x.id===id);
  if(!p) return;
  const nm = document.getElementById('ep-name').value.trim();
  const newDesc = document.getElementById('ep-desc').value.trim();
  const textoCambio = (nm && nm !== p.name) || (newDesc !== p.desc);  // autor solo si cambia texto
  if(nm) p.name = nm;
  p.desc = newDesc;
  p.color = document.getElementById('ep-color').value;
  const isSub = !!p.parentId && data.projects.some(x=>x.id===p.parentId);
  if(!isSub){
    const areaId = document.getElementById('ep-area').value;
    p.area = areaId;
    const ai = areaInfo(areaId);
    if(ai && ai.context) p.context = ai.context;
    // los subproyectos heredan la categoría del padre
    getDescendantIds(id).forEach(did=>{
      const c = data.projects.find(x=>x.id===did);
      if(c){ c.area = areaId; if(ai && ai.context) c.context = ai.context; }
    });
  }
  if(textoCambio) p.userUpdatedAt = new Date().toISOString();  // autor: vos (cambio de texto)
  save(); renderAll(); closeEditProject();
}
function openTaskDrive(taskId){
  const t = data.tasks.find(t=>t.id===taskId);
  if(t.driveUrl){
    window.open(t.driveUrl, '_blank');
  }else{
    promptDriveUrl(t);
  }
}
function editTaskDrive(taskId){
  const t = data.tasks.find(t=>t.id===taskId);
  promptDriveUrl(t);
}
function quickAddTask(projectId){
  openTaskModal(projectId);
}
function toggle(id){ document.getElementById(id).classList.toggle('collapsed'); }

/* ====== GOOGLE DRIVE: CONEXIÓN Y LISTADO ====== */
function renderGoogleSection(){
  const banner = document.getElementById('googleConfigBanner');
  const status = document.getElementById('googleDriveStatus');
  if(!banner || !status) return;

  if(!GOOGLE_READY){
    banner.className = 'config-banner';
    banner.textContent = '⚠ Google Drive sin configurar. Completá GOOGLE_CONFIG.CLIENT_ID en el código (ver instrucciones arriba en GOOGLE_CONFIG) y asegurate de estar accediendo por https://, no file://.';
    status.innerHTML = '';
    return;
  }
  if(location.protocol === 'file:'){
    banner.className = 'config-banner';
    banner.textContent = '⚠ Google bloquea el login desde archivos locales (file://). Subí este dashboard a un hosting https:// para poder conectar.';
    status.innerHTML = '';
    return;
  }
  if(!googleToken){
    banner.className = 'config-banner';
    banner.textContent = 'Google Drive configurado. Conectate con la cuenta contacto@notclassic.com para listar archivos por proyecto.';
    status.innerHTML = `<button class="btn-primary" onclick="connectGoogleDrive()">🔗 Conectar Google Drive</button>`;
  }else{
    banner.className = 'config-banner ok';
    banner.textContent = '✓ Google Drive conectado.';
    status.innerHTML = `<button class="btn-toggle" onclick="disconnectGoogleDrive()">Desconectar</button>
      <div class="row-desc" style="margin-top:10px;">
        Para listar archivos de un proyecto, abrí su carpeta de Drive (botón 📁 en Portafolio), copiá el ID de la carpeta
        desde la URL (la parte después de /folders/) y pegalo en "Carpeta (ID de Drive)" en Configuración › Proyectos.
      </div>`;
  }
}
function connectGoogleDrive(){
  if(typeof google === 'undefined' || !google.accounts){
    alert('No se pudo cargar el SDK de Google. Verificá tu conexión a internet.');
    return;
  }
  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CONFIG.CLIENT_ID,
    scope: GOOGLE_CONFIG.SCOPES,
    hint: 'contacto@notclassic.com',
    callback: (resp)=>{
      if(resp.access_token){
        googleToken = resp.access_token;
        renderGoogleSection();
        renderAreaSettings();
      }
    }
  });
  tokenClient.requestAccessToken();
}
function disconnectGoogleDrive(){
  if(googleToken && google.accounts.oauth2.revoke){
    google.accounts.oauth2.revoke(googleToken, ()=>{});
  }
  googleToken = null;
  renderGoogleSection();
  renderAreaSettings();
}
async function listDriveFiles(projectId){
  const p = projectInfo(projectId);
  const cont = document.getElementById('drivefiles-'+projectId);
  if(!googleToken){ cont.innerHTML = '<div class="empty">Conectá Google Drive primero en la pestaña Configuración.</div>'; return; }
  if(!p.driveFolderId){ cont.innerHTML = '<div class="empty">Falta el ID de carpeta de Drive (Configuración › Proyectos).</div>'; return; }
  cont.innerHTML = '<div class="empty">Cargando archivos…</div>';
  try{
    const url = `https://www.googleapis.com/drive/v3/files?q='${p.driveFolderId}'+in+parents&fields=files(id,name,mimeType,webViewLink,iconLink)`;
    const res = await fetch(url, {headers:{Authorization:'Bearer '+googleToken}});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    if(!data.files || data.files.length===0){ cont.innerHTML = '<div class="empty">Carpeta vacía o sin acceso.</div>'; return; }
    cont.innerHTML = data.files.map(f=>`
      <div class="checkrow" style="justify-content:space-between; padding:4px 0;">
        <a href="${f.webViewLink}" target="_blank" style="color:var(--accent); text-decoration:none;">📄 ${f.name}</a>
      </div>`).join('');
  }catch(err){
    cont.innerHTML = `<div class="empty">Error al listar archivos: ${err.message}</div>`;
  }
}

/* ====== RENDER TOTALES ====== */
function renderTotals(){
  const pass = p => {
    if(activeArea!=='all' && p.area!==activeArea) return false;
    if(activeContext!=='all' && (p.context||'profesional')!==activeContext) return false;
    if(activeProjects.size>0 && !activeProjects.has(p.id)) return false;
    return true;
  };
  const active = data.projects.filter(p=>p.status==='active' && pass(p));
  const paused = data.projects.filter(p=>p.status==='paused' && pass(p)).length;
  const topLevel = active.filter(p=>!p.parentId).length;
  const subs = active.filter(p=>p.parentId).length;
  const activeIds = active.map(p=>p.id);
  const tAll = data.tasks.filter(t=>activeIds.includes(t.projectId));
  const pending = tAll.filter(t=>!t.done).length;
  const today = new Date(); today.setHours(0,0,0,0);
  const overdue = tAll.filter(t=>!t.done && t.dueDate && new Date(t.dueDate+'T00:00:00') < today).length;
  document.getElementById('totals').innerHTML = `
    <div class="sumchip"><b>${topLevel}</b><span>Proyectos</span></div>
    <div class="sumchip"><b>${subs}</b><span>Subproyectos</span></div>
    <div class="sumchip"><b>${pending}</b><span>Tareas pend.</span></div>
    <div class="sumchip${overdue>0?' alert':''}"><b>${overdue}</b><span>Vencidas</span></div>
    ${paused>0 ? `<div class="sumchip"><b>${paused}</b><span>En pausa</span></div>` : ''}
  `;
}

/* ====== MARCA DE ÚLTIMA EDICIÓN DE TEXTO (autor) ====== */
/* Dos marcas posibles en cada tarea/proyecto:
   - mcpUpdatedAt : la escribe SOLO la conexión (Claude) al editar.   -> reloj AZUL
   - userUpdatedAt: la escribe el dashboard cuando VOS editás el texto. -> reloj VERDE
   mcpEditBadge() muestra un reloj con la fecha de la MÁS RECIENTE de las dos
   (manda el último que editó el texto) y lo pinta según quién fue. Al pasar el
   mouse (o mantener pulsado) aparece quién y cuándo. La hora es la del navegador. */
function _fmtStamp(iso){
  const d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${dd}/${mm} ${hh}:${mi}`;
}
function mcpEditBadge(item){
  if(!item) return '';
  const mcp = item.mcpUpdatedAt || null;   // Claude
  const usr = item.userUpdatedAt || null;  // vos
  if(!mcp && !usr) return '';
  // gana el más reciente (comparación de ISO strings funciona lexicográficamente)
  let autor, iso;
  if(mcp && usr){ if(usr >= mcp){ autor='user'; iso=usr; } else { autor='claude'; iso=mcp; } }
  else if(usr){ autor='user'; iso=usr; }
  else { autor='claude'; iso=mcp; }
  const stamp = _fmtStamp(iso);
  if(!stamp) return '';
  const color = autor==='user' ? '#3b82f6' : '#34c759';  // azul vos / verde Claude
  const quien = autor==='user' ? 'vos' : 'Claude';
  return `<span class="mcp-edit" title="Última edición de texto: ${quien} · ${stamp}" style="display:inline-flex; align-items:center; justify-content:center; font-size:.72rem; color:${color}; opacity:.85; cursor:default; flex-shrink:0;">🕒</span>`;
}

/* ====== RENDER FILTROS DE ÁREA ====== */
const CONTEXT_LABELS = { all:'Vida', profesional:'Profesional', personal:'Personal', otro:'Otro' };
function setContext(ctx){
  activeContext = ctx;
  activeArea='all';
  updateContextButton();
  renderAll();
}
function updateContextButton(){
  const b = document.getElementById('contextSheetTrigger');
  if(b) b.title = 'Ámbito: ' + (CONTEXT_LABELS[activeContext] || 'Vida');
}
function openNew(){ openTaskModal(); }
function switchNew(kind){
  if(kind==='task'){ closeProjectModal(); openTaskModal(); }
  else { closeTaskModal(); openProjectModal(); }
}

/* ====== MODAL DE FILTROS (ámbito + categoría + proyectos) ====== */
function openFilterModal(){
  buildFilterBody();
  document.getElementById('filterModalOverlay').classList.add('open');
}
function closeFilterModal(){
  const o = document.getElementById('filterModalOverlay');
  if(o) o.classList.remove('open');
}
function _tint(hex, a){
  hex = (hex||'#3b6fed').replace('#','');
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const n = parseInt(hex,16);
  return `rgba(${(n>>16)&255}, ${(n>>8)&255}, ${n&255}, ${a})`;
}
function buildFilterBody(){
  const ck = '<div class="sheet-check"></div>', em = '<div class="sheet-check-empty"></div>';
  // Ámbito (segmentado)
  let h = `<div class="filter-group"><div class="filter-label">Ámbito</div><div class="priority-selector" style="margin:0;">`;
  [['all','🌐 Vida'],['profesional','💼 Profesional'],['personal','🏠 Personal'],['otro','💡 Otro']].forEach(([v,l])=>{
    h += `<button type="button" class="priority-btn${activeContext===v?' active':''}" data-area-ctx="" style="flex:1;" onclick="filterPickContext('${v}')">${l}</button>`;
  });
  h += `</div></div>`;
  // Categoría (chips)
  const ctxProjects = activeContext==='all' ? data.projects : data.projects.filter(p=>(p.context||'profesional')===activeContext);
  const usedAreas = new Set(ctxProjects.map(p=>p.area));
  h += `<div class="filter-group"><div class="filter-label">Categoría</div><div class="filter-chips">`;
  h += `<button type="button" class="fchip${activeArea==='all'?' active':''}" onclick="filterPickArea('all')">Todas</button>`;
  data.areas.forEach(a=>{
    if(usedAreas.has(a.id)){
      const on = activeArea===a.id;
      const st = on ? ` style="background:${_tint(a.color,0.14)}; border-color:${a.color}; color:${a.color}; box-shadow:0 2px 9px ${_tint(a.color,0.22)};"` : '';
      h += `<button type="button" class="fchip${on?' active':''}"${st} onclick="filterPickArea('${a.id}')"><span class="dot" style="background:${a.color}"></span>${a.name}</button>`;
    }
  });
  h += `</div></div>`;
  // Proyecto (lista con check)
  let projects = data.projects.filter(p=> activeArea==='all' || p.area===activeArea);
  if(activeContext!=='all') projects = projects.filter(p=>(p.context||'profesional')===activeContext);
  h += `<div class="filter-group"><div class="filter-label">Proyecto</div><div class="filter-list">`;
  h += `<div class="sheet-option" onclick="filterClearProjects()"><div class="sheet-left"><span>Todos los proyectos</span></div>${activeProjects.size===0?ck:em}</div>`;
  h += projects.map(p=>`<div class="sheet-option" onclick="filterToggleProject('${p.id}')"><div class="sheet-left"><span class="dot" style="background:${p.color}"></span><span>${p.name}</span></div>${activeProjects.has(p.id)?ck:em}</div>`).join('');
  h += `</div></div>`;
  document.getElementById('filterModalBody').innerHTML = h;
}
function filterPickContext(v){ setContext(v); buildFilterBody(); }
function filterPickArea(id){ setArea(id); updateFilterLabel(); buildFilterBody(); }
function filterToggleProject(id){
  if(activeProjects.has(id)) activeProjects.delete(id); else activeProjects.add(id);
  renderAll(); buildFilterBody();
}
function filterClearProjects(){ activeProjects.clear(); renderAll(); buildFilterBody(); }

/* ====== SELECTOR DE PROYECTO/SUBPROYECTO (NUEVA TAREA) ====== */
function _projPath(pid){
  const names = [];
  let cur = pid ? data.projects.find(x=>x.id===pid) : null;
  let guard = 0;
  while(cur && guard++ < 20){
    names.unshift(cur.name);
    cur = cur.parentId ? data.projects.find(x=>x.id===cur.parentId) : null;
  }
  return names.join(' › ');
}
function setTaskProject(id){
  document.getElementById('nt-project-id').value = id || '';
  const lbl = document.getElementById('nt-project-label');
  const p = id ? data.projects.find(x=>x.id===id) : null;
  if(!p){ lbl.textContent = 'Elegí proyecto o subproyecto'; lbl.classList.add('pp-placeholder'); return; }
  const path = _projPath(p.parentId);
  lbl.textContent = path ? (path + ' › ' + p.name) : p.name;
  lbl.classList.remove('pp-placeholder');
}
function openTaskProjectPicker(){
  const s = document.getElementById('taskProjPickerSearch'); if(s) s.value = '';
  buildTaskProjList('');
  document.getElementById('taskProjPickerOverlay').classList.add('open');
  setTimeout(()=>{ const s2 = document.getElementById('taskProjPickerSearch'); if(s2) s2.focus(); }, 60);
}
function closeTaskProjectPicker(){
  const o = document.getElementById('taskProjPickerOverlay'); if(o) o.classList.remove('open');
}
function pickTaskProject(id){ setTaskProject(id); closeTaskProjectPicker(); }
function buildTaskProjList(filter){
  const q = (filter||'').trim().toLowerCase();
  const cur = document.getElementById('nt-project-id').value;
  const ck = '<div class="sheet-check"></div>', em = '<div class="sheet-check-empty"></div>';
  let h = '';
  if(q){
    const matches = data.projects.filter(p=>p.status==='active' && p.name.toLowerCase().includes(q));
    if(!matches.length){
      h = '<div class="empty" style="padding:16px; text-align:center; color:var(--muted);">Sin resultados</div>';
    } else {
      h = matches.map(p=>{
        const path = _projPath(p.parentId);
        return `<div class="sheet-option" onclick="pickTaskProject('${p.id}')">
          <div class="sheet-left" style="flex-direction:column; align-items:flex-start; gap:2px;">
            <span style="display:flex; align-items:center; gap:6px;"><span class="dot" style="background:${p.color}"></span>${p.name}</span>
            <small style="color:var(--muted); font-size:.72rem;">${path || 'Proyecto principal'}</small>
          </div>${cur===p.id?ck:em}</div>`;
      }).join('');
    }
  } else {
    const kids = pid => data.projects.filter(p=>p.status==='active' && (p.parentId||null)===(pid||null));
    (function walk(pid, depth){
      kids(pid).forEach(p=>{
        h += `<div class="sheet-option" style="padding-left:${12+depth*18}px;" onclick="pickTaskProject('${p.id}')">
          <div class="sheet-left"><span class="dot" style="background:${p.color}"></span><span>${depth>0?'└ ':''}${p.name}</span></div>${cur===p.id?ck:em}</div>`;
        walk(p.id, depth+1);
      });
    })(null, 0);
  }
  document.getElementById('taskProjPickerList').innerHTML = h;
}
function renderAreaFilters(){
  const cont = document.getElementById('areaFilters');
  if(!cont || cont.style.display==='none') return;
  // solo mostrar áreas que tienen proyectos en el contexto activo
  const ctxProjects = activeContext==='all' ? data.projects : data.projects.filter(p=>(p.context||'profesional')===activeContext);
  const usedAreas = new Set(ctxProjects.map(p=>p.area));
  let html = `<div class="chip ${activeArea==='all'?'active':''}" data-area-id="all">Todas</div>`;
  data.areas.forEach(a=>{
    if(usedAreas.has(a.id))
      html += `<div class="chip ${activeArea===a.id?'active':''}" style="--chip-color:${a.color}" data-area-id="${a.id}">${a.name}</div>`;
  });
  cont.innerHTML = html;
  cont.querySelectorAll('.chip').forEach(el=>attachChipHandlers(el, el.dataset.areaId));
}
function setArea(id){ activeArea = id; activeProjects.clear(); renderAll(); }
function updateFilterLabel(){
  let label;
  if(activeProjects.size===1) label = projectInfo([...activeProjects][0]).name;
  else if(activeProjects.size>1) label = `${activeProjects.size} proyectos`;
  else if(activeArea!=='all'){ const a = areaInfo(activeArea); label = a ? a.name : 'Todas'; }
  else label = 'Todas';
  const el = document.getElementById('filterBtnLabel');
  if(el) el.textContent = label;
}
let chipLastTouch = 0;
function attachChipHandlers(el, id){
  let timer=null, longFired=false, sx=0, sy=0, moved=false;
  const begin=(x,y)=>{ longFired=false; moved=false; sx=x; sy=y;
    if(id && id!=='all'){ timer=setTimeout(()=>{ longFired=true; openChipEditor(id); }, 500); } };
  const move=(x,y)=>{ if(Math.abs(x-sx)>10 || Math.abs(y-sy)>10){ moved=true; clearTimeout(timer); } };
  const finish=()=>{ clearTimeout(timer); if(!longFired && !moved) setArea(id); };
  el.addEventListener('touchstart', e=>{ const t=e.touches[0]; begin(t.clientX,t.clientY); }, {passive:true});
  el.addEventListener('touchmove', e=>{ const t=e.touches[0]; move(t.clientX,t.clientY); }, {passive:true});
  el.addEventListener('touchend', ()=>{ chipLastTouch=Date.now(); finish(); });
  el.addEventListener('touchcancel', ()=>{ clearTimeout(timer); });
  el.addEventListener('mousedown', e=>{ if(Date.now()-chipLastTouch<600) return; begin(e.clientX,e.clientY); });
  el.addEventListener('mousemove', e=>{ if(timer) move(e.clientX,e.clientY); });
  el.addEventListener('mouseup', ()=>{ if(Date.now()-chipLastTouch<600) return; finish(); });
  el.addEventListener('mouseleave', ()=>{ clearTimeout(timer); });
}
let chipEditId = null;
function openChipEditor(id){
  const a = data.areas.find(x=>x.id===id);
  if(!a) return;
  chipEditId = id;
  document.getElementById('chipEditColor').value = a.color || '#007aff';
  document.getElementById('chipEditName').value = a.name || '';
  document.getElementById('chipEditOverlay').classList.add('open');
  setTimeout(()=>{ const n=document.getElementById('chipEditName'); if(n){ n.focus(); n.select(); } }, 50);
}
function saveChipEdit(){
  const a = data.areas.find(x=>x.id===chipEditId);
  if(a){
    const name = document.getElementById('chipEditName').value.trim();
    a.color = document.getElementById('chipEditColor').value;
    if(name) a.name = name;
    save(); renderAll();
    if(typeof renderAreaSettings==='function') renderAreaSettings();
  }
  closeChipEdit();
}
function closeChipEdit(){
  chipEditId = null;
  document.getElementById('chipEditOverlay').classList.remove('open');
}

function toggleMsDropdown(){}
function toggleProjectDropdown(){}
function toggleProjectDropdown2(){}

function updateSheetLabels(){
  const label = activeProjects.size===0 ? 'Todos los proyectos'
    : activeProjects.size===1 ? projectInfo([...activeProjects][0]).name
    : `${activeProjects.size} proyectos`;
  ['','2'].forEach(s=>{
    const el = document.getElementById('projectSheetLabel'+s);
    if(el) el.textContent = label;
  });
  updateFilterLabel();
}
function renderProjectFilters(){ updateSheetLabels(); }
/* ====== RENDER TARJETAS PROYECTO ====== */
let showDoneProjects = false;
let shownDoneTasks = new Set();
let showCompletedInline = (typeof localStorage!=='undefined' && localStorage.getItem('kingdom_showCompleted')==='1');
function toggleCompletedInline(){
  showCompletedInline = !showCompletedInline;
  try{ localStorage.setItem('kingdom_showCompleted', showCompletedInline?'1':'0'); }catch(_){}
  renderProjectCards();
}
function copyId(e, id){
  e.stopPropagation();
  try{ navigator.clipboard.writeText(id); }catch(_){}
  const el = e.currentTarget;
  const ico = el.querySelector('.id-ico'), num = el.querySelector('.id-num');
  const pi = ico?ico.textContent:'', pn = num?num.textContent:'';
  if(ico) ico.textContent = '✓';
  if(num) num.textContent = 'copiado';
  setTimeout(()=>{ if(ico) ico.textContent = pi; if(num) num.textContent = pn; }, 900);
}
function renderProjectCards(){
  const cont = document.getElementById('projectCards');
  const passFilters = p => (activeArea==='all' || p.area===activeArea)
    && (activeContext==='all' || (p.context||'profesional')===activeContext)
    && (activeProjects.size===0 || activeProjects.has(p.id));

  const visible = data.projects.filter(p => p.status!=='done' && passFilters(p));
  const doneList = data.projects.filter(p => p.status==='done' && passFilters(p));

  if(visible.length===0 && doneList.length===0){
    cont.innerHTML = '<div class="empty">No hay proyectos en esta área.</div>';
    return;
  }

  // Orden jerárquico: cada padre seguido de sus hijos, respetando el orden del array
  const visibleIds = new Set(visible.map(p=>p.id));
  const byParent = {};
  visible.forEach(p=>{
    const key = (p.parentId && visibleIds.has(p.parentId)) ? p.parentId : '__root__';
    (byParent[key] = byParent[key] || []).push(p);
  });
  const ordered = [];
  (function walk(key, depth){
    (byParent[key]||[]).forEach(p=>{ ordered.push({p, depth}); if(!collapsedProjects.has(p.id)) walk(p.id, depth+1); });
  })('__root__', 0);

  const today = new Date(); today.setHours(0,0,0,0);

  function projectRow(entry){
    const p = entry.p, depth = entry.depth;
    const area = areaInfo(p.area);
    const tasks = data.tasks.filter(t=>t.projectId===p.id);
    const pending = tasks.filter(t=>!t.done);
    let statusCls='status-todo', statusLabel='Sin tareas';
    let ownOverdue = false;
    if(tasks.length){
      if(pending.length===0){ statusCls='status-done'; statusLabel='Completado'; }
      else{
        ownOverdue = pending.some(t=> t.dueDate && new Date(t.dueDate+'T00:00:00') < today);
        if(ownOverdue){ statusCls='status-late'; statusLabel='Atrasado'; }
        else{ statusCls='status-progress'; statusLabel='A tiempo'; }
      }
    }
    const expanded = expandedProjects.has(p.id);
    // Rollup: si un subproyecto/descendiente tiene vencidas, el padre se marca con un tono más suave
    const descIds = getDescendantIds(p.id);
    const descOverdue = descIds.length>0 && data.tasks.some(t=> descIds.includes(t.projectId) && !t.done && t.dueDate && new Date(t.dueDate+'T00:00:00') < today);
    const softLate = !ownOverdue && descOverdue;
    if(softLate){ statusCls='status-late'; statusLabel='Atrasado'; }
    const areaColor = (area && area.color) ? area.color : p.color;
    const tintStyle = (area && area.color) ? ('--area-tint:'+area.color+'14; --area-tint-strong:'+area.color+'24;') : '';
    const indent = depth>0 ? `margin-left:${depth*20}px;` : '';

    const taskItems = pending.length ? pending.map(t=>{
      const _dd = t.dueDate ? Math.round((new Date(t.dueDate+'T00:00:00')-today)/86400000) : null;
      const isOverdue = _dd!==null && _dd<0, isToday = _dd===0;
      const dotColor = isOverdue ? '#e63946' : (isToday ? '#f5a623' : '');
      const dueDot = dotColor ? `<span class="due-dot" style="background:${dotColor};"></span>` : '';
      const due = t.dueDate
        ? `<span class="due-badge" onclick="editTaskDate('${t.id}', this)" style="cursor:pointer; background:var(--panel); border:1px solid var(--border); color:var(--text);" title="Tocar para cambiar fecha">${dueDot}${fmtShort(t.dueDate)}</span>`
        : `<span class="due-badge" onclick="editTaskDate('${t.id}', this)" style="cursor:pointer;background:transparent;border:1px dashed var(--border);color:var(--muted);" title="Agregar fecha">+ fecha</span>`;
      return `<div class="task" draggable="true" data-task-id="${t.id}"
                   ondragstart="taskDragStart(event)" ondragover="taskDragOver(event)"
                   ondragleave="taskDragLeave(event)" ondrop="taskDrop(event)" ondragend="taskDragEnd(event)">
        <span class="drag-handle" ontouchstart="startTouchDrag(event,'task','${t.id}')">⠿</span>
        <input type="checkbox" onchange="toggleTask('${t.id}')"><span class="proj-dot" style="background:${p.color}"></span><div class="task-body"><div class="task-text"><span class="task-text-edit" contenteditable="true" spellcheck="false" draggable="false" style="white-space:pre-wrap;" onblur="editTaskText('${t.id}', this.innerText)" onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault(); this.blur();} else if(event.key==='Escape'){event.preventDefault(); this.blur();}" title="Enter = salto de línea · Ctrl/Cmd+Enter o Esc para terminar">${t.text}</span></div>${due}</div><span class="id-tag" onclick="copyId(event,'${t.id}')" title="ID — clic para copiar"><span class="id-ico">ID</span><span class="id-num">${t.id}</span></span>${mcpEditBadge(t)}
        <button class="task-drive ${t.driveUrl?'drive-on':''}" onclick="openTaskDrive('${t.id}')" title="${t.driveUrl?'Abrir carpeta/documento de Drive':'Vincular carpeta/documento de Drive'}">📁</button>
        ${t.driveUrl ? `<button class="task-drive" onclick="editTaskDrive('${t.id}')" title="Cambiar el link de Drive">✎</button>` : ''}
        <button class="task-drive" onclick="openEditTask('${t.id}')" title="Editar tarea (importancia, proyecto, fecha, hora)">⋯</button>
        <button class="task-drive task-del-btn" onclick="confirmDeleteTask('${t.id}')" title="Eliminar tarea">🗑</button>
      </div>`;
    }).join('') : '<div class="empty" style="padding:6px 0;">No hay tareas pendientes 🎉</div>';

    // Tareas terminadas: inline (con el toggle) o en sección plegable
    const doneTasks = tasks.filter(t=>t.done);
    let doneTasksBlock = '';
    if(doneTasks.length){
      const doneRows = doneTasks.map(t=>`
          <div class="task done">
            <input type="checkbox" checked onchange="toggleTask('${t.id}')" title="Destildar para reactivar">
            <span class="proj-dot" style="background:${p.color}"></span>
            <div class="task-body"><div class="task-text">${t.text}</div></div>
            <span class="id-tag" onclick="copyId(event,'${t.id}')" title="ID — clic para copiar"><span class="id-ico">ID</span><span class="id-num">${t.id}</span></span>
            <span class="done-flag">✓ Listo</span>
            <button class="task-drive task-del-btn" onclick="confirmDeleteTask('${t.id}')" title="Eliminar tarea">🗑</button>
          </div>`).join('');
      if(showCompletedInline){
        doneTasksBlock = doneRows;
      } else {
        const showDT = shownDoneTasks.has(p.id);
        doneTasksBlock = `<button class="done-tasks-toggle" onclick="toggleDoneTasks('${p.id}')">${showDT?'▾':'▸'} Terminadas (${doneTasks.length})</button>` + (showDT ? doneRows : '');
      }
    }

    return `
    <div class="row pf-row ${p.status==='paused'?'paused':''} ${ownOverdue?'row-late':(softLate?'row-late-soft':'')} ${depth>0?'subproject':''}" style="--accent-color:${ownOverdue?'#e63946':(softLate?'#ee6470':areaColor)}; ${tintStyle} ${indent}"
         draggable="true" data-id="${p.id}"
         ondragstart="dragStart(event)" ondragover="dragOver(event)" ondragleave="dragLeave(event)"
         ondrop="dragDrop(event)" ondragend="dragEnd(event)">
      <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
        ${(byParent[p.id]||[]).length
          ? `<button class="arrow-btn tree-toggle" onclick="toggleCollapse('${p.id}')" title="Mostrar u ocultar los subproyectos"><span class="ar">${collapsedProjects.has(p.id)?'▸':'▾'}</span><span class="ct">${(byParent[p.id]||[]).length}</span></button>`
          : `<span class="arrow-spacer"></span>`}
        <button class="arrow-btn expand-pill" onclick="toggleExpand('${p.id}')" title="Ver tareas pendientes"><span class="ar">${expanded?'▴':'▾'}</span><span class="ct">${pending.length}</span></button>
        <span class="drag-handle" style="flex-shrink:0;" ontouchstart="startTouchDrag(event,'project','${p.id}')">⠿</span>
        <span class="project-avatar" style="flex-shrink:0; background:${p.color}; ${p.icon&&(p.icon.startsWith('http')||p.icon.startsWith('data:'))?'padding:0; overflow:hidden;':''}"
              onclick="setProjectIcon('${p.id}')" title="Tocar para cambiar el ícono">${
          p.icon
            ? ((p.icon.startsWith('http')||p.icon.startsWith('data:')) ? `<img src="${p.icon}" alt="" style="width:100%; height:100%; object-fit:cover; border-radius:8px;">` : p.icon)
            : (p.name||'?').trim().charAt(0).toUpperCase()
        }</span>
        <div style="min-width:0; flex:1;">
          <div class="row-name" contenteditable="true" spellcheck="false" draggable="false"
               onblur="renameProject('${p.id}', this.textContent)"
               onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}"
               title="Click para editar el nombre">${p.name}</div>
          <div class="row-desc" contenteditable="true" spellcheck="false" draggable="false" style="white-space:pre-wrap;"
               onblur="editDesc('${p.id}', this.innerText)"
               onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault(); this.blur();} else if(event.key==='Escape'){event.preventDefault(); this.blur();}"
               title="Enter = salto de línea · Ctrl/Cmd+Enter o Esc para terminar">${p.desc}</div>
        </div>
      </div>
      <div><span class="id-tag" onclick="copyId(event,'${p.id}')" title="ID — clic para copiar"><span class="id-ico">ID</span><span class="id-num">${p.id}</span></span>${mcpEditBadge(p)}</div>
      <div class="row-actions">
        <button onclick="quickAddTask('${p.id}')" title="Agregar tarea a este proyecto">➕</button>
        <button class="${p.driveUrl?'drive-on':''}" onclick="manageDrive('${p.id}')" title="Carpeta de Drive: abrir o editar el link">📁</button>
        <button onclick="openEditProject('${p.id}')" title="Editar el proyecto (nombre, categoría, color)">✎</button>
        <button class="${p.hasLeads?'lead-on':''}" onclick="toggleHasLeads('${p.id}')" title="¿Tiene leads?">🎯 ${data.leads.filter(l=>l.projectId===p.id).length}</button>
        ${p.status==='active'
          ? `<button onclick="toggleStatus('${p.id}')" title="Pausar">⏸</button>`
          : `<button class="go" onclick="toggleStatus('${p.id}')" title="Reanudar">▶</button>`}
        <button class="go" onclick="finishProject('${p.id}')" title="Marcar como terminado">✓</button>
        <button class="danger" onclick="deleteProject('${p.id}')">🗑</button>
      </div>
    </div>
    ${expanded ? `<div class="row-detail" style="--accent-color:${areaColor};">
      <div class="task-list">${taskItems}${doneTasksBlock}</div>
      ${p.driveFolderId ? `
      <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
        <button class="btn-toggle" style="margin-top:0;" onclick="listDriveFiles('${p.id}')">📁 Cargar archivos de Drive</button>
        <div id="drivefiles-${p.id}" style="margin-top:8px;"></div>
      </div>` : ''}
    </div>` : ''}`;
  }

  let html = '';
  html += ordered.map(projectRow).join('');

  if(doneList.length){
    html += `<div class="done-projects-bar" onclick="toggleShowDoneProjects()"><span>✅ Proyectos terminados (${doneList.length})</span><span>${showDoneProjects?'▲':'▼'}</span></div>`;
    if(showDoneProjects){
      html += doneList.map(p=>{
        const area = areaInfo(p.area);
        return `<div class="row done-row pf-row" style="--accent-color:${p.color};">
          <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
            <span class="project-avatar" style="flex-shrink:0; background:${p.color};">${(p.name||'?').trim().charAt(0).toUpperCase()}</span>
            <div style="min-width:0; flex:1;"><div class="row-name" style="text-decoration:line-through; opacity:.7;">${p.name}</div></div>
          </div>
          <div><span class="status-pill status-done">Terminado</span></div>
          <div class="row-actions">
            <button class="go" onclick="reactivateProject('${p.id}')" title="Reactivar proyecto">↩</button>
            <button class="danger" onclick="deleteProject('${p.id}')">🗑</button>
          </div>
        </div>`;
      }).join('');
    }
  }

  cont.innerHTML = html;
}
function finishProject(id){
  const p = data.projects.find(x=>x.id===id);
  if(!p) return;
  p.status = 'done';
  p.completedAt = Date.now();
  save(); renderAll();
}
function reactivateProject(id){
  const p = data.projects.find(x=>x.id===id);
  if(!p) return;
  p.status = 'active';
  delete p.completedAt;
  save(); renderAll();
}
function toggleShowDoneProjects(){
  showDoneProjects = !showDoneProjects;
  renderProjectCards();
}
function toggleDoneTasks(pid){
  if(shownDoneTasks.has(pid)) shownDoneTasks.delete(pid);
  else shownDoneTasks.add(pid);
  renderProjectCards();
}
function getDescendantIds(id){
  const out = [];
  let stack = data.projects.filter(p=>p.parentId===id).map(p=>p.id);
  while(stack.length){
    const cur = stack.pop();
    out.push(cur);
    data.projects.filter(p=>p.parentId===cur).forEach(p=>stack.push(p.id));
  }
  return out;
}

/* ====== REORDENAR PROYECTOS (DRAG & DROP) ====== */
let draggedProjectId = null;
function dragStart(e){
  draggedProjectId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function clearDropClasses(){
  document.querySelectorAll('.row.drop-before, .row.drop-after, .row.drop-inside')
    .forEach(r=>r.classList.remove('drop-before','drop-after','drop-inside'));
}
function dropZoneAt(clientY, rowEl){
  const r = rowEl.getBoundingClientRect();
  const y = clientY - r.top;
  if(y < r.height*0.30) return 'before';
  if(y > r.height*0.70) return 'after';
  return 'inside';
}
function dropProject(fromId, targetId, zone){
  if(!fromId || !targetId || fromId===targetId) return;
  const from = data.projects.find(p=>p.id===fromId);
  const target = data.projects.find(p=>p.id===targetId);
  if(!from || !target) return;
  if(getDescendantIds(fromId).includes(targetId)) return; // no meter dentro de un hijo propio
  from.parentId = (zone==='inside') ? targetId : (target.parentId || null);
  const fromIdx = data.projects.indexOf(from);
  data.projects.splice(fromIdx, 1);
  let targetIdx = data.projects.indexOf(target);
  if(zone==='after' || zone==='inside') targetIdx += 1;
  data.projects.splice(targetIdx, 0, from);
  save(); renderAll();
}
function convertTaskToSubproject(taskId, parentProjectId){
  const t = data.tasks.find(x=>x.id===taskId);
  const parent = data.projects.find(p=>p.id===parentProjectId);
  if(!t || !parent) return;
  if(!confirm('¿Convertir la tarea «'+t.text+'» en subproyecto dentro de «'+parent.name+'»?')) return;
  const np = {id:uid('p'), name:(t.text||'Sin nombre'), area:parent.area, desc:'', status:'active', hasLeads:false, color:parent.color, icon:'', driveUrl:'', driveFolderId:'', contacts:[], context:(parent.context||'profesional'), parentId:parent.id};
  data.projects.push(np);
  data.tasks = data.tasks.filter(x=>x.id!==taskId);
  data.deletedTaskIds = data.deletedTaskIds || [];
  if(!data.deletedTaskIds.includes(taskId)) data.deletedTaskIds.push(taskId);
  save(); renderAll();
}
function convertProjectToTask(projectId, destProjectId, afterTaskId){
  const p = data.projects.find(x=>x.id===projectId);
  if(!p) return;
  if(destProjectId === projectId) return;
  const hasTasks = data.tasks.some(t=>t.projectId===projectId);
  const hasChildren = data.projects.some(x=>x.parentId===projectId);
  if(hasTasks || hasChildren){ alert('«'+p.name+'» tiene tareas o subproyectos. Movelos o vacialo antes de convertirlo en tarea.'); return; }
  const dest = data.projects.find(x=>x.id===destProjectId);
  if(!dest) return;
  if(!confirm('¿Convertir el proyecto «'+p.name+'» en una tarea de «'+dest.name+'»?')) return;
  const nt = {id:uid('t'), projectId:destProjectId, text:p.name, done:false, dueDate:null, dueTime:null, priority:'medium', emailAlert:false, alertSent:false, driveUrl:''};
  const idx = data.tasks.findIndex(t=>t.id===afterTaskId);
  if(idx>=0) data.tasks.splice(idx+1, 0, nt); else data.tasks.push(nt);
  data.projects = data.projects.filter(x=>x.id!==projectId);
  data.deletedProjectIds = data.deletedProjectIds || [];
  if(!data.deletedProjectIds.includes(projectId)) data.deletedProjectIds.push(projectId);
  expandedProjects.add(destProjectId);
  save(); renderAll();
}
function dragOver(e){
  e.preventDefault();
  const row = e.currentTarget;
  if(draggedTaskId && !draggedProjectId){
    row.classList.remove('drop-before','drop-after','drop-inside');
    row.classList.add('drop-inside');
    return;
  }
  if(row.dataset.id === draggedProjectId) return;
  if(draggedProjectId && getDescendantIds(draggedProjectId).includes(row.dataset.id)) return;
  const zone = dropZoneAt(e.clientY, row);
  row.classList.remove('drop-before','drop-after','drop-inside');
  row.classList.add('drop-'+zone);
}
function dragLeave(e){
  e.currentTarget.classList.remove('drop-before','drop-after','drop-inside');
}
function dragDrop(e){
  e.preventDefault();
  const row = e.currentTarget;
  if(draggedTaskId && !draggedProjectId){
    clearDropClasses();
    convertTaskToSubproject(draggedTaskId, row.dataset.id);
    return;
  }
  const zone = row.classList.contains('drop-inside') ? 'inside'
             : row.classList.contains('drop-after') ? 'after' : 'before';
  clearDropClasses();
  dropProject(draggedProjectId, row.dataset.id, zone);
}
function dragEnd(e){
  e.currentTarget.classList.remove('dragging');
  clearDropClasses();
  document.querySelectorAll('.task.drag-over-task').forEach(t=>t.classList.remove('drag-over-task'));
  draggedProjectId = null;
}

/* ====== REORDENAR TAREAS DENTRO DEL PROYECTO ====== */
let draggedTaskId = null;
function taskDragStart(e){
  draggedTaskId = e.currentTarget.dataset.taskId;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function taskDragOver(e){
  e.preventDefault();
  if(e.currentTarget.dataset.taskId !== draggedTaskId) e.currentTarget.classList.add('drag-over-task');
}
function taskDragLeave(e){
  e.currentTarget.classList.remove('drag-over-task');
}
function taskDrop(e){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over-task');
  const taskId = e.currentTarget.dataset.taskId;
  if(draggedProjectId && !draggedTaskId){
    const tk = data.tasks.find(t=>t.id===taskId);
    if(tk) convertProjectToTask(draggedProjectId, tk.projectId, taskId);
    return;
  }
  reorderTasks(draggedTaskId, taskId);
}
function reorderTasks(fromId, toId){
  if(!fromId || !toId || fromId === toId) return;
  const fromIdx = data.tasks.findIndex(t=>t.id===fromId);
  const toIdx = data.tasks.findIndex(t=>t.id===toId);
  if(fromIdx<0 || toIdx<0) return;
  const [moved] = data.tasks.splice(fromIdx, 1);
  data.tasks.splice(toIdx, 0, moved);
  save(); renderAll();
}
function taskDragEnd(e){
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.task.drag-over-task').forEach(t=>t.classList.remove('drag-over-task'));
  draggedTaskId = null;
}

/* ====== ARRASTRE TÁCTIL (celular) — reusa reorderTasks / reorderProjects ====== */
let activeTouchDrag = null;
function startTouchDrag(e, type, id){
  // arranca solo desde la manija ⠿, así el resto de la fila scrollea normal
  e.preventDefault();
  e.stopPropagation();
  const sel = type === 'task' ? '.task' : '.row';
  const el = e.currentTarget.closest(sel);
  if(!el) return;
  activeTouchDrag = { type, id, el, sel, overTarget: null, overZone: null };
  el.classList.add('dragging');
  document.addEventListener('touchmove', onTouchDragMove, { passive:false });
  document.addEventListener('touchend', onTouchDragEnd);
  document.addEventListener('touchcancel', onTouchDragEnd);
}
function onTouchDragMove(e){
  if(!activeTouchDrag) return;
  e.preventDefault(); // evita que la página scrollee mientras arrastrás
  const t = e.touches[0];
  if(!t) return;
  const { el, type, id } = activeTouchDrag;
  document.querySelectorAll('.task.drag-over-task').forEach(x=>x.classList.remove('drag-over-task'));
  clearDropClasses();
  activeTouchDrag.overTarget = null; activeTouchDrag.overKind = null; activeTouchDrag.overZone = null;
  const under = document.elementFromPoint(t.clientX, t.clientY);
  if(!under) return;
  if(type === 'task'){
    const task = under.closest('.task');
    if(task && task !== el){ task.classList.add('drag-over-task'); activeTouchDrag.overTarget = task; activeTouchDrag.overKind = 'reorderTask'; return; }
    const row = under.closest('.row');
    if(row){ row.classList.add('drop-inside'); activeTouchDrag.overTarget = row; activeTouchDrag.overKind = 'toSubproject'; return; }
  } else {
    const task = under.closest('.task');
    if(task){ task.classList.add('drag-over-task'); activeTouchDrag.overTarget = task; activeTouchDrag.overKind = 'toTask'; return; }
    const row = under.closest('.row');
    if(row && row !== el){
      if(getDescendantIds(id).includes(row.dataset.id)) return;
      const zone = dropZoneAt(t.clientY, row);
      row.classList.add('drop-'+zone);
      activeTouchDrag.overTarget = row; activeTouchDrag.overKind = 'reorderProject'; activeTouchDrag.overZone = zone;
      return;
    }
  }
}
function onTouchDragEnd(){
  if(!activeTouchDrag) return;
  const { type, id, el, overTarget, overKind, overZone } = activeTouchDrag;
  el.classList.remove('dragging');
  document.querySelectorAll('.task.drag-over-task').forEach(x=>x.classList.remove('drag-over-task'));
  clearDropClasses();
  document.removeEventListener('touchmove', onTouchDragMove, { passive:false });
  document.removeEventListener('touchend', onTouchDragEnd);
  document.removeEventListener('touchcancel', onTouchDragEnd);
  activeTouchDrag = null;
  if(!overTarget) return;
  if(overKind === 'reorderTask') reorderTasks(id, overTarget.dataset.taskId);
  else if(overKind === 'toSubproject') convertTaskToSubproject(id, overTarget.dataset.id);
  else if(overKind === 'toTask'){ const tk = data.tasks.find(x=>x.id===overTarget.dataset.taskId); if(tk) convertProjectToTask(id, tk.projectId, overTarget.dataset.taskId); }
  else if(overKind === 'reorderProject') dropProject(id, overTarget.dataset.id, overZone || 'before');
}

function editDesc(id, newDesc){
  const desc = newDesc.trim();
  const p = projectInfo(id);
  if(desc===p.desc) return;
  p.desc = desc;
  p.userUpdatedAt = new Date().toISOString();  // marca de autor: vos (cambio de texto)
  save(); renderAll();
}
function renameProject(id, newName){
  const name = newName.trim();
  const p = projectInfo(id);
  if(!name || name===p.name){ renderProjectCards(); return; }
  p.name = name;
  p.userUpdatedAt = new Date().toISOString();  // autor: vos (cambio de texto)
  save(); renderAll();
}
function toggleExpand(id){
  if(expandedProjects.has(id)) expandedProjects.delete(id);
  else expandedProjects.add(id);
  renderProjectCards();
}
function toggleCollapse(id){
  if(collapsedProjects.has(id)) collapsedProjects.delete(id);
  else collapsedProjects.add(id);
  saveCollapsed();
  renderProjectCards();
}
let _treeLevel = (function(){ const v = parseInt(localStorage.getItem('kingdom_treelevel'),10); return (v===1||v===2||v===3) ? v : 2; })();
function cycleTreeLevel(){
  _treeLevel = _treeLevel>=3 ? 1 : _treeLevel+1;
  applyTreeLevel(true, true);
}
function applyTreeLevel(persist, render){
  if(_treeLevel===1){            // solo proyectos principales
    collapsedProjects = new Set(data.projects.filter(p=>p.parentId).map(p=>p.parentId));
    expandedProjects.clear();
  } else if(_treeLevel===2){     // + subproyectos
    collapsedProjects.clear();
    expandedProjects.clear();
  } else {                       // + tareas
    collapsedProjects.clear();
    expandedProjects = new Set(data.projects.map(p=>p.id));
  }
  saveCollapsed();
  if(persist){ try{ localStorage.setItem('kingdom_treelevel', String(_treeLevel)); }catch(_){} }
  updateTreeButton();
  if(render!==false) renderProjectCards();
}
function updateTreeButton(){
  const badge = document.getElementById('treeLevelBadge');
  if(badge) badge.textContent = String(_treeLevel);
  const btn = document.getElementById('treeLevelBtn');
  if(btn){
    btn.title = [
      'Mostrando solo proyectos · tocá para abrir subproyectos',
      'Mostrando subproyectos · tocá para abrir tareas',
      'Mostrando tareas · tocá para contraer todo'
    ][_treeLevel-1];
  }
}
// compatibilidad por si quedaron llamadas a las funciones viejas
function collapseAllProjects(){ _treeLevel = 1; applyTreeLevel(true, true); }
function expandAllProjects(){ _treeLevel = 2; applyTreeLevel(true, true); }
function toggleHasLeads(id){
  const p = projectInfo(id);
  p.hasLeads = !p.hasLeads;
  save(); renderAll();
}
function toggleStatus(id){
  const p = projectInfo(id);
  p.status = p.status==='active' ? 'paused' : 'active';
  save(); renderAll();
}
function deleteProject(id){
  if(!confirm('¿Mover este proyecto y sus tareas a Eliminados?')) return;
  data.trash = data.trash || [];
  data.deletedProjectIds = data.deletedProjectIds || [];
  data.deletedTaskIds = data.deletedTaskIds || [];
  const proj = data.projects.find(p=>p.id===id);
  const projTasks = data.tasks.filter(t=>t.projectId===id);
  if(proj) data.trash.push({type:'project', deletedAt:new Date().toISOString(), item:JSON.parse(JSON.stringify(proj)), tasks:JSON.parse(JSON.stringify(projTasks))});
  if(!data.deletedProjectIds.includes(id)) data.deletedProjectIds.push(id);
  projTasks.forEach(t=>{ if(!data.deletedTaskIds.includes(t.id)) data.deletedTaskIds.push(t.id); });
  data.projects = data.projects.filter(p=>p.id!==id);
  data.tasks = data.tasks.filter(t=>t.projectId!==id);
  data.leads.forEach(l=>{ if(l.projectId===id) l.projectId=''; });
  save(); renderAll();
}
function addProject(){
  const name = document.getElementById('np-name').value.trim();
  if(!name){ alert('Falta el nombre del proyecto'); return; }
  const parentId = document.getElementById('np-parent') ? document.getElementById('np-parent').value : '';
  let area, context;
  if(parentId){
    const par = data.projects.find(x=>x.id===parentId);
    area = par ? par.area : document.getElementById('np-area').value;
    context = par ? (par.context||'profesional') : document.getElementById('np-context').value;
  } else {
    area = document.getElementById('np-area').value;
    context = document.getElementById('np-context').value;
  }
  const desc = document.getElementById('np-desc').value.trim();
  const ai = areaInfo(area);
  const color = ai ? ai.color : '#6b7280';
  const proj = {id:uid('p'), name, area, desc, status:'active', hasLeads:false, color, icon:'', driveUrl:'', driveFolderId:'', contacts:[], context, parentId: parentId || null};
  data.projects.push(proj);
  document.getElementById('np-name').value='';
  document.getElementById('np-desc').value='';
  const npp = document.getElementById('np-parent'); if(npp) npp.value='';
  closeProjectModal();
  save(); renderAll();
}

/* ====== RENDER PROYECTOS CON LEADS ====== */
function renderLeadsDropdown(){
  const trigger = document.getElementById('leadsDropdownLabel');
  const panel = document.getElementById('leadsDropdownPanel');
  const projects = data.projects.filter(p=>p.hasLeads);

  [...activeLeadsProjects].forEach(id=>{ if(!projects.some(p=>p.id===id)) activeLeadsProjects.delete(id); });

  if(activeLeadsProjects.size===0) trigger.textContent = 'Todos los proyectos';
  else if(activeLeadsProjects.size===1) trigger.textContent = projectInfo([...activeLeadsProjects][0]).name;
  else trigger.textContent = `${activeLeadsProjects.size} proyectos seleccionados`;

  let html = `<div class="glass-option ${activeLeadsProjects.size===0?'selected':''}" onclick="clearLeadsFilter()">
    <div class="sheet-left"><span>Todos los proyectos</span></div>
    ${activeLeadsProjects.size===0?'<div class="sheet-check"></div>':'<div class="sheet-check-empty"></div>'}
  </div><div class="glass-divider"></div>`;
  html += projects.map(p=>`
    <div class="glass-option ${activeLeadsProjects.has(p.id)?'selected':''}" onclick="toggleLeadsFilter('${p.id}')">
      <div class="sheet-left"><span class="dot" style="background:${p.color}"></span><span>${p.name}</span></div>
      ${activeLeadsProjects.has(p.id)?'<div class="sheet-check"></div>':'<div class="sheet-check-empty"></div>'}
    </div>`).join('');
  panel.innerHTML = html || '<div class="empty">No hay proyectos marcados con leads.</div>';
}
function toggleLeadsDropdown(){
  document.getElementById('leadsProjectDropdown').classList.toggle('open');
}
document.addEventListener('click', (e)=>{
  const dd = document.getElementById('leadsProjectDropdown');
  if(dd && !dd.contains(e.target)) dd.classList.remove('open');
});
function toggleLeadsFilter(id){
  if(activeLeadsProjects.has(id)) activeLeadsProjects.delete(id);
  else activeLeadsProjects.add(id);
  renderLeadProjects(); renderKanban(); populateSelects();
}
function clearLeadsFilter(){
  activeLeadsProjects.clear();
  renderLeadProjects(); renderKanban(); populateSelects();
}
function renderLeadProjects(){
  renderLeadsDropdown();
  const cont = document.getElementById('leadProjectCards');
  let projects = data.projects.filter(p=>p.hasLeads);
  if(activeLeadsProjects.size>0) projects = projects.filter(p=>activeLeadsProjects.has(p.id));
  if(projects.length===0){
    cont.innerHTML = '<div class="empty">Ningún proyecto está marcado con leads. Marcalo con el botón 🎯 en la pestaña Portafolio.</div>';
    return;
  }
  cont.innerHTML = `<div class="row-head"><div>Proyecto</div><div>Área</div><div>Leads</div><div></div></div>` +
  projects.map(p=>{
    const area = areaInfo(p.area);
    const count = data.leads.filter(l=>l.projectId===p.id).length;
    return `
    <div class="row" style="--accent-color:${p.color}">
      <div></div>
      <div class="row-name">${p.name}</div>
      <div class="area-tag" style="background:${area.color}22; color:${area.color};">${area.name}</div>
      <div style="font-size:.8rem; font-weight:700;">${count}</div>
      <div></div>
    </div>`;
  }).join('');
}

/* ====== RENDER KANBAN ====== */
function renderKanban(){
  const cont = document.getElementById('kanban');
  cont.innerHTML = STAGES.map(stage=>{
    const leads = data.leads.filter(l=>l.stage===stage.id && (activeLeadsProjects.size===0 || activeLeadsProjects.has(l.projectId)));
    const cards = leads.length ? leads.map(l=>{
      const proj = l.projectId ? projectInfo(l.projectId) : null;
      const stageOptions = STAGES.map(s=>`<option value="${s.id}" ${s.id===stage.id?'selected':''}>${s.name}</option>`).join('');
      return `
      <div class="lead" draggable="true" data-lead-id="${l.id}"
           ondragstart="leadDragStart(event)" ondragend="leadDragEnd(event)"
           style="border-left:3px solid ${proj?proj.color:'var(--border)'}">
        <button class="lead-del" onclick="deleteLead('${l.id}')">✕</button>
        <div class="lead-name">${l.name}</div>
        ${proj ? `<div class="lead-project">${proj.name}</div>` : `<div class="lead-project">Sin proyecto</div>`}
        <select onchange="moveLead('${l.id}', this.value)">${stageOptions}</select>
      </div>`;
    }).join('') : '<div class="empty" style="padding:6px 0;">Sin leads</div>';

    return `
    <div class="kanban-col" data-stage="${stage.id}" style="--stage-color:${stage.color}"
         ondragover="leadDragOver(event)" ondragleave="leadDragLeave(event)" ondrop="leadDrop(event)">
      <h3>${stage.name} <span>${leads.length}</span></h3>
      <div class="kanban-col-body">${cards}</div>
    </div>`;
  }).join('');
}
/* ====== DRAG & DROP DE LEADS ====== */
let draggedLeadId = null;
function leadDragStart(e){
  draggedLeadId = e.currentTarget.dataset.leadId;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function leadDragEnd(e){
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.kanban-col.drag-over').forEach(c=>c.classList.remove('drag-over'));
  draggedLeadId = null;
}
function leadDragOver(e){
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function leadDragLeave(e){
  e.currentTarget.classList.remove('drag-over');
}
function leadDrop(e){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const stage = e.currentTarget.dataset.stage;
  if(!draggedLeadId) return;
  moveLead(draggedLeadId, stage);
}
function moveLead(id, stage){
  const lead = data.leads.find(l=>l.id===id);
  lead.stage = stage;
  save(); renderAll();
}
function deleteLead(id){
  data.leads = data.leads.filter(l=>l.id!==id);
  save(); renderAll();
}
function addLead(){
  const name = document.getElementById('nl-name').value.trim();
  const projectId = document.getElementById('nl-project').value;
  const stage = document.getElementById('nl-stage').value;
  if(!name){ alert('Falta el nombre del lead'); return; }
  data.leads.push({id:uid('l'), name, projectId, stage});
  document.getElementById('nl-name').value='';
  document.getElementById('addLeadBox').classList.add('collapsed');
  save(); renderAll();
}

/* ====== RENDER TAREAS ====== */
let taskSort = 'date'; // 'date' | 'priority'
function toggleTaskSort(){
  taskSort = taskSort==='date' ? 'priority' : 'date';
  const btn = document.getElementById('sortToggle');
  if(btn) btn.textContent = taskSort==='date' ? '📅 Fecha' : '😢 Importancia';
  renderAll();
}
const PRIORITY_ORDER = { high:0, medium:1, low:2 };
function setTaskFilter(f){
  taskFilter = f;
  document.querySelectorAll('.task-filters .chip').forEach(c=>c.classList.toggle('active', c.dataset.tf===f));
  renderTasks();
  if(calView) renderCalendar();
  if(document.getElementById('dayView').style.display !== 'none' && currentDayIso) renderDayView(currentDayIso);
}
function renderTasks(){
  const cont = document.getElementById('taskList');
  const activeProjectIds = data.projects.filter(p=>p.status==='active').map(p=>p.id);
  let tasks = data.tasks.filter(t=> activeArea==='all' || activeProjectIds.includes(t.projectId) && projectInfo(t.projectId).area===activeArea);
  // si no hay filtro de área, igual restringimos a proyectos activos por defecto en pendientes
  if(activeArea==='all'){
    tasks = data.tasks.filter(t=> activeProjectIds.includes(t.projectId) || taskFilter!=='pending');
  }
  if(taskFilter==='pending') tasks = tasks.filter(t=>!t.done);
  if(taskFilter==='done') tasks = tasks.filter(t=>t.done);
  if(activeProjects.size>0) tasks = tasks.filter(t=>activeProjects.has(t.projectId));

  if(taskSort==='priority'){
    tasks = tasks.slice().sort((a,b)=> (PRIORITY_ORDER[a.priority||'medium']||1) - (PRIORITY_ORDER[b.priority||'medium']||1));
  } else {
    tasks = tasks.slice().sort((a,b)=> (a.dueDate||'9999') < (b.dueDate||'9999') ? -1 : 1);
  }

  if(tasks.length===0){
    cont.innerHTML = '<div class="empty">No hay tareas en esta vista.</div>';
    return;
  }

  cont.innerHTML = tasks.map(t=>{
    const proj = projectInfo(t.projectId);
    let badge = '';
    if(t.dueDate){
      const today = new Date(); today.setHours(0,0,0,0);
      const due = new Date(t.dueDate + 'T00:00:00');
      const diffDays = Math.round((due-today)/86400000);
      let cls='due-upcoming', label=formatDate(t.dueDate);
      if(diffDays < 0 && !t.done){ cls='due-overdue'; label='Vencida · '+formatDate(t.dueDate); }
      else if(diffDays === 0 && !t.done){ cls='due-today'; label='Vence hoy'; }
      badge = `<span class="due-badge ${cls}" onclick="editTaskDate('${t.id}', this)" style="cursor:pointer;" title="Tocar para cambiar fecha">${label}</span>`;
    } else {
      badge = `<span class="due-badge" onclick="editTaskDate('${t.id}', this)" style="cursor:pointer;background:transparent;border:1px dashed var(--border);color:var(--muted);" title="Agregar fecha">+ fecha</span>`;
    }
    return `
    <div class="task ${t.done?'done':''}">
      <input type="checkbox" ${t.done?'checked':''} onchange="toggleTask('${t.id}')">
      <span class="proj-dot" style="background:${proj?proj.color:'var(--muted)'}"></span>
      <div class="task-body">
        <div class="task-project">${proj ? proj.name : '—'}</div>
        <div class="task-text">${t.text}</div>
        ${badge}
      </div>
      <button class="task-del" style="color:var(--muted);" onclick="openEditTask('${t.id}')" title="Editar">⋯</button>
      <button class="task-del" onclick="deleteTask('${t.id}')">✕</button>
    </div>`;
  }).join('');
}
function editTaskDate(id, el){
  const existing = document.getElementById('datepopover');
  if(existing){ const same = existing.dataset.tid===id; closeDatePopover(); if(same) return; }

  const t = data.tasks.find(t=>t.id===id);
  const pop = document.createElement('div');
  pop.id = 'datepopover';
  pop.dataset.tid = id;
  pop.style.cssText = 'position:fixed;z-index:900;background:var(--panel);border:1.5px solid var(--accent);border-radius:10px;padding:8px 10px;box-shadow:0 4px 20px rgba(0,0,0,0.18);display:flex;align-items:center;gap:8px;';

  const inp = document.createElement('input');
  inp.type = 'date';
  inp.value = t.dueDate || '';
  inp.style.cssText = 'font-size:.85rem;border:none;background:transparent;color:var(--text);outline:none;';
  inp.onchange = e=>{ t.dueDate = e.target.value; t.dueSoonAlertSent=false; t.overdueAlertSent=false; save(); };

  const inpTime = document.createElement('input');
  inpTime.type = 'time';
  inpTime.value = t.dueTime || '';
  inpTime.style.cssText = 'font-size:.85rem;border:none;background:transparent;color:var(--text);outline:none;border-left:1px solid var(--border);padding-left:8px;';
  inpTime.onchange = e=>{ t.dueTime = e.target.value; t.dueSoonAlertSent=false; t.overdueAlertSent=false; save(); };

  const btn = document.createElement('button');
  btn.textContent = '✕';
  btn.style.cssText = 'border:none;background:none;color:var(--muted);cursor:pointer;font-size:.8rem;padding:0;';
  btn.onclick = closeDatePopover;

  pop.appendChild(inp);
  pop.appendChild(inpTime);
  pop.appendChild(btn);
  document.body.appendChild(pop);

  const r = el ? el.getBoundingClientRect() : {bottom:100,left:100};
  const top = Math.min(r.bottom + 6, window.innerHeight - 80);
  const left = Math.min(r.left, window.innerWidth - 260);
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';

  // cerrar al tocar afuera o con Escape
  pop._outside = (ev)=>{ if(!pop.contains(ev.target)) closeDatePopover(); };
  pop._esc = (ev)=>{ if(ev.key==='Escape') closeDatePopover(); };
  setTimeout(()=>{ document.addEventListener('mousedown', pop._outside); document.addEventListener('keydown', pop._esc); }, 50);

  setTimeout(()=>inp.focus(), 30);
  setTimeout(()=>{ try{ inp.showPicker && inp.showPicker(); }catch(_){} }, 60);
}
function closeDatePopover(){
  const pop = document.getElementById('datepopover');
  if(!pop) return;
  if(pop._outside) document.removeEventListener('mousedown', pop._outside);
  if(pop._esc) document.removeEventListener('keydown', pop._esc);
  pop.remove();
  renderAll();
}
function toggleTask(id){
  const t = data.tasks.find(t=>t.id===id);
  t.done = !t.done;
  save(); renderAll();
}
function deleteTask(id){
  data.trash = data.trash || [];
  data.deletedTaskIds = data.deletedTaskIds || [];
  const t = data.tasks.find(t=>t.id===id);
  if(t) data.trash.push({type:'task', deletedAt:new Date().toISOString(), item:JSON.parse(JSON.stringify(t))});
  if(!data.deletedTaskIds.includes(id)) data.deletedTaskIds.push(id);
  data.tasks = data.tasks.filter(t=>t.id!==id);
  save(); renderAll();
}
function confirmDeleteTask(id){
  if(!confirm('¿Mover esta tarea a Eliminados?')) return;
  deleteTask(id);
}
function convertTaskToProject(id){
  const t = data.tasks.find(t=>t.id===id);
  if(!t) return;
  const suggested = (t.text||'').slice(0,40);
  const name = prompt('Nombre del nuevo proyecto:', suggested);
  if(name===null) return;
  const finalName = name.trim() || suggested || 'Proyecto nuevo';
  const proj = {id:uid('p'), name:finalName, area:null, desc:'', status:'active', hasLeads:false, color:'#8a919e', icon:'', driveUrl:'', driveFolderId:'', contacts:[], context:'personal'};
  data.projects.push(proj);
  t.projectId = proj.id;
  save(); renderAll();
  alert('Proyecto "'+finalName+'" creado. La tarea quedó adentro. Ajustá su área o sección en el Portafolio si querés.');
}
function convertTaskFromModal(){
  const id = document.getElementById('et-id').value;
  closeEditTaskModal();
  convertTaskToProject(id);
}
/* ====== PAPELERA / ELIMINADOS ====== */
function purgeOldTrash(){
  if(!data || !data.trash || !data.trash.length) return;
  const cutoff = Date.now() - 30*24*60*60*1000;
  const before = data.trash.length;
  data.trash = data.trash.filter(e=> !e.deletedAt || new Date(e.deletedAt).getTime() > cutoff);
  if(data.trash.length !== before){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){} }
}
function openTrash(){ renderTrash(); document.getElementById('trashModalOverlay').classList.add('open'); }
function closeTrash(){ document.getElementById('trashModalOverlay').classList.remove('open'); }
function renderTrash(){
  const cont = document.getElementById('trashList');
  const trash = data.trash || [];
  const cnt = document.getElementById('trashCount');
  if(cnt) cnt.textContent = trash.length;
  if(!trash.length){ cont.innerHTML = '<div class="empty">No hay nada en Eliminados.</div>'; return; }
  cont.innerHTML = trash.map((e,i)=>{
    const when = e.deletedAt ? new Date(e.deletedAt).toLocaleDateString('es-CL') : '';
    const label = e.type==='project'
      ? `📁 Proyecto: ${e.item.name} <span style="color:var(--muted);">(${(e.tasks||[]).length} tareas)</span>`
      : `✓ ${e.item.text}`;
    return `<div class="trash-row">
      <div class="trash-label">${label}<div class="trash-when">${when}</div></div>
      <div class="trash-actions">
        <button class="priority-btn" onclick="restoreTrashItem(${i})">↩︎ Restaurar</button>
        <button class="priority-btn task-del-btn" onclick="purgeTrashItem(${i})">🗑 Borrar</button>
      </div>
    </div>`;
  }).join('');
}
function restoreTrashItem(idx){
  data.trash = data.trash || [];
  const entry = data.trash[idx];
  if(!entry) return;
  if(entry.type==='task'){
    let pid = entry.item.projectId;
    if(!data.projects.find(p=>p.id===pid)) pid = 'inbox';
    entry.item.projectId = pid;
    data.tasks.push(entry.item);
    data.deletedTaskIds = (data.deletedTaskIds||[]).filter(x=>x!==entry.item.id);
  } else if(entry.type==='project'){
    data.projects.push(entry.item);
    data.deletedProjectIds = (data.deletedProjectIds||[]).filter(x=>x!==entry.item.id);
    (entry.tasks||[]).forEach(t=>{
      data.tasks.push(t);
      data.deletedTaskIds = (data.deletedTaskIds||[]).filter(x=>x!==t.id);
    });
  }
  data.trash.splice(idx,1);
  save(); renderTrash(); renderAll();
}
function purgeTrashItem(idx){
  if(!confirm('¿Borrar definitivamente? Esto no se puede deshacer.')) return;
  data.trash = data.trash || [];
  data.trash.splice(idx,1);
  save(); renderTrash();
}
function emptyTrash(){
  if(!(data.trash||[]).length) return;
  if(!confirm('¿Vaciar Eliminados? Se borra todo definitivamente.')) return;
  data.trash = [];
  save(); renderTrash();
}
function editTaskText(id, newText){
  const text = (newText||'').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  const t = data.tasks.find(t=>t.id===id);
  if(!t) return;
  if(!text || text===t.text){ renderProjectCards(); return; }
  t.text = text;
  t.userUpdatedAt = new Date().toISOString();  // marca de autor: vos (cambio de texto)
  save(); renderAll();
}
function formatDate(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}`;
}
function fmtShort(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}`;
}
function addTask(){
  const projectId = document.getElementById('nt-project-id').value;
  const text = document.getElementById('nt-text').value.trim();
  const dueDate = document.getElementById('nt-due').value;
  const dueTime = document.getElementById('nt-time').value;
  const emailAlert = document.getElementById('nt-alert').checked;
  if(!projectId){ alert('Elegí un proyecto'); return; }
  if(!text){ alert('Falta la descripción de la tarea'); return; }
  const priority = getSelectedPriority();
  data.tasks.push({id:uid('t'), projectId, text, done:false, dueDate, dueTime, priority, emailAlert, alertSent:false, driveUrl:''});
  document.getElementById('nt-text').value='';
  document.getElementById('nt-due').value='';
  document.getElementById('nt-time').value='';
  document.getElementById('nt-alert').checked=false;
  selectPriority('high'); // reset to default
  closeTaskModal();
  save(); renderAll();
}

/* ====== EDITAR TAREA (MODAL) ====== */
function fillEditProjectSelect(selectedId){
  const sel = document.getElementById('et-project');
  const per = data.projects.filter(p=>(p.context||'profesional')==='personal');
  const pro = data.projects.filter(p=>(p.context||'profesional')!=='personal');
  let html='';
  if(pro.length) html += `<optgroup label="💼 Profesional">`+pro.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')+`</optgroup>`;
  if(per.length) html += `<optgroup label="🏠 Personal">`+per.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')+`</optgroup>`;
  sel.innerHTML = html;
  if(selectedId) sel.value = selectedId;
}
function selectEditPriority(p){
  document.querySelectorAll('#et-priority-group .priority-btn').forEach(b=>b.classList.toggle('active', b.dataset.priority===p));
  document.getElementById('et-priority').value = p;
}
function openEditTask(id){
  const t = data.tasks.find(t=>t.id===id);
  if(!t) return;
  document.getElementById('et-id').value = id;
  fillEditProjectSelect(t.projectId);
  document.getElementById('et-text').value = t.text || '';
  document.getElementById('et-due').value = t.dueDate || '';
  document.getElementById('et-time').value = t.dueTime || '';
  selectEditPriority(t.priority || 'medium');
  document.getElementById('editTaskModalOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('et-text').focus(), 50);
}
function closeEditTaskModal(){
  document.getElementById('editTaskModalOverlay').classList.remove('open');
}
function saveEditTask(){
  const id = document.getElementById('et-id').value;
  const t = data.tasks.find(t=>t.id===id);
  if(!t) return;
  const text = document.getElementById('et-text').value.trim();
  if(!text){ alert('La tarea no puede quedar sin descripción'); return; }
  const textoCambio = (text !== t.text);   // marca de autor solo si cambia el texto
  t.projectId = document.getElementById('et-project').value || t.projectId;
  t.text = text;
  const newDue = document.getElementById('et-due').value;
  const newTime = document.getElementById('et-time').value;
  if(newDue!==t.dueDate || newTime!==t.dueTime){ t.dueSoonAlertSent=false; t.overdueAlertSent=false; }
  t.dueDate = newDue;
  t.dueTime = newTime;
  t.priority = document.getElementById('et-priority').value || 'medium';
  if(textoCambio) t.userUpdatedAt = new Date().toISOString();  // autor: vos (cambio de texto)
  closeEditTaskModal();
  save(); renderAll();
}
function deleteTaskFromModal(){
  const id = document.getElementById('et-id').value;
  if(!confirm('¿Eliminar esta tarea?')) return;
  closeEditTaskModal();
  deleteTask(id);
}

/* ====== SELECTS AUXILIARES ====== */
function populateSelects(){
  const ctx = document.getElementById('np-context') ? document.getElementById('np-context').value : 'profesional';
  const areaSel = document.getElementById('np-area');
  const filteredAreas = data.areas.filter(a=> (a.context||'profesional') === ctx);
  areaSel.innerHTML = filteredAreas.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');

  const stageSel = document.getElementById('nl-stage');
  stageSel.innerHTML = STAGES.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');

  const projOptions = _projOptionsHierarchy();
  document.getElementById('nl-project').innerHTML = '<option value="">Sin proyecto vinculado</option>' + projOptions;
  const npParent = document.getElementById('np-parent');
  if(npParent){ const cur = npParent.value; npParent.innerHTML = '<option value="">Proyecto principal (sin padre)</option>' + projOptions; npParent.value = cur; }
}
function _rootOf(id){
  let p = data.projects.find(x=>x.id===id);
  while(p && p.parentId){ const par = data.projects.find(x=>x.id===p.parentId); if(!par) break; p = par; }
  return p ? p.id : id;
}
function _projOptionsHierarchy(){
  const out = [];
  const kids = pid => data.projects.filter(p=>p.status==='active' && (p.parentId||null)===(pid||null));
  (function walk(pid, depth){
    kids(pid).forEach(p=>{
      const prefix = depth>0 ? ('\u00A0\u00A0\u00A0'.repeat(depth) + '└ ') : '';
      out.push(`<option value="${p.id}">${prefix}${p.name}</option>`);
      walk(p.id, depth+1);
    });
  })(null, 0);
  return out.join('');
}

/* ====== EMAIL: BANNER Y CHEQUEO DE VENCIDAS ====== */
function renderEmailBanner(){
  const el = document.getElementById('emailConfigBanner');
  if(EMAILJS_READY){
    el.className = 'config-banner ok';
    el.textContent = '✓ Alertas por correo configuradas. Se revisan tareas vencidas con "Avisarme por correo" al abrir este dashboard.';
  }else{
    el.className = 'config-banner';
    el.textContent = '⚠ Alertas por correo sin configurar. Completá EMAILJS_CONFIG en el código (Service ID, Template ID, Public Key, email de destino) para activarlas. Mientras tanto, los vencimientos se muestran igual de forma visual.';
  }
}

function checkOverdueAlerts(){
  if(!EMAILJS_READY || typeof emailjs === 'undefined') return;
  const today = new Date(); today.setHours(0,0,0,0);
  let changed = false;
  data.tasks.forEach(t=>{
    if(!t.emailAlert || t.done || !t.dueDate || t.alertSent) return;
    const due = new Date(t.dueDate + 'T00:00:00');
    if(due <= today){
      const proj = projectInfo(t.projectId);
      emailjs.send(EMAILJS_CONFIG.SERVICE_ID, EMAILJS_CONFIG.TEMPLATE_ID, {
        to_email: EMAILJS_CONFIG.TO_EMAIL,
        task_text: t.text,
        project_name: proj ? proj.name : '—',
        due_date: formatDate(t.dueDate)
      }).then(()=>{
        t.alertSent = true;
        save();
      }).catch(err=>{ console.error('Error enviando alerta de correo:', err); });
    }
  });
}

/* ====== VISTA CALENDARIO ====== */
let calView = true;
let calDate = new Date(); calDate.setDate(1);
const DOW = ['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'];
const MONTH_NAMES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function toggleView(){
  calView = !calView;
  document.getElementById('taskList').style.display = calView ? 'none' : '';
  document.getElementById('calendarView').style.display = calView ? '' : 'none';
  document.getElementById('dayView').style.display = 'none';
  document.getElementById('viewToggle').textContent = calView ? '📋 Ver detalle' : '📅 Ver calendario';
  if(calView) renderCalendar();
}
function calNav(dir){
  calDate.setMonth(calDate.getMonth()+dir);
  renderCalendar();
}
function renderCalendar(){
  const cont = document.getElementById('calendarView');
  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);

  let html = `
    <div class="cal-header">
      <div class="cal-title">${MONTH_NAMES[month]} ${year}</div>
      <div class="cal-nav">
        <button onclick="calNav(-1)">‹</button>
        <button onclick="calNav(1)">›</button>
      </div>
    </div>
    <div class="cal-grid">`;
  DOW.forEach(d=> html += `<div class="cal-dow">${d}</div>`);
  for(let i=0;i<firstDow;i++) html += `<div class="cal-cell empty"></div>`;

  for(let day=1; day<=daysInMonth; day++){
    const cellDate = new Date(year, month, day);
    const iso = cellDate.toISOString().slice(0,10);
    const isToday = cellDate.getTime() === today.getTime();
    let dayTasks = data.tasks.filter(t=>t.dueDate===iso && (activeProjects.size===0 || activeProjects.has(t.projectId)));
    if(taskFilter==='pending') dayTasks = dayTasks.filter(t=>!t.done);
    if(taskFilter==='done') dayTasks = dayTasks.filter(t=>t.done);
    let tasksHtml = dayTasks.slice(0,3).map(t=>{
      const overdue = !t.done && cellDate < today;
      const cls = t.done ? 'done' : (overdue ? 'overdue' : '');
      const proj = projectInfo(t.projectId);
      const projColor = proj ? proj.color : 'var(--muted)';
      return `<div class="cal-task ${cls}" style="--proj-color:${projColor}">${t.text}</div>`;
    }).join('');
    if(dayTasks.length>3) tasksHtml += `<div class="cal-more">+${dayTasks.length-3} más</div>`;
    html += `<div class="cal-cell ${isToday?'today':''}" onclick="openDayView('${iso}')"><div class="cal-daynum">${day}</div>${tasksHtml}</div>`;
  }
  cont.innerHTML = html;
}

function openDayView(iso){
  document.getElementById('calendarView').style.display = 'none';
  document.getElementById('taskList').style.display = 'none';
  document.getElementById('dayView').style.display = '';
  renderDayView(iso);
}
function closeDayView(){
  document.getElementById('dayView').style.display = 'none';
  document.getElementById('calendarView').style.display = calView ? '' : 'none';
  document.getElementById('taskList').style.display = calView ? 'none' : '';
  if(calView) renderCalendar();
}
function dayNav(iso, dir){
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate()+dir);
  renderDayView(d.toISOString().slice(0,10));
}
let currentDayIso = null;
function renderDayView(iso){
  currentDayIso = iso;
  const cont = document.getElementById('dayView');
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const isToday = d.getTime() === today.getTime();
  const dayName = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][d.getDay()];
  const label = `${dayName} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;

  let tasks = data.tasks.filter(t=>t.dueDate===iso && (activeProjects.size===0 || activeProjects.has(t.projectId)));
  if(taskFilter==='pending') tasks = tasks.filter(t=>!t.done);
  if(taskFilter==='done') tasks = tasks.filter(t=>t.done);
  tasks = tasks.slice().sort((a,b)=> (a.dueTime||'99:99').localeCompare(b.dueTime||'99:99'));

  const items = tasks.length ? tasks.map(t=>{
    const proj = projectInfo(t.projectId);
    const overdue = !t.done && d < today;
    return `
    <div class="task ${t.done?'done':''}">
      <input type="checkbox" ${t.done?'checked':''} onchange="toggleTask('${t.id}')">
      <span class="proj-dot" style="background:${proj?proj.color:'var(--muted)'}"></span>
      <div class="task-body">
        <div class="task-project">${proj?proj.name:'—'}</div>
        <div class="task-text">${t.text}</div>
        ${t.dueTime ? `<span class="due-badge ${overdue?'due-overdue':'due-upcoming'}" onclick="editTaskDate('${t.id}', this)" style="cursor:pointer;" title="Cambiar fecha">🕒 ${t.dueTime}</span>` : (overdue?`<span class="due-badge due-overdue" onclick="editTaskDate('${t.id}', this)" style="cursor:pointer;">Vencida</span>`:`<span class="due-badge" onclick="editTaskDate('${t.id}', this)" style="cursor:pointer;background:transparent;border:1px dashed var(--border);color:var(--muted);">+ fecha</span>`)}
      </div>
      <button class="task-del" style="color:var(--muted);" onclick="openEditTask('${t.id}')" title="Editar">⋯</button>
      <button class="task-del" onclick="deleteTask('${t.id}')">✕</button>
    </div>`;
  }).join('') : '<div class="empty">No hay tareas con vencimiento este día.</div>';

  cont.innerHTML = `
    <div class="cal-header">
      <button class="cal-nav-btn" onclick="closeDayView()">‹ Volver</button>
      <div class="cal-title" style="text-transform:capitalize;">${label}${isToday?' · Hoy':''}</div>
      <div class="cal-nav">
        <button onclick="dayNav('${iso}', -1)">‹</button>
        <button onclick="dayNav('${iso}', 1)">›</button>
      </div>
    </div>
    <div class="task-list">${items}</div>`;
}

/* ====== RENDER GENERAL ====== */
function renderAll(){
  updateContextButton();
  renderTotals();
  renderAreaFilters();
  renderProjectFilters();
  renderProjectCards();
  renderKanban();
  populateSelects();
  renderTasks();
  if(calView) renderCalendar();
  renderEmailBanner();
  renderOverdueBadge();
  renderAlertConfig();
}
function leadLabel(m){
  m = parseInt(m);
  if(m < 60) return m + ' minutos';
  if(m % 60 === 0) return (m/60) + (m===60 ? ' hora' : ' horas');
  return Math.floor(m/60) + ' h ' + (m%60) + ' min';
}
function renderAlertConfig(){
  const cfg = data.alertConfig || {high:30, medium:60, low:120};
  [['high','alertLeadHigh'],['medium','alertLeadMedium'],['low','alertLeadLow']].forEach(([p,id])=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    sel.innerHTML = ALERT_LEAD_OPTIONS.map(m=>`<option value="${m}">${leadLabel(m)} antes</option>`).join('');
    sel.value = String(cfg[p] || 60);
  });
}
function setAlertLead(priority, val){
  data.alertConfig = data.alertConfig || {high:30, medium:60, low:120};
  data.alertConfig[priority] = parseInt(val) || 60;
  save();
}
function renderOverdueBadge(){
  const today = new Date(); today.setHours(0,0,0,0);
  const count = data.tasks.filter(t=>!t.done && t.dueDate && new Date(t.dueDate+'T00:00:00') < today).length;
  const b = document.getElementById('overdueBadge');
  if(b) b.textContent = count>0 ? count : '';
  const d = document.getElementById('hamburgerDot');
  if(d) d.classList.toggle('on', count>0);
}
/* ====== TEMA CLARO/OSCURO ====== */
function applyTheme(theme){
  const btn = document.getElementById('themeToggleBtn');
  if(theme==='dark'){
    document.documentElement.setAttribute('data-theme','dark');
    if(btn) btn.textContent = '☀️';
  }else{
    document.documentElement.removeAttribute('data-theme');
    if(btn) btn.textContent = '🌙';
  }
}
function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme')==='dark' ? 'dark' : 'light';
  const next = current==='dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
}
applyTheme(localStorage.getItem('theme') || 'light');

applyTreeLevel(false, false);
renderAll();
checkOverdueAlerts();
autoPullOnLoad();

/* ====== PWA: registro de service worker (solo funciona en https) ====== */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  navigator.serviceWorker.register('service-worker.js').catch(()=>{});
}
