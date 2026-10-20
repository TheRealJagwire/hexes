import { useState } from "preact/hooks";
import { api } from "../lib/api.ts";
import type { RecentProject } from "../../shared/views.ts";
import { Link, navigate } from "../lib/router.tsx";
import { plural, relativeTime } from "../lib/format.ts";
import { useResource } from "../lib/use-resource.ts";
import { ChevronRight, Plus, Search } from "../components/Icons.tsx";
import {
  Brand,
  ErrorState,
  Header,
  LoadingState,
  Page,
  ThemeToggle,
} from "../components/Layout.tsx";

/** Projects opened before, in any folder: one click switches folder and project together. */
function RecentProjects() {
  const recent = useResource(() => api.recentProjects(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (recent.status !== "ready" || recent.data.length === 0) return null;
  const key = (r: RecentProject) => `${r.dir}\n${r.projectId}`;
  const run = async (r: RecentProject, fn: () => Promise<unknown>) => {
    setBusy(key(r));
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-labelledby="recent-h" class="flex flex-col gap-3">
      <h2 id="recent-h" class="m-0 text-[15px] font-semibold tracking-[0.02em] text-muted">
        Recent
      </h2>
      {error && <span role="alert" class="text-[13px] text-blocked">{error}</span>}
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        {recent.data.map((r) => {
          const usable = r.found && r.switchable;
          const meta = (
            <span class="font-mono text-xs text-muted">
              {r.folder} · {relativeTime(r.openedAt)}
            </span>
          );
          return (
            <li key={key(r)}>
              {usable
                ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    title={r.dir}
                    onClick={() =>
                      run(r, async () => {
                        await api.openRecentProject(r.dir, r.projectId);
                        navigate(`/p/${r.projectId}`);
                      })}
                    class="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-panel px-5 py-3.5 text-left text-ink hover:border-line-hover hover:bg-panel2"
                  >
                    <span class="min-w-0 flex-[1_1_220px] font-semibold">{r.title}</span>
                    {r.current && (
                      <span class="rounded-full bg-accent-bg px-2.5 py-0.5 text-xs text-accent">
                        open now
                      </span>
                    )}
                    {meta}
                    <span class="text-muted">
                      {busy === key(r) ? "…" : <ChevronRight size={16} />}
                    </span>
                  </button>
                )
                : (
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-dashed border-line px-5 py-3.5 text-muted">
                    <span class="min-w-0 flex-[1_1_220px]">{r.title}</span>
                    <span class="text-xs">
                      {r.found ? "Studio is pinned to another folder" : "Folder or project is gone"}
                    </span>
                    {meta}
                    <button
                      type="button"
                      class="btn h-9 text-[13px]"
                      disabled={busy !== null}
                      aria-label={`Remove ${r.title} from recent projects`}
                      onClick={() =>
                        run(r, async () => {
                          await api.forgetRecentProject(r.dir, r.projectId);
                          recent.reload();
                        })}
                    >
                      Remove
                    </button>
                  </div>
                )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Projects() {
  const projects = useResource(() => api.projects(), []);
  const state = useResource(() => api.state(), []);
  const [filter, setFilter] = useState("");

  const header = (
    <Header>
      <Brand asLink={false} />
      <div class="flex items-center gap-2.5">
        <ThemeToggle />
        {state.status === "ready" && state.data.dir && (
          <span class="font-mono text-[13px] text-muted">{state.data.dir}/.hx/data.json</span>
        )}
      </div>
    </Header>
  );

  const needle = filter.trim().toLowerCase();
  const rows = projects.status === "ready"
    ? projects.data.filter((p) =>
      !needle || p.title.toLowerCase().includes(needle) || p.id.includes(needle)
    )
    : [];

  return (
    <Page header={header} width={960} top="pt-14">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-col gap-2">
          <h1 class="m-0 text-[32px] font-bold tracking-[-0.02em]">Projects</h1>
          <p class="m-0 text-[15px] text-muted">
            Pick a project to open it. Recent ones from other folders switch folders too.
          </p>
        </div>
        <Link href="/welcome" class="btn text-sm">
          <Plus /> New project
        </Link>
      </div>

      <RecentProjects />

      <h2 class="m-0 text-[15px] font-semibold tracking-[0.02em] text-muted">In this folder</h2>
      <div class="flex h-11 items-center gap-2.5 rounded-[10px] border border-line bg-panel px-3.5">
        <span class="text-muted">
          <Search />
        </span>
        <label for="proj-filter" class="sr-only">Filter projects</label>
        <input
          id="proj-filter"
          type="search"
          value={filter}
          placeholder="Filter by title or hex id"
          onInput={(e) => setFilter(e.currentTarget.value)}
          class="min-w-0 flex-1 border-none bg-transparent text-[15px] text-ink outline-none"
        />
      </div>

      {projects.status === "loading" && <LoadingState />}
      {projects.status === "error" && <ErrorState message={projects.error} />}
      {projects.status === "ready" && rows.length === 0 && (
        <p class="py-8 text-center text-muted">
          {projects.data.length === 0
            ? "This folder has no projects yet."
            : "No projects match that filter."}
        </p>
      )}
      <ul class="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/p/${p.id}`}
              onClick={() => void api.selectProject(p.id).catch(() => {})}
              class="flex flex-wrap items-center gap-5 rounded-xl border border-line bg-panel px-6 py-5 text-ink no-underline hover:border-line-hover hover:bg-panel2"
            >
              <svg width="40" height="40" viewBox="0 0 28 28" aria-hidden="true" class="flex-none">
                <path
                  d="M14 2 L24.4 8 L24.4 20 L14 26 L3.6 20 L3.6 8 Z"
                  fill="var(--panel2)"
                  stroke="var(--line-strong)"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                />
                <text
                  x="14"
                  y="17.5"
                  text-anchor="middle"
                  font-family="JetBrains Mono, monospace"
                  font-size="9"
                  font-weight="600"
                  fill="var(--accent)"
                >
                  {p.initial}
                </text>
              </svg>
              <div class="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
                <span class="text-lg font-semibold">{p.title}</span>
                {p.blurb && <span class="text-sm leading-normal text-muted">{p.blurb}</span>}
              </div>
              <div class="flex flex-col items-end gap-1.5">
                <span class="font-mono text-[13px] text-ink-2">{p.id}</span>
                <span class="text-[13px] text-muted">
                  {plural(p.epics, "epic")} · {plural(p.stories, "story")}
                </span>
              </div>
              <span class="text-muted">
                <ChevronRight size={18} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
