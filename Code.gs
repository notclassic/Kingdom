/****************************************************************************
 * KINGDOM · RECRUITMENT — PUENTE CON EL SHEET DE OFERTAS  (Web App)
 * ---------------------------------------------------------------------------
 * Proyecto Apps Script NUEVO y SEPARADO. No es un scraper y no toca los
 * scrapers. Su única función es leer y editar el Sheet "ofertas" para que el
 * panel de Kingdom pueda mostrar las ofertas y retroalimentar el filtro.
 *
 * QUÉ HACE (acciones):
 *   - list            : devuelve Listado + Descartadas (las últimas 400)
 *   - descartar       : mueve una oferta del Listado a Descartadas
 *   - bloquearEmpresa : agrega la empresa a la hoja Filtros (col Empresas) y descarta la oferta
 *   - bloquearPalabra : agrega una palabra a la hoja Filtros (col Cargo) y descarta la oferta
 *   - rescatar        : mueve una oferta de Descartadas de vuelta al Listado
 *
 * SEGURIDAD: todas las llamadas exigen el TOKEN de abajo. Cambialo por una
 * palabra secreta tuya. El panel usará ese mismo token.
 *
 * HOJAS Y COLUMNAS (no cambiar el orden, es el del Sheet real):
 *   Listado     : Titulo | Empresa | Origen | Cargo | sueldo | Fecha | Link
 *   Descartadas : FechaProc | Motivo | Titulo | Empresa | sueldo | FechaEmail | Link | SubjectEmail
 *   Filtros     : Cargo | Empresas | Rubros | sueldo | Excluir
 ****************************************************************************/

/***** CONFIGURACIÓN — lo único que tenés que tocar *****/
const SHEET_ID = '1STE-3G5-6fNOTuJrOEUqGJ48UiAmXJTuPd8RvlUY7_o';
const TOKEN    = 'CAMBIA_ESTE_TOKEN';   // <<< poné acá una palabra secreta tuya
const MAX_DESCARTADAS = 400;            // cuántas descartadas (las más recientes) devuelve

const HOJA_LISTADO     = 'Listado';
const HOJA_DESCARTADAS = 'Descartadas';
const HOJA_FILTROS     = 'Filtros';

/***** PUNTOS DE ENTRADA (el navegador llama acá) *****/
function doGet(e)  { return manejar(e); }
function doPost(e) { return manejar(e); }

function manejar(e){
  const p = (e && e.parameter) || {};
  const callback = p.callback || '';   // para JSONP (lectura desde el panel)
  let out;
  try {
    if (p.token !== TOKEN) {
      out = { ok:false, error:'token_invalido' };
    } else {
      const action = p.action || 'list';
      if      (action === 'list')            out = accionList();
      else if (action === 'ofertas')         out = accionOfertas();
      else if (action === 'descartadas')     out = accionDescartadas();
      else if (action === 'descartar')       out = accionDescartar(p.link, p.motivo);
      else if (action === 'bloquearEmpresa') out = accionBloquearEmpresa(p.empresa, p.link);
      else if (action === 'bloquearPalabra') out = accionBloquearPalabra(p.palabra, p.link);
      else if (action === 'rescatar')        out = accionRescatar(p.link);
      else                                   out = { ok:false, error:'accion_desconocida:' + action };
    }
  } catch (err) {
    out = { ok:false, error:String(err) };
  }
  return responder(out, callback);
}

