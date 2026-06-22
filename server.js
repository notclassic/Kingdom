// ============================================================================
//  KINGDOM MCP  -  Conexion directa entre Claude y tu CRM Kingdom
// ----------------------------------------------------------------------------
//  Que hace:
//    Expone tu data.json (proyectos, subproyectos, tareas) como herramientas
//    que Claude puede usar desde un chat normal, via "Conector personalizado".
//    Claude lee el contexto, genera el entregable EL MISMO, y lo guarda.
//    No llama a ningun otro modelo de IA: la IA es Claude.
//
//  Variables de entorno que necesita (se cargan en el panel del host, NO aca):
//    GITHUB_TOKEN     -> token fino de GitHub con permiso de Contents (R/W) sobre Kingdom
//    KINGDOM_SECRET   -> texto largo e impredecible. Va en la URL del conector.
//    GITHUB_OWNER     -> (opcional) por defecto "notclassic"
//    GITHUB_REPO      -> (opcional) por defecto "Kingdom"
//    GITHUB_BRANCH    -> (opcional) por defecto "main"
//    PORT             -> lo pone el host automaticamente
//
//  URL que vas a pegar en Claude como conector:
//    https://TU-HOST/  +  TU_KINGDOM_SECRET  +  /mcp
//    ej: https://kingdom-mcp.onrender.com/8fK3...xZ/mcp
// ============================================================================

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const OWNER  = process.env.GITHUB_OWNER  || "notclassic";
const REPO   = process.env.GITHUB_REPO   || "Kingdom";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const FILE   = "data.json";
const TOKEN  = process.env.GITHUB_TOKEN;
const SECRET = process.env.KINGDOM_SECRET;
const PORT   = process.env.PORT || 3000;

if (!TOKEN)  console.error("[FATAL] Falta GITHUB_TOKEN. El servidor no podra leer ni escribir data.json.");
if (!SECRET) console.error("[FATAL] Falta KINGDOM_SECRET. Cualquiera podria conectarse. Defini uno largo.");

const GH_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
const GH_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kingdom-mcp",
};

// ---------------------------------------------------------------------------
//  Acceso a data.json en GitHub (mismo patron que ya usa tu dashboard/bots)
// ---------------------------------------------------------------------------

async function readData() {
  const res = await fetch(`${GH_URL}?ref=${BRANCH}`, { headers: GH_HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`No pude leer data.json (HTTP ${res.status}). ${body.slice(0, 200)}`);
  }
  const file = await res.json();
  const json = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  return { sha: file.sha, data: json };
}

async function writeData(sha, data, message) {
  const res = await fetch(GH_URL, {
    method: "PUT",
    headers: { ...GH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(data, null, 2), "utf8").toString("base64"),
      sha,
      branch: BRANCH,
    }),
  });
  return res; // el caller decide que hacer con 409, etc.
}

