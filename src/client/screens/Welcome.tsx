import { useEffect, useState } from "preact/hooks";
import { api } from "../lib/api.ts";
import { notify, notifyError } from "../lib/toasts.ts";
import { navigate } from "../lib/router.tsx";
import type { InspectResult, ProjectSummary } from "../../shared/views.ts";
import { Folder, HexPlus } from "../components/Icons.tsx";
import { Brand, Header, ThemeToggle } from "../components/Layout.tsx";

function DirField(
  { id, label, value, onInput, placeholder, onBrowse }: {
    id: string;
    label: string;
    value: string;
    onInput: (v: string) => void;
    placeholder?: string;
    onBrowse: () => void;
  },
) {
  return (
    <div class="flex flex-col gap-2">
      <label for={id} class="label">{label}</label>
      <div class="flex gap-2">
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          spellcheck={false}
          onInput={(e) => onInput(e.currentTarget.value)}
          class="field field-mono flex-1"
        />
        <button
          type="button"
          onClick={onBrowse}
          class="btn h-11 rounded-lg bg-panel2 px-4 text-[15px] font-normal"
        >
          Browse…
        </button>
      </div>
    </div>
  );
}

export function Welcome() {
  const [openDir, setOpenDir] = useState("");
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [newDir, setNewDir] = useState("");
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [gitInit, setGitInit] = useState(true);
  const [busy, setBusy] = useState<"open" | "create" | null>(null);
  const [error, setError] = useState<{ where: "open" | "create"; message: string } | null>(null);
  const [warnings, setWarnings] = useState<{ projectId: string; items: string[] } | null>(null);
  const [saved, setSaved] = useState<ProjectSummary[]>([]);

  // Projects already in ~/.hx/projects, to open with one click.
  useEffect(() => {
    api.projects().then((list) => setSaved(list.filter((p) => !p.needsMigration)), () => {});
  }, []);

  const openSaved = async (p: ProjectSummary) => {
    try {
      await api.selectProject(p.id);
      navigate(`/p/${p.id}`);
    } catch (e) {
      notifyError(e);
    }
  };

  useEffect(() => {
    api.state().then((s) => s.lastDir && setOpenDir((cur) => cur || s.lastDir || "")).catch(
      () => {},
    );
  }, []);

  // Check the typed directory for .hx/data.json shortly after the user stops typing.
  useEffect(() => {
    if (!openDir.trim()) return setInspect(null);
    let live = true;
    const t = setTimeout(() => {
      api.inspect(openDir).then((r) => live && setInspect(r), () => live && setInspect(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [openDir]);

  const browse = async (set: (dir: string) => void, where: "open" | "create") => {
    try {
      const { dir } = await api.pickDirectory();
      if (dir) set(dir);
    } catch (e) {
      setError({ where, message: notifyError(e) });
    }
  };

  const open = async () => {
    setBusy("open");
    setError(null);
    try {
      await api.openWorkspace(openDir);
      notify(`Opened ${openDir}`);
      navigate("/");
    } catch (e) {
      setError({ where: "open", message: notifyError(e) });
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const res = await api.createProject({ dir: newDir, title, description: statement, gitInit });
      notify(`Created ${title.trim() || "the project"}`);
      if (res.warnings.length) setWarnings({ projectId: res.projectId, items: res.warnings });
      else navigate(`/p/${res.projectId}`);
    } catch (err) {
      setError({ where: "create", message: notifyError(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="flex min-h-screen flex-col bg-bg text-ink">
      <Header>
        <Brand asLink={false} />
        <div class="flex items-center gap-2.5">
          <ThemeToggle />
          <span class="font-mono text-[13px] text-muted">no project open</span>
        </div>
      </Header>

      <main class="mx-auto box-border flex w-full max-w-[1080px] flex-1 flex-col gap-12 px-8 pb-16 pt-[72px]">
        <div class="flex max-w-[680px] flex-col gap-3.5">
          <span class="font-mono text-[13px] tracking-[0.04em] text-accent">FIRST RUN</span>
          <h1 class="m-0 text-[44px] font-bold leading-[1.1] tracking-[-0.02em]">
            Track every piece of a project as a hex.
          </h1>
          <p class="m-0 text-[17px] leading-relaxed text-muted">
            Start a new project for a repository, or open one you have. Studio keeps each project's
            hexes in{" "}
            <code class="font-mono text-ink">~/.hx/projects/&lt;id&gt;</code>, outside the repo.
          </p>
        </div>

        {saved.length > 0 && (
          <section aria-labelledby="saved-h" class="flex flex-col gap-3">
            <h2 id="saved-h" class="m-0 text-xl font-semibold">Your projects</h2>
            <ul class="m-0 flex list-none flex-col gap-2 p-0">
              {saved.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => void openSaved(p)}
                    class="card flex w-full flex-wrap items-center gap-4 px-6 py-4 text-left hover:border-line-hover"
                  >
                    <span class="text-lg font-semibold text-ink">{p.title}</span>
                    <span class="font-mono text-[13px] text-ink-2">{p.id}</span>
                    {p.repoPath && (
                      <span class="ml-auto font-mono text-xs text-muted">{p.repoPath}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div class="flex flex-wrap items-stretch gap-6">
          <section
            aria-labelledby="open-h"
            class="card flex min-w-0 flex-[1_1_380px] flex-col gap-5 p-8"
          >
            <div class="flex items-center gap-3">
              <Folder size={22} />
              <h2 id="open-h" class="m-0 text-xl font-semibold">Open an older project</h2>
            </div>
            <p class="m-0 text-[15px] leading-normal text-muted">
              Pick a repository that still keeps its hexes in{" "}
              <code class="font-mono text-ink">.hx/data.json</code>. Once it is open, Studio offers
              to move them to <code class="font-mono text-ink">~/.hx/projects</code>.
            </p>
            <div class="flex flex-col gap-2">
              <DirField
                id="open-dir"
                label="Directory"
                value={openDir}
                onInput={setOpenDir}
                placeholder="~/code/my-project"
                onBrowse={() => browse(setOpenDir, "open")}
              />
              {inspect && (
                <span
                  role="status"
                  class={`font-mono text-xs ${inspect.found ? "text-success" : "text-blocked"}`}
                >
                  {inspect.found
                    ? `✓ found .hx/data.json · ${inspect.hexCount} hexes · ${inspect.projectCount} ${
                      inspect.projectCount === 1 ? "project" : "projects"
                    } · will offer migration`
                    : `✗ ${inspect.error ?? "not found"}`}
                </span>
              )}
              {error?.where === "open" && (
                <span role="alert" class="text-[13px] text-blocked">{error.message}</span>
              )}
            </div>
            <button
              type="button"
              disabled={!inspect?.found || busy !== null}
              onClick={open}
              class="btn-primary mt-auto h-12"
            >
              {busy === "open" ? "Opening…" : "Open project folder"}
            </button>
          </section>

          <section
            aria-labelledby="new-h"
            class="card flex min-w-0 flex-[1_1_380px] flex-col gap-5 p-8"
          >
            <div class="flex items-center gap-3">
              <HexPlus size={22} />
              <h2 id="new-h" class="m-0 text-xl font-semibold">Create new project</h2>
            </div>
            <form onSubmit={create} class="flex flex-1 flex-col gap-5">
              <DirField
                id="new-dir"
                label="Repository folder"
                value={newDir}
                onInput={setNewDir}
                placeholder="~/code/my-project"
                onBrowse={() => browse(setNewDir, "create")}
              />
              <span class="-mt-3 text-[13px] text-muted">
                Leave empty to pick a repository later (fork a seed or choose a folder).
              </span>
              <div class="flex flex-col gap-2">
                <label for="new-title" class="label">Project title</label>
                <input
                  id="new-title"
                  type="text"
                  value={title}
                  placeholder="What are you building?"
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  class="field"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label for="new-desc" class="label">Project statement</label>
                <textarea
                  id="new-desc"
                  rows={4}
                  value={statement}
                  placeholder="Describe the vision. This becomes the description of your core.project hex."
                  onInput={(e) => setStatement(e.currentTarget.value)}
                  class="box-border resize-y rounded-lg border border-line-strong bg-bg px-3.5 py-3 text-[15px] leading-normal text-ink"
                />
              </div>
              <div class="flex items-center gap-2.5 text-sm text-muted">
                <input
                  id="git-init"
                  type="checkbox"
                  checked={gitInit}
                  onChange={(e) => setGitInit(e.currentTarget.checked)}
                  class="size-[18px] accent-accent"
                />
                <label for="git-init">
                  Initialize a git repo there if it has none. The hexes go in{" "}
                  <code class="font-mono text-ink">~/.hx/projects</code>.
                </label>
              </div>
              {error?.where === "create" && (
                <span role="alert" class="text-[13px] text-blocked">{error.message}</span>
              )}
              {warnings && (
                <div
                  role="status"
                  class="rounded-lg border border-line-strong p-3 text-[13px] text-ink-2"
                >
                  Project created, but: {warnings.items.join(" ")}{" "}
                  <button
                    type="button"
                    class="font-semibold text-accent underline"
                    onClick={() => navigate(`/p/${warnings.projectId}`)}
                  >
                    Continue
                  </button>
                </div>
              )}
              <button
                type="submit"
                disabled={busy !== null || !title.trim() || warnings !== null}
                class="btn mt-auto h-12 border-[1.5px] border-accent bg-transparent font-semibold text-accent"
              >
                {busy === "create" ? "Creating…" : "Create project"}
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
