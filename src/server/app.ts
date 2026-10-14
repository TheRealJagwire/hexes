import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { HexService } from "./core/service.ts";
import { Workspace } from "./core/workspace.ts";
import { localOnly } from "./guard.ts";
import { apiRoutes } from "./routes/api.ts";

const INDEX_HTML = `<!doctype html>
<html lang="en" class="hx-root">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hexes Studio</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/static/app.css" />
    <script>
      try {
        if (localStorage.getItem("hexes-theme") === "light") {
          document.documentElement.classList.add("light");
        }
      } catch (_) {}
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/static/client.js"></script>
  </body>
</html>
`;

export function createApp(service: HexService = new HexService(Workspace.fromEnv())): Hono {
  const app = new Hono();
  app.use("*", localOnly);
  app.route("/api", apiRoutes(service));
  app.use("/static/*", serveStatic({ root: "./" }));
  // Client-side routes: anything else that is not an API or asset path gets the SPA shell.
  app.get("*", (c) => c.html(INDEX_HTML));
  return app;
}