function responder(obj, callback){
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/***** UTILIDADES *****/
function hoja(nombre){
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(nombre);
}
function fmt(v){
  // Detecta Date de forma robusta: en Apps Script, los Date que vienen del Sheet
  // a veces no pasan "instanceof Date", así que chequeamos getTime().
  if (v && typeof v.getTime === 'function' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return (v === null || v === undefined) ? '' : String(v);
}
function ahora(){
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/***** LISTAR *****/
function accionList(){
  const L = hoja(HOJA_LISTADO).getDataRange().getValues();
  const listado = [];
  for (let i = 1; i < L.length; i++) {
    const r = L[i];
    if (!r[0] && !r[6]) continue;  // fila vacía
    listado.push({
      titulo: fmt(r[0]), empresa: fmt(r[1]), origen: fmt(r[2]),
      cargo: fmt(r[3]), sueldo: fmt(r[4]), fecha: fmt(r[5]), link: fmt(r[6])
    });
  }

  // DESCARTADAS: en vez de leer las miles de filas, leemos solo las últimas
  // MAX_DESCARTADAS (las más recientes). Esto hace la respuesta mucho más rápida.
  const shD = hoja(HOJA_DESCARTADAS);
  const lastRow = shD.getLastRow();
  const totalDesc = Math.max(0, lastRow - 1);  // menos la fila de cabecera
  const descartadas = [];
  if (lastRow > 1) {
    const desde = Math.max(2, lastRow - MAX_DESCARTADAS + 1);
    const numFilas = lastRow - desde + 1;
    const lastCol = Math.max(8, shD.getLastColumn());
    const D = shD.getRange(desde, 1, numFilas, lastCol).getValues();
    for (let i = 0; i < D.length; i++) {
      const r = D[i];
      if (!r[2] && !r[6]) continue;
      descartadas.push({
        fechaProc: fmt(r[0]), motivo: fmt(r[1]), titulo: fmt(r[2]), empresa: fmt(r[3]),
        sueldo: fmt(r[4]), fecha: fmt(r[5]), link: fmt(r[6]), subject: fmt(r[7])
      });
    }
    descartadas.reverse();  // las más recientes primero
  }

  return {
    ok: true,
    listado: listado,
    descartadas: descartadas,
    totalListado: listado.length,
    totalDescartadas: totalDesc,
    descartadasMostradas: descartadas.length
  };
}

/***** SOLO OFERTAS (liviano: no toca Descartadas) *****/
function accionOfertas(){
  const L = hoja(HOJA_LISTADO).getDataRange().getValues();
  const listado = [];
  for (let i = 1; i < L.length; i++) {
    const r = L[i];
    if (!r[0] && !r[6]) continue;
    listado.push({
      titulo: fmt(r[0]), empresa: fmt(r[1]), origen: fmt(r[2]),
      cargo: fmt(r[3]), sueldo: fmt(r[4]), fecha: fmt(r[5]), link: fmt(r[6])
    });
  }
  return { ok:true, listado:listado, totalListado:listado.length };
}

/***** SOLO DESCARTADAS (liviano: solo las últimas MAX_DESCARTADAS) *****/
function accionDescartadas(){
  const shD = hoja(HOJA_DESCARTADAS);
  const lastRow = shD.getLastRow();
  const totalDesc = Math.max(0, lastRow - 1);
  const descartadas = [];
  if (lastRow > 1) {
    const desde = Math.max(2, lastRow - MAX_DESCARTADAS + 1);
    const numFilas = lastRow - desde + 1;
    const lastCol = Math.max(8, shD.getLastColumn());
    const D = shD.getRange(desde, 1, numFilas, lastCol).getValues();
    for (let i = 0; i < D.length; i++) {
      const r = D[i];
      if (!r[2] && !r[6]) continue;
      descartadas.push({
        fechaProc: fmt(r[0]), motivo: fmt(r[1]), titulo: fmt(r[2]), empresa: fmt(r[3]),
        sueldo: fmt(r[4]), fecha: fmt(r[5]), link: fmt(r[6]), subject: fmt(r[7])
      });
    }
    descartadas.reverse();
  }
  return { ok:true, descartadas:descartadas, totalDescartadas:totalDesc, descartadasMostradas:descartadas.length };
}

/***** DESCARTAR (Listado -> Descartadas) *****/
function accionDescartar(link, motivo){
  if (!link) return { ok:false, error:'falta_link' };
  const sh = hoja(HOJA_LISTADO);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][6]) === String(link)) {
      const r = vals[i];
      hoja(HOJA_DESCARTADAS).appendRow([
        ahora(),
        motivo || 'Descartada manual (panel)',
        r[0], r[1], r[4], fmt(r[5]), r[6], 'panel'
      ]);
      sh.deleteRow(i + 1);  // getValues es base 0; las filas del Sheet empiezan en 1
      return { ok:true, accion:'descartada', link:link };
    }
  }
  return { ok:false, error:'no_encontrada_en_listado' };
}

