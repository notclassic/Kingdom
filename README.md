# Kingdom MCP — conexión directa entre Claude y tu CRM

Esto conecta Claude (en un chat normal) con tu `data.json` de Kingdom, mediante
un **conector personalizado** (MCP). Claude puede leer proyectos/tareas, crear
tareas, actualizarlas y guardar entregables. La IA que genera el trabajo **es
Claude**: este servidor no llama a ningún otro modelo ni necesita otra API key.

## Qué tenés que entender antes (sin esto perdés tiempo)

1. **GitHub Pages no sirve para esto.** Aloja solo archivos estáticos. Este
   servidor tiene que vivir en un host que ejecute Node y esté encendido. Abajo
   uso **Render** (plan gratis).
2. **El plan gratis de Render se duerme** tras ~15 min sin uso. La primera
   llamada de Claude después de un rato puede tardar 30-50 s o incluso fallar la
   primera vez; reintentás y anda. Si querés que nunca se duerma, es un plan pago.
3. **Hay dos archivos, no uno.** Además del servidor (`mcp/`), incluyo tu
   `app.js` ya parcheado. Con ese `app.js`, crear tareas, editarlas y guardar
   resultados desde Claude se reflejan en el dashboard. Si NO reemplazás tu
   `app.js`, solo `create_task` es confiable; `update_task` y `save_task_result`
   pueden perderse al sincronizar. El resultado guardado queda en el `data.json`
   pero todavía no se muestra dentro de la tarjeta de la tarea (eso es un cambio
   visual aparte, ver final).
4. **Seguridad:** la protección es un secreto largo dentro de la URL. Cualquiera
   que tenga la URL completa puede leer y escribir tu repo. No la compartas, no la
   pegues en lugares públicos. Es razonable para uso personal; no es OAuth.

---

## Paso 1 — Subir los archivos a tu repo

1. Copiá la carpeta `mcp/` (con `server.js`, `package.json`, `README.md`) a la
   raíz de tu repo `Kingdom`.
2. Reemplazá tu `app.js` por el `app.js` de esta entrega (el parcheado). Es lo que
   hace que editar tareas y guardar resultados desde Claude no se pierdan.

Subí todo a GitHub (commit + push, o "Add file > Upload files" desde la web).

## Paso 2 — Crear un token de GitHub (fino, solo para Kingdom)

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
2. Resource owner: tu usuario. Repository access: **Only select repositories → Kingdom**.
3. Permisos → Repository permissions → **Contents: Read and write**.
4. Generá y **copiá el token** (empieza con `github_pat_...`). Lo pegás en Render,
   nunca en el código ni en el repo.

## Paso 3 — Tu secreto de conexión

Necesitás un `KINGDOM_SECRET` largo e impredecible. Podés usar este (generado
para vos), o generar otro:

```
sfOjuPhwYWtVxevc0mjiUEla0LJXrEeT
```

## Paso 4 — Desplegar en Render

1. Entrá a render.com, creá una cuenta (podés usar tu GitHub).
2. **New → Web Service →** conectá tu repo `Kingdom`.
3. Configuración:
   - **Root Directory:** `mcp`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. En **Environment** agregá estas variables:
   - `GITHUB_TOKEN` = el token del Paso 2
   - `KINGDOM_SECRET` = tu secreto del Paso 3
   - (opcionales, ya tienen valor por defecto: `GITHUB_OWNER=notclassic`,
     `GITHUB_REPO=Kingdom`, `GITHUB_BRANCH=main`)
5. **Create Web Service.** Esperá a que diga "Live".
6. Comprobá que vive: abrí la URL que te dio Render (ej.
   `https://kingdom-mcp.onrender.com`). Debe decir "Kingdom MCP vivo."

## Paso 5 — Armar la URL del conector

```
https://TU-URL-DE-RENDER/TU_KINGDOM_SECRET/mcp
```

Ejemplo:

```
https://kingdom-mcp.onrender.com/sfOjuPhwYWtVxevc0mjiUEla0LJXrEeT/mcp
```

## Paso 6 — Agregar el conector en Claude

