import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { DomainError } from "../../server/core/errors.ts";

export interface ToolDef<S extends z.ZodObject> {
  name: string;
  description: string;
  input: S;
  /** Hints for clients: read-only tools can be auto-approved, destructive ones gated. */
  kind: "read" | "write" | "destructive";
  run: (args: z.infer<S>) => Promise<unknown>;
}

export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

type AnyTool = ToolDef<z.ZodObject>;

function text(value: unknown, isError = false) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text" as const, text: body }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Registers a tool whose handler returns JSON text and turns DomainErrors into tool errors. */
export function registerTool(server: McpServer, def: AnyTool): void {
  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.input,
      annotations: {
        readOnlyHint: def.kind === "read",
        destructiveHint: def.kind === "destructive",
        idempotentHint: def.kind === "read",
        openWorldHint: false,
      },
    },
    async (args: unknown) => {
      try {
        return text(await def.run(def.input.parse(args)));
      } catch (e) {
        if (e instanceof DomainError) return text(e.message, true);
        throw e;
      }
    },
  );
}