/***** RESCATAR (Descartadas -> Listado) *****/
function accionRescatar(link){
  if (!link) return { ok:false, error:'falta_link' };
  const sh = hoja(HOJA_DESCARTADAS);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][6]) === String(link)) {
      const r = vals[i];
      hoja(HOJA_LISTADO).appendRow([
        r[2], r[3], 'Rescatada manual (panel)', r[2], r[4], fmt(r[5]), r[6]
      ]);
      sh.deleteRow(i + 1);
      return { ok:true, accion:'rescatada', link:link };
    }
  }
  return { ok:false, error:'no_encontrada_en_descartadas' };
}

/***** BLOQUEAR EMPRESA (a Filtros, col Empresas = 2) + descartar la oferta *****/
function accionBloquearEmpresa(empresa, link){
  if (!empresa) return { ok:false, error:'falta_empresa' };
  const res = agregarAFiltros(2, empresa);
  let desc = null;
  if (link) desc = accionDescartar(link, 'Empresa bloqueada: ' + empresa);
  return { ok:true, accion:'empresa_bloqueada', empresa:empresa, yaExistia:res.yaExistia, descartada:desc };
}

/***** BLOQUEAR PALABRA (a Filtros, col Cargo = 1) + descartar la oferta *****/
function accionBloquearPalabra(palabra, link){
  if (!palabra) return { ok:false, error:'falta_palabra' };
  const res = agregarAFiltros(1, palabra);
  let desc = null;
  if (link) desc = accionDescartar(link, 'Palabra bloqueada: ' + palabra);
  return { ok:true, accion:'palabra_bloqueada', palabra:palabra, yaExistia:res.yaExistia, descartada:desc };
}

/***** Agregar un valor a una columna de la hoja Filtros, sin duplicar *****/
/* col es 1-indexed: 1=Cargo, 2=Empresas, 3=Rubros, 5=Excluir */
function agregarAFiltros(col, valor){
  const sh = hoja(HOJA_FILTROS);
  const last = sh.getLastRow();
  const rng = sh.getRange(1, col, Math.max(last, 1), 1).getValues();
  const norm = String(valor).trim().toLowerCase();
  let ultimaConDato = 0;
  for (let i = 0; i < rng.length; i++) {
    const cell = String(rng[i][0] || '').trim();
    if (cell) {
      ultimaConDato = i + 1;  // fila 1-indexed
      if (cell.toLowerCase() === norm) return { yaExistia:true, fila:i + 1 };
    }
  }
  const filaDestino = ultimaConDato + 1;
  sh.getRange(filaDestino, col).setValue(valor);
  return { yaExistia:false, fila:filaDestino };
}

/****************************************************************************
 * PRUEBA INTERNA — corré esto en el editor (botón ▷) para verificar que lee
 * bien el Sheet, SIN necesitar el panel ni el navegador. Mirá el registro
 * (Ver > Registro de ejecución).
 ****************************************************************************/
function probarLectura(){
  const r = accionList();
  Logger.log('OK lectura. Listado: ' + r.totalListado +
             ' | Descartadas totales: ' + r.totalDescartadas +
             ' | Descartadas devueltas: ' + r.descartadasMostradas);
  if (r.listado.length) Logger.log('Primera oferta del Listado: ' + JSON.stringify(r.listado[0]));
  if (r.descartadas.length) Logger.log('Descartada más reciente: ' + JSON.stringify(r.descartadas[0]));
}
