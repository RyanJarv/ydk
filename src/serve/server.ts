import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../graph/loadProject.js";
import { validateProject } from "../graph/validateProject.js";
import { createProjectView } from "./projectView.js";

type ServeOptions = {
  host?: string;
  port?: number;
  root?: string;
};

const serveDir = path.dirname(fileURLToPath(import.meta.url));

export async function serveProject(options: ServeOptions = {}): Promise<void> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  const root = options.root ?? process.cwd();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);

      if (url.pathname === "/" || url.pathname === "/index.html") {
        await sendFile(response, path.join(serveDir, "web", "index.html"), "text/html; charset=utf-8");
        return;
      }

      if (url.pathname === "/app.js") {
        await sendFile(response, path.join(serveDir, "web", "app.js"), "text/javascript; charset=utf-8");
        return;
      }

      if (url.pathname === "/styles.css") {
        await sendFile(response, path.join(serveDir, "web", "styles.css"), "text/css; charset=utf-8");
        return;
      }

      if (url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      if (url.pathname === "/vendor/vue.esm-browser.prod.js") {
        await sendFile(
          response,
          path.join(root, "node_modules", "vue", "dist", "vue.esm-browser.prod.js"),
          "text/javascript; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/api/project") {
        const project = await loadProject(root);
        sendJson(response, {
          project: createProjectView(project),
          validation: validateProject(project),
        });
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(`ydk project explorer running at http://${host}:${port}`);
}

async function sendFile(response: ServerResponse, filePath: string, contentType: string): Promise<void> {
  const content = await readFile(filePath);
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": contentType,
  });
  response.end(content);
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}
