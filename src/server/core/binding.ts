import { HexIdSchema } from "../../shared/schemas.ts";

/**
 * A repository names the Hexes project it belongs to in `.hx/project.json`, committed with the
 * code: `{ "project_id": "hx-hexes-f1a" }`. Agents and the channel read it from the folder they
 * work in, so nothing has to remember a "selected" project. The project's hexes stay in
 * `~/.hx/projects/<id>/`.
 */
export const BINDING_PATH = ".hx/project.json";

/** The line that lets `.hx/project.json` be committed while the rest of `.hx/` stays ignored. */
export const BINDING_UNIGNORE = "!.hx/project.json";

export interface ProjectBinding {
  projectId: string;
  /** The repository folder holding `.hx/project.json`. */
  dir: string;
}

export function bindingFile(dir: string): string {
  return `${dir.replace(/\/+$/, "")}/${BINDING_PATH}`;
}

/** The project id bound to exactly `dir`, or null when it has no (readable, valid) binding. */
export async function readBinding(dir: string): Promise<string | null> {
  let text: string;
  try {
    text = await Deno.readTextFile(bindingFile(dir));
  } catch {
    return null;
  }
  try {
    const json = JSON.parse(text) as { project_id?: unknown };
    const parsed = HexIdSchema.safeParse(json?.project_id);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The nearest binding at or above `start` (an absolute path), or null when there is none. */
export async function findProjectBinding(start: string): Promise<ProjectBinding | null> {
  let dir = start.replace(/\/+$/, "") || "/";
  while (true) {
    const projectId = await readBinding(dir);
    if (projectId) return { projectId, dir };
    if (dir === "/") return null;
    dir = dir.replace(/\/[^/]*$/, "") || "/";
  }
}

/**
 * Binds `dir` to a project: writes `.hx/project.json` (creating `.hx/`) and makes sure the
 * repository's `.gitignore` lets it be committed.
 */
export async function writeBinding(dir: string, projectId: string): Promise<void> {
  await Deno.mkdir(`${dir}/.hx`, { recursive: true });
  const path = bindingFile(dir);
  const tmp = `${path}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify({ project_id: projectId }, null, 2) + "\n");
  await Deno.rename(tmp, path);
  await allowBindingInGitignore(dir);
}

/** Removes `dir`'s binding if it names `projectId`; leaves any other binding alone. */
export async function removeBinding(dir: string, projectId: string): Promise<void> {
  if (await readBinding(dir) !== projectId) return;
  await Deno.remove(bindingFile(dir)).catch(() => {});
}

/**
 * A `.gitignore` that ignores the whole `.hx/` folder would hide the binding too, and git cannot
 * re-include a file inside an excluded folder. Such a line becomes `.hx/*` (keeping a leading
 * slash) with `!.hx/project.json` after it. A `.gitignore` that does not mention `.hx` is left as
 * it is. Returns whether the file changed.
 */
export async function allowBindingInGitignore(dir: string): Promise<boolean> {
  const path = `${dir}/.gitignore`;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return false;
  }
  const lines = text.split("\n");
  let changed = false;
  let mentions = false;
  const out = lines.map((line) => {
    const t = line.trim();
    if (t === ".hx" || t === ".hx/" || t === "/.hx" || t === "/.hx/") {
      mentions = true;
      changed = true;
      return `${t.startsWith("/") ? "/" : ""}.hx/*`;
    }
    if (t === ".hx/*" || t === "/.hx/*") mentions = true;
    return line;
  });
  if (!mentions) return false;
  if (!out.some((l) => l.trim() === BINDING_UNIGNORE)) {
    const at = out.findIndex((l) => l.trim() === ".hx/*" || l.trim() === "/.hx/*");
    out.splice(at + 1, 0, BINDING_UNIGNORE);
    changed = true;
  }
  if (changed) await Deno.writeTextFile(path, out.join("\n"));
  return changed;
}
