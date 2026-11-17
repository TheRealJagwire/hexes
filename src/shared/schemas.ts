import { z } from "zod";
import {
  CORE_KINDS,
  HEX_ID_RE,
  SELECTED_PROJECT_KIND,
  SELECTED_PROJECT_PREFIX,
  type Status,
  STATUSES,
} from "./constants.ts";

export {
  CORE_KINDS,
  HEX_ID_RE,
  SELECTED_PROJECT_KIND,
  SELECTED_PROJECT_PREFIX,
  type Status,
  STATUSES,
};

export const StatusSchema = z.enum(STATUSES);

export const HexIdSchema = z.string().regex(HEX_ID_RE, "expected an id like hx-foobar-d4d");
export const KindSchema = z
  .string()
  .regex(/^[a-z0-9_-]+\.[a-z0-9_-]+$/, "expected <category>.<qualifier>, e.g. core.story");
export const MetaSchema = z.record(z.string(), z.string());

export const HexSchema = z.object({
  id: HexIdSchema,
  title: z.string().min(1),
  description: z.string(),
  kind: KindSchema,
  createdAtTimeInMs: z.number().int().nonnegative(),
  lastUpdatedAtTimeInMs: z.number().int().nonnegative(),
  status: StatusSchema,
  dependsOn: z.array(HexIdSchema).optional(),
  emergedFrom: HexIdSchema.optional(),
  meta: MetaSchema.optional(),
});
export type Hex = z.infer<typeof HexSchema>;

/** The on-disk shape of `.hx/data.json`: a plain array of hexes. */
export const DataFileSchema = z.array(HexSchema);

const trimmed = z.string().trim();

export const CreateHexRequestSchema = z.object({
  /** Any hex id (usually the project's) whose prefix the new id should share. */
  projectId: HexIdSchema,
  kind: KindSchema,
  title: trimmed.min(1, "title is required"),
  description: z.string().default(""),
  status: StatusSchema.default("blocked"),
  emergedFrom: HexIdSchema.optional(),
  /** Hexes that will gain this hex in their `dependsOn`. */
  requiredBy: z.array(HexIdSchema).default([]),
  dependsOn: z.array(HexIdSchema).default([]),
  meta: MetaSchema.default({}),
});
export type CreateHexRequest = z.infer<typeof CreateHexRequestSchema>;

export const UpdateHexRequestSchema = z.object({
  title: trimmed.min(1).optional(),
  description: z.string().optional(),
  status: StatusSchema.optional(),
  /** Required when `status` is one that records an answer (`answered`). */
  response: z.string().optional(),
  /** The `lastUpdatedAtTimeInMs` the client last saw; a mismatch is refused with 409. */
  expectedUpdatedAtTimeInMs: z.number().int().nonnegative().optional(),
});
export type UpdateHexRequest = z.infer<typeof UpdateHexRequestSchema>;

/** `POST /api/seeds` (MCP `create_seed`). */
export const CreateSeedRequestSchema = z.object({
  title: trimmed.min(1, "title is required"),
  description: z.string().default(""),
  gitUrl: trimmed.min(1, "git URL is required"),
  branch: trimmed.optional(),
});
export type CreateSeedRequest = z.infer<typeof CreateSeedRequestSchema>;

/** `PATCH /api/seeds/:id` (MCP `update_seed`): only what is given changes. */
export const UpdateSeedRequestSchema = z.object({
  title: trimmed.min(1).optional(),
  description: z.string().optional(),
  gitUrl: trimmed.min(1).optional(),
  branch: trimmed.min(1).optional(),
});
export type UpdateSeedRequest = z.infer<typeof UpdateSeedRequestSchema>;

/** `PUT /api/projects/:id/repo` (MCP `set_project_repo`): fork `seedId` into `dir`, or use `dir`. */
export const SetProjectRepoSchema = z.object({
  dir: trimmed.min(1, "a folder is required"),
  seedId: trimmed.optional(),
});
export type SetProjectRepoRequest = z.infer<typeof SetProjectRepoSchema>;

export const DirRequestSchema = z.object({ dir: trimmed.min(1, "directory is required") });

export const CreateProjectRequestSchema = z.object({
  /** The repository folder; empty to pick one later (fork a seed or choose a folder). */
  dir: trimmed.default(""),
  title: trimmed.min(1, "title is required"),
  description: z.string().default(""),
  gitInit: z.boolean().default(true),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
