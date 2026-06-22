# Kingdom MCP en Cloudflare Workers (gratis, sin dormirse)

Conecta Claude con tu `data.json` de Kingdom mediante un conector personalizado.
La IA que genera el trabajo es Claude; este Worker solo lee/escribe datos.
Corre en el plan gratis de Cloudflare, sin Durable Objects y sin dormirse.

Archivos:
- `src/index.js` — el servidor MCP (herramientas).
- `wrangler.jsonc` — configuración del Worker.
- `package.json` — dependencias.

Honestidad por delante: esto es más trabajo que Render. Y no pude probar el
build ni el deploy en esta sesión (solo validé la sintaxis del código). Si el
despliegue falla por una versión de paquete, se arregla cambiando una línea en
`package.json`; te aviso cuáles abajo. Seguís necesitando el `app.js` parcheado
que te di antes para que editar tareas y guardar resultados persista.

---

## Qué necesitás antes

1. Una cuenta gratis en Cloudflare (dash.cloudflare.com).
2. Un token de GitHub fino con permiso **Contents: Read and write** solo sobre
   el repo Kingdom. (GitHub → Settings → Developer settings → Fine-grained
   tokens → Only select repositories: Kingdom → Repository permissions →
   Contents: Read and write → Generate → copiar el token `github_pat_...`).
3. Un secreto largo para la URL. Podés usar este o generar otro:

   ```
   G3xjXTPumLwhNQwGs8kB1TkVb3YFF2VU
   ```

Poné estos tres archivos (`src/index.js`, `wrangler.jsonc`, `package.json`) en
una carpeta. Podés ponerlos en tu repo Kingdom dentro de una subcarpeta, por
ejemplo `cf-mcp/`.

---

## Camino A — Sin terminal (dashboard de Cloudflare)

Cloudflare puede construir y desplegar desde tu repo de GitHub.

1. Subí la carpeta `cf-mcp/` (con los 3 archivos) a tu repo Kingdom en GitHub.
2. En el dashboard de Cloudflare: **Workers & Pages → Create → Workers →
   Import a repository** (o "Connect to Git"). Autorizá GitHub y elegí el repo
   Kingdom.
3. En la configuración del build:
   - **Root directory:** `cf-mcp`
   - **Build command:** `npm install`
   - **Deploy command:** `npx wrangler deploy`
   (Si te ofrece detectarlo solo y ve el `wrangler.jsonc`, alcanza con dejar el
   root directory en `cf-mcp`.)
4. Antes o después del primer deploy, cargá las variables en
   **Settings → Variables and Secrets** del Worker:
   - Secret `GITHUB_TOKEN` = tu token de GitHub
   - Secret `KINGDOM_SECRET` = tu secreto
   - (opcionales, ya tienen valor por defecto) `GITHUB_OWNER`, `GITHUB_REPO`,
     `GITHUB_BRANCH`
5. Desplegá. Cuando esté listo, tu Worker vive en algo como
   `https://kingdom-mcp.TU-SUBDOMINIO.workers.dev`.
6. Comprobalo abriendo esa URL en el navegador: debe decir "Kingdom MCP vivo."

## Camino B — Con terminal (wrangler)

Requiere tener Node.js instalado en tu computadora.

```bash
cd cf-mcp
npm install
npx wrangler login
npx wrangler secret put GITHUB_TOKEN      # pegás el token cuando lo pida
npx wrangler secret put KINGDOM_SECRET    # pegás el secreto cuando lo pida
npx wrangler deploy
```

Al terminar, te muestra la URL `https://kingdom-mcp.TU-SUBDOMINIO.workers.dev`.
Comprobá que diga "Kingdom MCP vivo." al abrirla.

---

## Armar la URL del conector

```
https://kingdom-mcp.TU-SUBDOMINIO.workers.dev/TU_KINGDOM_SECRET/mcp
```

Ejemplo:

```
https://kingdom-mcp.tu-nombre.workers.dev/G3xjXTPumLwhNQwGs8kB1TkVb3YFF2VU/mcp
```

La URL tiene que terminar en `/mcp`. Cualquier otra ruta devuelve 404.

## Agregar el conector en Claude

1. Claude → **Configuración → Conectores** → **+ → Agregar conector personalizado**.
2. Pegá la URL de arriba. Nombre: `Kingdom`. **Agregar.**
3. En un chat, **+ → Conectores** → activá **Kingdom**.
4. Probá: *"usá kingdom_overview"*.

---

## Cómo se usa

Hablás normal y Claude actúa sobre tu CRM (con el conector activo):

- *"Buscá la tarea del bug de tareas vencidas y ejecutala."* → Claude usa
  `list_tasks`, encuentra el id, llama `get_task` (arma el contexto: tarea +
  proyecto + proyecto padre + área), genera el entregable y lo guarda con
  `save_task_result`.
- *"Creá una tarea en el proyecto Kingdom: revisar el merge de app.js."*
- *"Mostrame las tareas pendientes de alta prioridad."*

Herramientas: `kingdom_overview`, `list_projects`, `get_project`, `list_tasks`,
`get_task`, `create_task`, `update_task`, `save_task_result`.

---

## Caveats reales

- **Seguridad:** la protección es el secreto en la URL. Quien tenga la URL
  completa puede leer y escribir tu repo. No la compartas. Es razonable para
  uso personal; no es OAuth.
- **Escrituras:** crear tareas es fiable; editar y guardar resultados persisten
  solo con el `app.js` parcheado. En conflicto sobre la misma tarea, gana la
  versión escrita por el MCP.
- **Resultados:** `save_task_result` guarda el entregable en `data.json`, pero
  el dashboard todavía no lo muestra dentro de la tarjeta (cambio visual aparte).
- **No probado en vivo:** validé la sintaxis del Worker, no lo ejecuté. Verifiqué
  la API de `createMcpHandler` contra la documentación de Cloudflare, no contra
  una corrida real.

## Si el deploy falla

- Error de versiones al instalar (`npm install`): en `package.json`, probá
  cambiar `"agents": "latest"` por una versión concreta reciente, o el
  `"@modelcontextprotocol/sdk"` a una versión 1.26.x específica. El equipo de
  Cloudflare mueve seguido estos paquetes.
- El conector no conecta: revisá que la URL termine en `/TU_SECRET/mcp` y que el
  secreto coincida exactamente con la variable `KINGDOM_SECRET`.
- "Kingdom MCP vivo." no aparece: el deploy no terminó bien; mirá los logs del
  Worker en el dashboard.
- Errores al leer/escribir data.json: el `GITHUB_TOKEN` venció o no tiene
  Contents: Read and write sobre Kingdom.
