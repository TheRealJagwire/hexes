import { HexService } from "../src/server/core/service.ts";
import { Workspace } from "../src/server/core/workspace.ts";

export interface Fixture {
  dir: string;
  service: HexService;
  workspace: Workspace;
  projectId: string;
  cleanup: () => Promise<void>;
}

/** A fresh project in a temp directory, with a deterministic, strictly increasing clock. */
export async function fixture(title = "Hexes Studio"): Promise<Fixture> {
  const root = await Deno.makeTempDir({ prefix: "hexes-test-" });
  const workspace = new Workspace({ stateFile: `${root}/state.json` });
  let clock = 1_700_000_000_000;
  const service = new HexService(workspace, () => clock += 1000);
  const dir = `${root}/proj`;
  const { projectId } = await service.createProject({
    dir,
    title,
    description: "A vision.",
    gitInit: false,
  });
  return {
    dir,
    service,
    workspace,
    projectId,
    cleanup: () => Deno.remove(root, { recursive: true }),
  };
}

/** Runs git in `dir` for test setup; throws with git's message on failure. */
export async function git(dir: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", { args, cwd: dir, stdout: "piped", stderr: "piped" })
    .output();
  const text = new TextDecoder();
  if (!out.success) throw new Error(`git ${args.join(" ")}: ${text.decode(out.stderr)}`);
  return text.decode(out.stdout).trim();
}

/**
 * Makes `dir` a repository on `main` with one commit, an identity for later commits, and `.hx/`
 * ignored, as Hexes requires before it manages branches.
 */
export async function initRepo(dir: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "config", "user.email", "test@example.com");
  await Deno.writeTextFile(`${dir}/.gitignore`, ".hx/\n");
  await Deno.writeTextFile(`${dir}/README.md`, "hello\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "init");
}
