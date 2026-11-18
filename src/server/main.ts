import qrcode from "qrcode-terminal";
import { createApp } from "./app.ts";
import { HexService } from "./core/service.ts";
import { Workspace } from "./core/workspace.ts";
import { guardOptionsFromEnv, isLoopbackHost } from "./guard.ts";

const port = Number(Deno.env.get("PORT") ?? 8000);
const hostname = Deno.env.get("HOST") ?? "127.0.0.1";
const security = guardOptionsFromEnv();

if (!isLoopbackHost(hostname) && !security.token) {
  console.error(
    `Refusing to listen on ${hostname}: set HEXES_TOKEN (16+ characters) to allow remote clients.`,
  );
  Deno.exit(1);
}

const service = new HexService(Workspace.fromEnv());
Deno.serve({ hostname, port }, createApp(service, undefined, security).fetch);

// Repositories bound before .hx/project.json existed get theirs, so agents find their project.
service.backfillBindings().then(
  (dirs) => dirs.forEach((dir) => console.log(`hexes: wrote .hx/project.json in ${dir}`)),
  (e) => console.error(`hexes: could not write .hx/project.json files: ${e}`),
);

if (security.token && !isLoopbackHost(hostname)) {
  const url = Deno.env.get("HEXES_PUBLIC_URL") ??
    `http://${hostname === "0.0.0.0" ? "<this-machine>" : hostname}:${port}`;
  const pairing = `hexes://pair?url=${encodeURIComponent(url)}&token=${
    encodeURIComponent(security.token)
  }`;
  console.log(`Remote access is on. Scan this in the Hexes app, or enter the URL and token:`);
  qrcode.generate(pairing, { small: true });
  console.log(`URL: ${url}`);
}
