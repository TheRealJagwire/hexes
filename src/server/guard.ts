import type { Context, MiddlewareHandler } from "hono";

export interface GuardOptions {
  /** Bearer token that remote (non-loopback) clients must present. Unset → remote is refused. */
  token?: string | undefined;
  /** Host names remote clients may use. Empty → any host, since the token still protects. */
  allowedHosts?: readonly string[] | undefined;
}

export const MIN_TOKEN_LENGTH = 16;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const LOOPBACK_ADDRS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || LOOPBACK_ADDRS.includes(host.replace(/^\[|\]$/g, ""));
}

export function guardOptionsFromEnv(): GuardOptions {
  const token = Deno.env.get("HEXES_TOKEN")?.trim() || undefined;
  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`HEXES_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  const allowedHosts = (Deno.env.get("HEXES_ALLOWED_HOSTS") ?? "")
    .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return { token, allowedHosts };
}

/** The TCP peer, from the connection and never from a header. `null` means an in-process call. */
function peerOf(c: Context): string | null {
  const env = c.env as { remoteAddr?: { hostname?: string } } | undefined;
  if (!env) return null;
  return env.remoteAddr?.hostname ?? "unknown"; // unknown peers are treated as remote
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const bx = new Uint8Array(x);
  const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < bx.length; i++) diff |= (bx[i] ?? 0) ^ (by[i] ?? 0);
  return diff === 0;
}

/**
 * The API reads and writes folders on this machine, so it is guarded.
 *
 * Loopback peers (the local browser): the Host header must be loopback (blocks DNS rebinding).
 * Remote peers (the phone): refused unless a token is configured, the Host is allowed, and a
 * matching `Authorization: Bearer` header is sent.
 * Everyone: writes must be JSON (blocks cross-site form posts) and a cross-origin Origin header
 * is rejected.
 */
export function createGuard(options: GuardOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const host = (c.req.header("host") ?? "").replace(/:\d+$/, "").toLowerCase();
    const peer = peerOf(c);
    const local = peer === null || LOOPBACK_ADDRS.includes(peer);

    if (local) {
      if (!LOOPBACK_HOSTS.includes(host)) return c.json({ error: "forbidden host" }, 403);
    } else {
      if (!options.token) return c.json({ error: "remote access is disabled" }, 403);
      const allowed = options.allowedHosts ?? [];
      if (allowed.length > 0 && !allowed.includes(host)) {
        return c.json({ error: "forbidden host" }, 403);
      }
      const match = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "");
      if (!match || !(await sameSecret(match[1] as string, options.token))) {
        c.header("www-authenticate", "Bearer");
        return c.json({ error: "missing or invalid token" }, 401);
      }
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
}

export const localOnly: MiddlewareHandler = createGuard();
