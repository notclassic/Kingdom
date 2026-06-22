// ============================================================================
//  KINGDOM MCP  -  Cloudflare Worker (stateless, sin Durable Objects)
// ----------------------------------------------------------------------------
//  Conecta Claude (conector personalizado) con tu data.json de Kingdom.
//  La IA que genera el trabajo es Claude; este Worker solo lee/escribe datos.
//
//  Secrets/vars que se cargan en Cloudflare (NO aca):
//    GITHUB_TOKEN    -> token fino de GitHub con Contents: Read and write sobre Kingdom
//    KINGDOM_SECRET  -> texto largo e impredecible; va en la URL del conector
//    GITHUB_OWNER    -> (opcional) por defecto "notclassic"
//    GITHUB_REPO     -> (opcional) por defecto "Kingdom"
//    GITHUB_BRANCH   -> (opcional) por defecto "main"
//
//  URL del conector en Claude:
//    https://NOMBRE.SUBDOMINIO.workers.dev/TU_KINGDOM_SECRET/mcp
// ============================================================================

import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
//  base64 UTF-8 sin depender de Buffer (nativo de Workers)
// ---------------------------------------------------------------------------
function b64ToUtf8(b64) {
  const bin = atob((b64 || "").replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
//  Acceso a data.json via GitHub Contents API (mismo patron que el dashboard)
// ---------------------------------------------------------------------------
function ghConfig(env) {
  return {
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER || "notclassic",
    repo: env.GITHUB_REPO || "Kingdom",
    branch: env.GITHUB_BRANCH || "main",
  };
}
function ghUrl(cfg) {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/data.json`;
}
function ghHeaders(cfg) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "kingdom-mcp",
  };
}

async function readData(cfg) {
  const res = await fetch(`${ghUrl(cfg)}?ref=${cfg.branch}`, { headers: ghHeaders(cfg) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`No pude leer data.json (HTTP ${res.status}). ${body.slice(0, 200)}`);
  }
  const file = await res.json();
  return { sha: file.sha, data: JSON.parse(b64ToUtf8(file.content)) };
}

async function writeData(cfg, sha, data, message) {
  return fetch(ghUrl(cfg), {
    method: "PUT",
    headers: { ...ghHeaders(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: utf8ToB64(JSON.stringify(data, null, 2)),
      sha,
      branch: cfg.branch,
    }),
  });
}

// Lee, aplica un cambio y guarda. Si hay conflicto (409) reintenta una vez.
async function mutate(cfg, applyFn, message) {
  for (let intento = 0; intento < 2; intento++) {
    const { sha, data } = await readData(cfg);
    const result = applyFn(data); // puede lanzar Error con mensaje claro
    const res = await writeData(cfg, sha, data, message);
    if (res.ok) return result;
    if (res.status === 409 && intento === 0) continue;
    const body = await res.text();
    throw new Error(`No pude guardar en data.json (HTTP ${res.status}). ${body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
//  Helpers de dominio (esquema REAL de Kingdom)
// ---------------------------------------------------------------------------
const byId = (arr, id) => (arr || []).find((x) => x.id === id);

function enrichTask(data, task) {
  const project = byId(data.projects, task.projectId) || null;
  const parent = project && project.parentId ? byId(data.projects, project.parentId) : null;
  const area = project && project.area ? byId(data.areas, project.area) : null;
  return { tarea: task, proyecto: project, proyectoPadre: parent, area };
}

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true });

const NOTA_EDICION =
  "Con el app.js parcheado este cambio persiste y aparece en el dashboard. " +
  "En conflicto (misma tarea editada a la vez en el dashboard y aca) gana esta version.";

// ---------------------------------------------------------------------------
//  Servidor MCP con todas las herramientas
// ---------------------------------------------------------------------------
function buildServer(env) {
  const cfg = ghConfig(env);
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
        const { data } = await readData(cfg);
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
        "Lista proyectos. Filtros opcionales: area (id), parentId (para ver subproyectos), " +
        "status, query (busca en nombre/descripcion).",
      inputSchema: {
        area: z.string().optional(),
        parentId: z.string().optional(),
        status: z.string().optional(),
        query: z.string().optional(),
      },
    },
    async ({ area, parentId, status, query }) => {
      try {
        const { data } = await readData(cfg);
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
        "Devuelve un proyecto con contexto completo: datos, area, subproyectos y tareas.",
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) => {
      try {
        const { data } = await readData(cfg);
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
        "Lista tareas. Filtros: projectId, done (true/false), priority (low/medium/high), " +
        "query (busca en el texto), limit (50 por defecto). Para hallar una tarea sin su id, usar query.",
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
        const { data } = await readData(cfg);
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
        "Devuelve UNA tarea con todo su contexto (tarea, proyecto, proyecto padre, area). " +
        "Este es el contexto para 'ejecutar' una tarea: pedi esto, genera el trabajo vos mismo " +
        "y guardalo con save_task_result.",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => {
      try {
        const { data } = await readData(cfg);
        const t = byId(data.tasks, taskId);
        if (!t) return fail(`No existe la tarea ${taskId}. Proba list_tasks con query.`);
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
        "Crea una tarea en un proyecto. priority por defecto 'medium', dueDate AAAA-MM-DD (opcional). " +
        "Es la operacion de escritura mas fiable.",
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
        await mutate(
          cfg,
          (data) => {
            if (!byId(data.projects, projectId)) throw new Error(`No existe el proyecto ${projectId}.`);
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
              mcpUpdatedAt: new Date().toISOString(),
            };
            data.tasks.push(creada);
            return creada;
          },
          `MCP: nueva tarea en ${projectId}`
        );
        return ok({ creada, ok: true });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      description: "Modifica una tarea existente. Solo pasa los campos a cambiar. " + NOTA_EDICION,
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
        await mutate(
          cfg,
          (data) => {
            const t = byId(data.tasks, taskId);
            if (!t) throw new Error(`No existe la tarea ${taskId}.`);
            if (typeof text === "string") t.text = text;
            if (typeof done === "boolean") {
              t.done = done;
              if (!done) t.alertSent = false;
            }
            if (priority) t.priority = priority;
            if (typeof dueDate === "string") t.dueDate = dueDate;
            t.mcpUpdatedAt = new Date().toISOString();
            actualizada = t;
            return t;
          },
          `MCP: actualizar tarea ${taskId}`
        );
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
        "Guarda en la tarea el entregable generado (result, resultType, resultAt). " +
        "type opcional (linkedin_post, email, plan_comercial, report, etc). " + NOTA_EDICION,
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
        await mutate(
          cfg,
          (data) => {
            const t = byId(data.tasks, taskId);
            if (!t) throw new Error(`No existe la tarea ${taskId}.`);
            t.result = result;
            t.resultType = type || "";
            t.resultAt = new Date().toISOString();
            t.mcpUpdatedAt = t.resultAt;
            if (markDone) t.done = true;
            info = { id: t.id, resultType: t.resultType, resultAt: t.resultAt, done: !!t.done };
            return info;
          },
          `MCP: guardar resultado de ${taskId}`
        );
        return ok({ ...info, ok: true, nota: NOTA_EDICION });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
//  Worker fetch: salud, auth por secreto en la URL, y delega al handler MCP
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") return new Response("Kingdom MCP vivo.");

    const secret = env.KINGDOM_SECRET;
    const prefix = secret ? `/${secret}/` : null;
    if (!secret || !prefix || !url.pathname.startsWith(prefix)) {
      return new Response("Not found", { status: 404 }); // 404 a proposito
    }

    // Reescribir la URL quitando el secreto: el handler ve "/mcp".
    const rest = url.pathname.slice(prefix.length); // "mcp"
    const newUrl = new URL(request.url);
    newUrl.pathname = "/" + rest;
    const rewritten = new Request(newUrl.toString(), request);

    const handler = createMcpHandler(buildServer(env));
    return handler(rewritten, env, ctx);
  },
};
