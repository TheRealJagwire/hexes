import { Hono } from "hono";
import { z, ZodError } from "zod";
import {
  CreateHexRequestSchema,
  CreateProjectRequestSchema,
  DirRequestSchema,
  HexIdSchema,
  StatusSchema,
  UpdateHexRequestSchema,
} from "../../shared/schemas.ts";
import { DomainError } from "../core/errors.ts";
import type { HexService } from "../core/service.ts";
import { pickDirectory } from "../core/picker.ts";

const MetaValueSchema = z.object({ value: z.string() });
const SelectSchema = z.object({ id: HexIdSchema });

/** JSON API consumed by the Preact client. Every handler delegates to HexService. */
export function apiRoutes(service: HexService): Hono {
  const api = new Hono();

  api.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return c.json({ error: `${where}${issue?.message ?? "invalid request"}` }, 400);
    }
    if (err instanceof SyntaxError) return c.json({ error: "request body is not valid JSON" }, 400);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  api.get("/health", (c) => c.json({ ok: true }));
  api.get("/state", async (c) => c.json(await service.state()));

  api.post("/workspace/inspect", async (c) => {
    const { dir } = DirRequestSchema.parse(await c.req.json());
    return c.json(await service.inspect(dir));
  });
  api.post("/workspace/open", async (c) => {
    const { dir } = DirRequestSchema.parse(await c.req.json());
    return c.json(await service.openWorkspace(dir));
  });
  api.post("/workspace/create", async (c) => {
    const req = CreateProjectRequestSchema.parse(await c.req.json());
    return c.json(await service.createProject(req), 201);
  });
  api.post("/workspace/pick", async (c) => c.json({ dir: await pickDirectory() }));

  api.get("/projects", async (c) => c.json(await service.listProjects()));
  api.get("/projects/:id", async (c) => c.json(await service.projectView(c.req.param("id"))));
  api.post("/selected-project", async (c) => {
    const { id } = SelectSchema.parse(await c.req.json());
    await service.selectProject(id);
    return c.json({ ok: true });
  });

  api.get("/hexes", async (c) => {
    const status = c.req.query("status");
    return c.json(
      await service.search({
        projectId: c.req.query("project"),
        query: c.req.query("q"),
        kind: c.req.query("kind"),
        status: status ? StatusSchema.parse(status) : undefined,
        limit: c.req.query("limit")
          ? z.coerce.number().int().min(1).max(1000).parse(c.req.query("limit"))
          : undefined,
      }),
    );
  });
  api.post("/hexes", async (c) => {
    const req = CreateHexRequestSchema.parse(await c.req.json());
    return c.json(await service.createHex(req), 201);
  });
  api.get("/hexes/:id", async (c) => c.json(await service.hexView(c.req.param("id"))));
  api.patch("/hexes/:id", async (c) => {
    const patch = UpdateHexRequestSchema.parse(await c.req.json());
    return c.json(await service.updateHex(c.req.param("id"), patch));
  });
  api.delete(
    "/hexes/:id",
    async (c) => c.json({ deleted: await service.deleteHex(c.req.param("id")) }),
  );

  api.put("/hexes/:id/meta/:key", async (c) => {
    const { value } = MetaValueSchema.parse(await c.req.json());
    return c.json(await service.setMeta(c.req.param("id"), c.req.param("key"), value, "set"));
  });
  api.delete(
    "/hexes/:id/meta/:key",
    async (c) => c.json(await service.removeMeta(c.req.param("id"), c.req.param("key"))),
  );

  return api;
}