// Lee, aplica un cambio, guarda. Si hay conflicto (409: alguien escribio en
// el medio, p.ej. un bot) reintenta una vez releyendo el sha actual.
async function mutate(applyFn, message) {
  for (let intento = 0; intento < 2; intento++) {
    const { sha, data } = await readData();
    const result = applyFn(data); // puede lanzar Error con mensaje claro
    const res = await writeData(sha, data, message);
    if (res.ok) return result;
    if (res.status === 409 && intento === 0) continue; // reintentar una vez
    const body = await res.text();
    throw new Error(`No pude guardar en data.json (HTTP ${res.status}). ${body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
//  Helpers de dominio (esquema REAL de Kingdom)
//    areas:    { id, name, color, context }
//    projects: { id, name, area, desc, status, parentId, ... }   (subproyecto = tiene parentId)
//    tasks:    { id, projectId, text, done, dueDate, dueTime, priority, ... }
// ---------------------------------------------------------------------------

const byId = (arr, id) => (arr || []).find((x) => x.id === id);

function enrichTask(data, task) {
  const project = byId(data.projects, task.projectId) || null;
  const parent  = project && project.parentId ? byId(data.projects, project.parentId) : null;
  const area    = project && project.area ? byId(data.areas, project.area) : null;
  return {
    tarea: task,
    proyecto: project,
    proyectoPadre: parent, // null si el proyecto no es subproyecto
    area,
  };
}

const ok   = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true });

const NOTA_EDICION =
  "NOTA: crear tareas nuevas es fiable. Editar una tarea existente o guardar un " +
  "resultado puede ser revertido por el dashboard la proxima vez que sincronice, " +
  "salvo que se aplique el parche opcional al merge de app.js (ver README).";

// ---------------------------------------------------------------------------
//  Definicion de un McpServer con todas las herramientas
// ---------------------------------------------------------------------------

function buildServer() {
  const server = new McpServer({ name: "kingdom", version: "1.0.0" });

  server.registerTool(
    "kingdom_overview",
    {
      description:
        "Panorama general de Kingdom: areas, arbol de proyectos (raiz + subproyectos) " +
        "y conteo de tareas pendientes/hechas. Usar primero para orientarse.",
      inputSchema: {},
    },
    async () => {
      try {
        const { data } = await readData();
        const proyectos = (data.projects || []).filter((p) => p.status !== "done");
        const tree = proyectos
          .filter((p) => !p.parentId || !byId(data.projects, p.parentId))
          .map((p) => ({
            id: p.id,
            nombre: p.name,
            area: (byId(data.areas, p.area) || {}).name || null,
            subproyectos: proyectos
              .filter((c) => c.parentId === p.id)
              .map((c) => ({ id: c.id, nombre: c.name })),
          }));
        return ok({
          areas: (data.areas || []).map((a) => ({ id: a.id, nombre: a.name, contexto: a.context })),
          totalProyectosActivos: proyectos.length,
          tareasPendientes: (data.tasks || []).filter((t) => !t.done).length,
          tareasHechas: (data.tasks || []).filter((t) => t.done).length,
          arbolProyectos: tree,
        });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "list_projects",
    {
      description:
        "Lista proyectos. Filtros opcionales: area (id de area), parentId (id del proyecto padre " +
        "para ver subproyectos), status, y query (busca en nombre/descripcion).",
      inputSchema: {
        area: z.string().optional(),
        parentId: z.string().optional(),
        status: z.string().optional(),
        query: z.string().optional(),
      },
    },
    async ({ area, parentId, status, query }) => {
      try {
        const { data } = await readData();
        let ps = data.projects || [];
        if (area) ps = ps.filter((p) => p.area === area);
        if (parentId) ps = ps.filter((p) => p.parentId === parentId);
        if (status) ps = ps.filter((p) => p.status === status);
        if (query) {
          const q = query.toLowerCase();
          ps = ps.filter(
            (p) => (p.name || "").toLowerCase().includes(q) || (p.desc || "").toLowerCase().includes(q)
          );
        }
        return ok(
          ps.map((p) => ({
            id: p.id,
            nombre: p.name,
            descripcion: p.desc || "",
            status: p.status,
            area: p.area || null,
            parentId: p.parentId || null,
            esSubproyecto: !!p.parentId,
          }))
        );
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "get_project",
    {
      description:
        "Devuelve un proyecto con su contexto completo: datos del proyecto, su area, " +
        "sus subproyectos y todas sus tareas. Util para trabajar sobre un proyecto entero.",
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) => {
      try {
        const { data } = await readData();
        const p = byId(data.projects, projectId);
        if (!p) return fail(`No existe el proyecto ${projectId}.`);
        return ok({
          proyecto: p,
          area: p.area ? byId(data.areas, p.area) : null,
          proyectoPadre: p.parentId ? byId(data.projects, p.parentId) : null,
          subproyectos: (data.projects || []).filter((c) => c.parentId === p.id),
          tareas: (data.tasks || []).filter((t) => t.projectId === p.id),
        });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      description:
        "Lista tareas. Filtros opcionales: projectId, done (true/false), priority " +
        "(low/medium/high), query (busca en el texto), limit (por defecto 50). " +
        "Para encontrar una tarea sin saber su id, usar query con palabras del texto.",
      inputSchema: {
        projectId: z.string().optional(),
        done: z.boolean().optional(),
        priority: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ projectId, done, priority, query, limit }) => {
      try {
        const { data } = await readData();
        let ts = data.tasks || [];
        if (projectId) ts = ts.filter((t) => t.projectId === projectId);
        if (typeof done === "boolean") ts = ts.filter((t) => !!t.done === done);
        if (priority) ts = ts.filter((t) => t.priority === priority);
        if (query) {
          const q = query.toLowerCase();
          ts = ts.filter((t) => (t.text || "").toLowerCase().includes(q));
        }
        ts = ts.slice(0, limit && limit > 0 ? limit : 50);
        return ok(
          ts.map((t) => ({
            id: t.id,
            texto: t.text,
            done: !!t.done,
            prioridad: t.priority,
            vence: t.dueDate || null,
            projectId: t.projectId,
            proyecto: (byId(data.projects, t.projectId) || {}).name || null,
          }))
        );
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "get_task",
    {
      description:
        "Devuelve UNA tarea con todo su contexto armado automaticamente: la tarea, su proyecto, " +
        "el proyecto padre (si es subproyecto) y su area. Este es el contexto que Claude usa " +
        "para generar el entregable. Equivale a 'ejecutar' una tarea: pedi esto, genera el " +
        "trabajo vos mismo, y guardalo con save_task_result.",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => {
      try {
        const { data } = await readData();
        const t = byId(data.tasks, taskId);
        if (!t) return fail(`No existe la tarea ${taskId}. Proba list_tasks con query para encontrarla.`);
        return ok(enrichTask(data, t));
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Crea una tarea nueva en un proyecto. priority por defecto 'medium'. dueDate en formato " +
        "AAAA-MM-DD (opcional). Crear es la operacion de escritura mas fiable.",
      inputSchema: {
        projectId: z.string(),
        text: z.string(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        dueDate: z.string().optional(),
      },
    },
    async ({ projectId, text, priority, dueDate }) => {
      try {
        let creada;
        await mutate((data) => {
          if (!byId(data.projects, projectId)) {
            throw new Error(`No existe el proyecto ${projectId}.`);
          }
          data.tasks = data.tasks || [];
          creada = {
            id: "t" + Date.now() + Math.floor(Math.random() * 1000),
            projectId,
            text,
            done: false,
            dueDate: dueDate || "",
            dueTime: "",
            priority: priority || "medium",
            emailAlert: false,
            alertSent: false,
            driveUrl: "",
          };
          data.tasks.push(creada);
          return creada;
        }, `MCP: nueva tarea en ${projectId}`);
        return ok({ creada, ok: true });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Modifica una tarea existente (texto, done, prioridad, fecha). Solo pasa los campos que " +
        "queres cambiar. " + NOTA_EDICION,
      inputSchema: {
        taskId: z.string(),
        text: z.string().optional(),
        done: z.boolean().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        dueDate: z.string().optional(),
      },
    },
    async ({ taskId, text, done, priority, dueDate }) => {
      try {
        let actualizada;
        await mutate((data) => {
          const t = byId(data.tasks, taskId);
          if (!t) throw new Error(`No existe la tarea ${taskId}.`);
          if (typeof text === "string") t.text = text;
          if (typeof done === "boolean") { t.done = done; if (!done) t.alertSent = false; }
          if (priority) t.priority = priority;
          if (typeof dueDate === "string") t.dueDate = dueDate;
          actualizada = t;
          return t;
        }, `MCP: actualizar tarea ${taskId}`);
        return ok({ actualizada, ok: true, nota: NOTA_EDICION });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "save_task_result",
    {
      description:
        "Guarda en la tarea el entregable que Claude genero (campos result, resultType, resultAt). " +
        "type es opcional (ej: linkedin_post, email, plan_comercial, report). " + NOTA_EDICION,
      inputSchema: {
        taskId: z.string(),
        result: z.string(),
        type: z.string().optional(),
        markDone: z.boolean().optional(),
      },
    },
    async ({ taskId, result, type, markDone }) => {
      try {
        let info;
        await mutate((data) => {
          const t = byId(data.tasks, taskId);
          if (!t) throw new Error(`No existe la tarea ${taskId}.`);
          t.result = result;
          t.resultType = type || "";
          t.resultAt = new Date().toISOString();
          if (markDone) { t.done = true; }
          info = { id: t.id, resultType: t.resultType, resultAt: t.resultAt, done: !!t.done };
          return info;
        }, `MCP: guardar resultado de ${taskId}`);
        return ok({ ...info, ok: true, nota: NOTA_EDICION });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
//  HTTP (Streamable HTTP, modo stateless: robusto en hosts que se duermen)
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "4mb" }));

// Salud: util para comprobar que el deploy esta vivo.
app.get("/", (_req, res) => res.send("Kingdom MCP vivo."));

// Verificacion del secreto en la URL.
function checkSecret(req, res) {
  if (!SECRET || req.params.secret !== SECRET) {
    res.status(404).end(); // 404 a proposito: no revela que la ruta existe
    return false;
  }
  return true;
}

// Endpoint MCP. Una instancia nueva de server+transport por request (stateless).
app.post("/:secret/mcp", async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("Error MCP:", e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Error interno" }, id: null });
    }
  }
});

// En modo stateless no hay stream servidor->cliente ni sesion que cerrar.
app.get("/:secret/mcp", (req, res) => {
  if (!checkSecret(req, res)) return;
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Metodo no permitido" }, id: null });
});
app.delete("/:secret/mcp", (req, res) => {
  if (!checkSecret(req, res)) return;
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Metodo no permitido" }, id: null });
});

app.listen(PORT, () => console.log(`Kingdom MCP escuchando en puerto ${PORT}`));
