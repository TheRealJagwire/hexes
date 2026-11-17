import type { WorkspaceState } from "../../shared/views.ts";
import type { ToastHandle, ToastStore } from "./toasts.ts";

export const MIGRATION_TEXT = "Move this project's data to ~/.hx/projects?";

/** Which v1 folder the offer is about, or null when there is nothing to offer. */
export function migrationKey(state: WorkspaceState): string | null {
  return state.schemaVersion === 1 && state.dir && !state.pinned ? state.dir : null;
}

/**
 * Offers to migrate the open v1 folder, once each time it is opened. "Not now" or closing the
 * notification hides it until the folder is opened again (another folder or project in between).
 */
export class MigrationOffer {
  private shownFor: string | null = null;
  private handle: ToastHandle | null = null;

  constructor(
    private readonly toasts: ToastStore,
    private readonly migrate: (dir: string) => Promise<{ projects: string[] }>,
    private readonly done: (projects: string[]) => void,
  ) {}

  /** Call with each fresh workspace state. */
  update(state: WorkspaceState): void {
    const key = migrationKey(state);
    if (key === this.shownFor) return;
    this.handle?.close();
    this.handle = null;
    this.shownFor = key;
    if (!key) return;
    this.handle = this.toasts.show(MIGRATION_TEXT, "info", null, {
      actions: [
        { label: "Migrate", primary: true, run: () => void this.run(key) },
        { label: "Not now", run: () => this.handle?.close() },
      ],
      onClose: () => {
        this.handle = null;
      },
    });
  }

  private async run(dir: string): Promise<void> {
    this.handle?.update({ text: "Moving the data…", actions: [] });
    try {
      const { projects } = await this.migrate(dir);
      this.handle?.close();
      this.toasts.show(`Moved ${projects.join(", ")} to ~/.hx/projects`, "success");
      this.done(projects);
    } catch (e) {
      this.handle?.close();
      this.toasts.show(e instanceof Error ? e.message : String(e), "failure");
    }
  }
}