1. En Claude: **Configuración → Conectores** (o "Customize → Connectors").
2. Botón **+ → Agregar conector personalizado**.
3. Pegá la URL del Paso 5. Nombre: `Kingdom`. **Agregar.**
4. En un chat, abrí el menú **+ → Conectores** y activá **Kingdom**.
5. Probá: escribí *"usá kingdom_overview"*. Debería devolverte tus áreas,
   proyectos y conteo de tareas.

Disponible en planes Free (1 conector), Pro, Max, Team y Enterprise. En Team/
Enterprise lo agrega un Owner.

---

## Cómo se usa (resuelve el "Ejecuta la tarea T089" de tu spec)

Tus tareas no tienen numeración tipo T089; tienen IDs como `t1781583152633291`.
No necesitás memorizarlos. Decís, por ejemplo:

- *"Buscá la tarea del bug de tareas vencidas y ejecutala."* → Claude usa
  `list_tasks` con query, encuentra el id, llama `get_task` (que arma el contexto:
  tarea + proyecto + proyecto padre + área), genera el entregable, y lo guarda con
  `save_task_result`.
- *"Creá una tarea en el proyecto Kingdom: revisar el merge de app.js."*
- *"Mostrame todas las tareas pendientes de alta prioridad."*

## Herramientas disponibles

- `kingdom_overview` — orientación general (áreas, árbol de proyectos, conteos).
- `list_projects` — filtros: area, parentId, status, query.
- `get_project` — proyecto + área + subproyectos + tareas.
- `list_tasks` — filtros: projectId, done, priority, query, limit.
- `get_task` — tarea con contexto completo (lo que Claude usa para "ejecutar").
- `create_task` — crear tarea (operación de escritura más fiable).
- `update_task` — editar tarea existente (ver caveat del merge).
- `save_task_result` — guardar el entregable en la tarea (ver caveat del merge).

---

## El `app.js` parcheado (para que las ESCRITURAS no se pierdan)

Por diseño, tu dashboard es "local-first": al sincronizar, para una tarea que ya
existe, **gana la copia de tu navegador** y nunca la pisa el repo. Eso protege tu
trabajo del bot, pero también descartaba lo que Claude editara.

El `app.js` que incluyo modifica las **dos** funciones de fusión
(`mergeRepoIntoLocal` y el merge dentro de `pushToGitHub`) para que adopten los
cambios del repo **solo en tareas con el campo `mcpUpdatedAt`** (que escribe
únicamente el servidor MCP). Así:

- Crear, editar y guardar resultados desde Claude ahora sobreviven.
- Lo que escribe el bot y el resto de tu estado local siguen igual de protegidos
  que antes (el bot no usa `mcpUpdatedAt`).

**Para instalarlo:** reemplazá tu `app.js` actual por el `app.js` de esta entrega
(commit + push al repo). No cambia nada de la interfaz; solo la lógica de fusión.

**El límite honesto:** si editás la *misma* tarea en el dashboard y desde Claude
entre dos sincronizaciones, gana la versión del MCP (last-write-wins). Es una
ventana angosta. Para evitarla, sincronizá el dashboard antes de pedirle a Claude
que toque tareas que vos también estás editando a mano.

**Lo que todavía falta (visual):** `save_task_result` guarda el entregable en el
`data.json` (campos `result`, `resultType`, `resultAt`), pero el dashboard aún no
lo muestra dentro de la tarjeta de la tarea. Mostrarlo es un cambio chico de
interfaz; si confirmás que la conexión funciona, te lo agrego.

---

## Si algo falla

- "Kingdom MCP vivo." no aparece → el deploy no está corriendo; revisá logs en Render.
- Claude no conecta → revisá que la URL termine en `/TU_SECRET/mcp` y que el
  secreto coincida exactamente con la variable `KINGDOM_SECRET`.
- Errores al leer/escribir → el `GITHUB_TOKEN` venció o no tiene permiso
  Contents: Read and write sobre Kingdom.
- Primera llamada lenta o caída tras inactividad → Render free dormido; reintentá.
- Conflicto al guardar (raro) → el servidor reintenta una vez solo; si justo
  escribió un bot al mismo tiempo, repetí la acción.
