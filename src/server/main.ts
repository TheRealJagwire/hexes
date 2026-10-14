import { createApp } from "./app.ts";

const port = Number(Deno.env.get("PORT") ?? 8000);
// Loopback only: the API can read and write project folders on this machine.
Deno.serve({ hostname: "127.0.0.1", port }, createApp().fetch);
