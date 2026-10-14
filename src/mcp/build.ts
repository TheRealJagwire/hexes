import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HexService } from "../server/core/service.ts";
import { registerTool } from "./tools/define.ts";
import { buildTools } from "./tools/index.ts";

export function buildServer(service: HexService): McpServer {
  const server = new McpServer(
    { name: "hexes", version: "0.1.0" },
    {
      instructions:
        "Hexes tracks project state as atomic hexes (project, design, spec, decision, gate, epic, " +
        "story, substory, bug). Start with get_workspace / get_selected_project, then " +
        "get_ready_hexes_for_project to find work. Mark hexes done with update_hex_status; " +
        "dependents unblock automatically.",
    },
  );
  for (const tool of buildTools(service)) registerTool(server, tool);
  return server;
}
