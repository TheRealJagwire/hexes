import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z, ZodError } from "zod";
import {
  CreateHexRequestSchema,
  CreateProjectRequestSchema,
  DirRequestSchema,
  HexIdSchema,
  StatusSchema,
  UpdateHexRequestSchema,
} from "../../shared/schemas.ts";
import {
  DEFAULT_WORKFLOW,
  KIND_WORKFLOWS,
  REQUIRES_RESPONSE,
  STATUS_INFO,
} from "../../shared/constants.ts";
import type { StatusTable } from "../../shared/views.ts";
import { DomainError } from "../core/errors.ts";
import type { HexService } from "../core/service.ts";
import { pickDirectory } from "../core/picker.ts";
import type { ChangeWatcher } from "../core/watcher.ts";

export const API_VERSION = 1;

const MetaValueSchema = z.object({ value: z.string() });
const OpenPullRequestSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
});
const SelectSchema = z.object({ id: HexIdSchema });
const RecentProjectSchema = z.object({ dir: z.string().trim().min(1), projectId: HexIdSchema });

/** JSON API consumed by the Preact client. Every handler delegates to HexService. */
export function apiRoutes(service: HexService, changes?: ChangeWatcher): Hono {
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

  // Lets a client notice it is talking to a server with a different contract.
  api.use("*", async (c, next) => {
    c.header("x-hexes-api", String(API_VERSION));
    await next();
  });

  api.get("/health", (c) => c.json({ ok: true }));
  /** Server-sent events: `hello` on connect, `change` whenever the hexes on disk change. */
  api.get("/events", (c) => {
    if (!changes) return c.json({ error: "live updates are not enabled" }, 404);
    return streamSSE(c, async (stream) => {
      const unsubscribe = changes.subscribe((event) => {
        void stream.writeSSE({
          event: "change",
          id: String(event.rev),
          data: JSON.stringify(event),
        })
          .catch(() => {});
      });
      const aborted = new Promise<void>((resolve) => stream.onAbort(resolve));
      await stream.writeSSE({ event: "hello", data: JSON.stringify(await changes.snapshot()) });
      while (!stream.aborted) {
        let timer: number | undefined;
        await Promise.race([aborted, new Promise((r) => timer = setTimeout(r, 20_000))]);
        clearTimeout(timer);
        if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
      }
      unsubscribe();
    });
  });
  api.get("/state", async (c) => c.json(await service.state()));
  api.get("/statuses", (c) =>
    c.json(
      {
        statuses: STATUS_INFO,
        kinds: KIND_WORKFLOWS,
        default: DEFAULT_WORKFLOW,
        requiresResponse: REQUIRES_RESPONSE,
      } satisfies StatusTable,
    ));

  api.get("/workspace/recent", async (c) => c.json(await service.recentWorkspaces()));
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
  // Before /projects/:id, so "recent" and "open" are not taken for ids.
  api.get("/projects/recent", async (c) => c.json(await service.recentProjects()));
  api.post("/projects/open", async (c) => {
    const { dir, projectId } = RecentProjectSchema.parse(await c.req.json());
    return c.json(await service.openRecentProject(dir, projectId));
  });
  api.post("/projects/recent/forget", async (c) => {
    const { dir, projectId } = RecentProjectSchema.parse(await c.req.json());
    await service.forgetRecentProject(dir, projectId);
    return c.json({ ok: true });
  });
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

  // Branches and pull requests: Hexes runs git in the workspace's working tree.
  api.post("/hexes/:id/branch", async (c) => c.json(await service.startWork(c.req.param("id"))));
  api.post("/hexes/:id/pull-requests", async (c) => {
    const opts = OpenPullRequestSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await service.openPullRequest(c.req.param("id"), opts), 201);
  });
  api.post(
    "/hexes/:id/merge",
    async (c) => c.json(await service.mergePullRequest(c.req.param("id"))),
  );
  api.post(
    "/hexes/:id/close",
    async (c) => c.json(await service.closePullRequest(c.req.param("id"))),
  );
  api.get("/hexes/:id/diff", async (c) => c.json(await service.pullRequestDiff(c.req.param("id"))));

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
