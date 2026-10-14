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
