import { useState } from "preact/hooks";
import { api } from "../lib/api.ts";
import { Link } from "../lib/router.tsx";
import { plural } from "../lib/format.ts";
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
            No project selected yet. Pick one to make it your{" "}
            <code class="font-mono text-ink">studio.selected_project</code>.
          </p>
        </div>
        <Link href="/welcome" class="btn text-sm">
          <Plus /> New project
        </Link>
      </div>

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
