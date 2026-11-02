import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { HexService } from "../server/core/service.ts";
import type { ActivityLog } from "../server/core/activity.ts";
import { buildServer } from "./build.ts";

/**
 * The MCP server over streamable HTTP, mounted at /mcp inside the Studio process so MCP and the
 * UI share one HexService. Stateless: every request gets its own server and transport, and
 * replies as plain JSON, so there are no sessions to lose when Studio restarts.
 */
export function mcpRoutes(service: HexService, activity?: ActivityLog): Hono {
  const mcp = new Hono();
  mcp.all("/", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    const server = buildServer(service, activity);
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  return mcp;
}
