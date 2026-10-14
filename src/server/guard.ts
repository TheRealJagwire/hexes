import type { MiddlewareHandler } from "hono";

/**
 * The API reads and writes folders on this machine, so refuse anything that is not the local
 * UI: the Host header must be loopback (blocks DNS rebinding), writes must be JSON (blocks
 * cross-site form posts), and a cross-origin Origin header is rejected.
 */
export const localOnly: MiddlewareHandler = async (c, next) => {
  const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    return c.json({ error: "forbidden host" }, 403);
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== c.req.header("host")) {
      return c.json({ error: "cross-origin request refused" }, 403);
    }
    const type = c.req.header("content-type") ?? "";
    const hasBody = c.req.raw.body !== null;
    if (hasBody && !type.startsWith("application/json")) {
      return c.json({ error: "content-type must be application/json" }, 415);
    }
  }
  return await next();
};
