import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ActivityLog } from "../server/core/activity.ts";
import type { HexService } from "../server/core/service.ts";
import { registerTool } from "./tools/define.ts";
import { buildTools } from "./tools/index.ts";

/** `activity`, when given, hears about every tool call (Studio passes one; stdio doesn't). */
export function buildServer(service: HexService, activity?: ActivityLog): McpServer {
  const server = new McpServer(
    { name: "hexes", version: "0.1.0" },
    {
      instructions:
        "Hexes tracks project state as atomic hexes (idea, project, design, spec, decision, gate, " +
        "epic, story, substory, bug, fact). Find your project from .hx/project.json in your " +
        "working directory (or find_project with its absolute path) and pass that project_id on " +
        "every call that takes one; then get_ready_hexes_for_project to find work. Mark hexes done with update_hex_status; " +
        "dependents unblock automatically. Ideas are written and moved only by people; read " +
        "them, never change them. A published idea is ready to be designed. " +
        "Record a fact (core.fact, status known) when you learn something durable and " +
        "non-obvious; get_facts near a hex before working on it.",
    },
  );
  for (const tool of buildTools(service)) registerTool(server, tool, activity);
  return server;
}
