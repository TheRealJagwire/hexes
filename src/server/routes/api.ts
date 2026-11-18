import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z, ZodError } from "zod";
import {
  CreateHexRequestSchema,
  CreateProjectRequestSchema,
  CreateSeedRequestSchema,
  DirRequestSchema,
  HexIdSchema,
  SetProjectRepoSchema,
  StatusSchema,
  UpdateHexRequestSchema,
  UpdateSeedRequestSchema,
} from "../../shared/schemas.ts";
import {
  DEFAULT_WORKFLOW,
  DERIVED,
  KIND_WORKFLOWS,
  REQUIRES_RESPONSE,
  STATUS_INFO,
} from "../../shared/constants.ts";
import type { ChannelsState, StatusTable } from "../../shared/views.ts";
import type { ActivityLog } from "../core/activity.ts";
import { readChannels } from "../core/channels.ts";
import { DomainError } from "../core/errors.ts";
import type { HexService } from "../core/service.ts";
import { pickDirectory } from "../core/picker.ts";
import { allDataDirs, type ChangeWatcher } from "../core/watcher.ts";

export const API_VERSION = 1;

const MetaValueSchema = z.object({ value: z.string() });
const OpenPullRequestSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
});
const AutoMergeSchema = z.object({ enabled: z.boolean() });
const ArchivedSchema = z.object({ archived: z.boolean() });
/** A recent entry: `dir` is empty for a v2 project (all of them now), a folder for an old v1 entry. */
const RecentProjectSchema = z.object({
  dir: z.string().trim().default(""),
  projectId: HexIdSchema,
});

/** JSON API consumed by the Preact client. Every handler delegates to HexService. */
export function apiRoutes(
  service: HexService,
  changes?: ChangeWatcher,
  activity?: ActivityLog,
): Hono {
  const api = new Hono();
  /** The channels listening on one project (`projectId`), or on every project. */
  const channelsState = async (projectId?: string): Promise<ChannelsState> => {
    const dirs = projectId
      ? [await service.workspace.dataDirFor(projectId).catch(() => null)]
      : await allDataDirs(service.workspace)().catch(() => []);
    const channels = [];
    for (const dir of dirs) if (dir) channels.push(...await readChannels(dir));
    return { channels };
  };

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
        // A channel's heartbeat changes no hexes: it goes out as its own event.
        const data = event.scope === "channels"
          ? channelsState().then((state) => JSON.stringify(state))
          : Promise.resolve(JSON.stringify(event));
        void data.then((data) =>
          stream.writeSSE({
            event: event.scope === "channels" ? "channel" : "change",
            id: String(event.rev),
            data,
          })
        ).catch(() => {});
      });
      const unsubscribeAgent = activity?.subscribe((call) => {
        void stream.writeSSE({ event: "agent", data: JSON.stringify(call) }).catch(() => {});
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
      unsubscribeAgent?.();
    });
  });
  api.get("/state", async (c) => c.json(await service.state()));
  /** The `hexes-channel` processes listening, with what they sent: `?project=` narrows to one. */
  api.get("/channels", async (c) => c.json(await channelsState(c.req.query("project"))));
  /** What agents have been doing in a project over MCP: the latest call and the hex being worked. */
  api.get("/agent", (c) => {
    const project = c.req.query("project");
    if (!project) throw new DomainError("Pass ?project=<project id>", 400);
    return c.json(activity?.forProject(project) ?? { lastCall: null, working: null });
  });
  api.get("/statuses", (c) =>
    c.json(
      {
        statuses: STATUS_INFO,
        kinds: KIND_WORKFLOWS,
        default: DEFAULT_WORKFLOW,
        requiresResponse: REQUIRES_RESPONSE,
        derived: DERIVED,
      } satisfies StatusTable,
    ));

  api.post("/workspace/create", async (c) => {
    const req = CreateProjectRequestSchema.parse(await c.req.json());
    return c.json(await service.createProject(req), 201);
  });
  api.post("/workspace/pick", async (c) => c.json({ dir: await pickDirectory() }));

  api.get("/projects", async (c) => c.json(await service.listProjects()));
  // Before /projects/:id, so "recent" is not taken for an id.
  api.get("/projects/recent", async (c) => c.json(await service.recentProjects()));
  /** A person opened a project in a client: it goes to the front of the recent list. */
  api.post("/projects/:id/opened", async (c) => {
    await service.recordOpened(c.req.param("id"));
    return c.json({ ok: true });
  });
  // A person's action from Studio: there is deliberately no MCP tool for it.
  api.post("/projects/migrate", async (c) => {
    const { dir } = DirRequestSchema.parse(await c.req.json());
    return c.json(await service.migrateProject(dir));
  });
  api.post("/projects/recent/forget", async (c) => {
    const { dir, projectId } = RecentProjectSchema.parse(await c.req.json());
    await service.forgetRecentProject(dir, projectId);
    return c.json({ ok: true });
  });
  api.get("/projects/:id", async (c) => c.json(await service.projectView(c.req.param("id"))));
  api.get(
    "/projects/:id/graph",
    async (c) => c.json(await service.projectGraph(c.req.param("id"))),
  );
  api.put("/projects/:id/repo", async (c) => {
    const req = SetProjectRepoSchema.parse(await c.req.json());
    return c.json(await service.setProjectRepo(c.req.param("id"), req));
  });
  api.put("/projects/:id/auto-merge", async (c) => {
    const { enabled } = AutoMergeSchema.parse(await c.req.json());
    return c.json(await service.setAutoMerge(c.req.param("id"), enabled));
  });
  api.get("/projects/:id/facts", async (c) => {
    const q = c.req.query();
    const depth = q.depth ? Number(q.depth) : undefined;
    return c.json(
      await service.facts(c.req.param("id"), {
        near: q.near || undefined,
        depth,
        file: q.file || undefined,
        query: q.query || undefined,
        includeRetired: q.include_retired === "1" || q.include_retired === "true",
      }),
    );
  });
  // Repository seeds: shared by every project.
  api.get("/seeds", async (c) => {
    const r = c.req.query("retired");
    return c.json(await service.listSeeds({ includeRetired: r === "1" || r === "true" }));
  });
  api.post("/seeds", async (c) => {
    const req = CreateSeedRequestSchema.parse(await c.req.json());
    return c.json(await service.createSeed(req), 201);
  });
  api.patch("/seeds/:id", async (c) => {
    const patch = UpdateSeedRequestSchema.parse(await c.req.json());
    return c.json(await service.updateSeed(c.req.param("id"), patch));
  });
  api.post("/seeds/:id/retire", async (c) => c.json(await service.retireSeed(c.req.param("id"))));
  api.post(
    "/seeds/:id/restore",
    async (c) => c.json(await service.retireSeed(c.req.param("id"), true)),
  );

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
  api.put("/hexes/:id/archived", async (c) => {
    const { archived } = ArchivedSchema.parse(await c.req.json());
    return c.json(await service.setArchived(c.req.param("id"), archived));
  });
  api.post(
    "/hexes/:id/merge",
    async (c) => c.json(await service.mergePullRequest(c.req.param("id"))),
  );
  api.post(
    "/hexes/:id/update-branch",
    async (c) => c.json(await service.updatePullRequestBranch(c.req.param("id"))),
  );
  api.post(
    "/hexes/:id/merge-work",
    async (c) => c.json(await service.mergeWork(c.req.param("id"))),
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
