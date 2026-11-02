import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { roleOf } from "../../shared/constants.ts";
import { AUTO_MERGE_KEY, isArchived, statusSummary } from "../../shared/graph.ts";
import type { Hex } from "../../shared/schemas.ts";
import type { EpicView, HexSummary } from "../../shared/views.ts";
import { api } from "../lib/api.ts";
import { relativeTime } from "../lib/format.ts";
import { Link } from "../lib/router.tsx";
import { useResource } from "../lib/use-resource.ts";
import { ArrowUpRight, ChevronDown, ChevronRight, HexGrid, Plus } from "../components/Icons.tsx";
import { CopyButton, KindBadge, ProgressRing, StatusPill } from "../components/Bits.tsx";
import { HexSearch } from "../components/HexSearch.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { ErrorState, Header, LoadingState, Page, ThemeToggle } from "../components/Layout.tsx";
import { Logo } from "../components/Icons.tsx";

function Chevron({ open, size = 16 }: { open: boolean; size?: number }) {
  return (
    <span
      class={`inline-flex flex-none text-muted transition-transform duration-150 ${
        open ? "rotate-90" : ""
      }`}
    >
      <ChevronRight size={size} />
    </span>
  );
}

/** `hideRetired` keeps retired hexes behind a "Show retired (n)" toggle. */
function HexGroup(
  { label, items, hideRetired = false }: {
    label: string;
    items: HexSummary[];
    hideRetired?: boolean;
  },
) {
  const [open, setOpen] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const retired = hideRetired ? items.filter((h) => h.status === "retired").length : 0;
  const shown = retired > 0 && !showRetired ? items.filter((h) => h.status !== "retired") : items;
  return (
    <div class="overflow-hidden rounded-xl border border-line bg-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        class="flex min-h-14 w-full items-center gap-3.5 border-none bg-transparent px-5 text-left text-ink hover:bg-panel2"
      >
        <Chevron open={open} />
        <span class="text-base font-semibold">{label}</span>
        <span class="rounded-full bg-line-soft px-2 py-0.5 font-mono text-xs text-muted">
          {items.length}
        </span>
        <span class="ml-auto text-[13px] text-muted">{statusSummary(items)}</span>
      </button>
      {open && (
        <ul class="m-0 flex list-none flex-col gap-1.5 px-3 pb-3">
          {items.length === 0 && (
            <li class="px-3.5 py-3 text-sm text-muted">No {label.toLowerCase()} yet.</li>
          )}
          {shown.map((h) => (
            <li key={h.id}>
              <Link
                href={`/h/${h.id}`}
                class="flex flex-wrap items-center gap-3.5 rounded-lg border border-line-soft bg-bg px-3.5 py-3 text-ink no-underline"
              >
                <span class="min-w-[120px] font-mono text-[13px] text-muted">{h.id}</span>
                <span class="flex-[1_1_260px] text-[15px]">{h.title}</span>
                <StatusPill status={h.status} />
              </Link>
            </li>
          ))}
          {retired > 0 && (
            <li>
              <button
                type="button"
                aria-pressed={showRetired}
                onClick={() => setShowRetired(!showRetired)}
                class="inline-flex h-9 items-center rounded-lg border-none bg-transparent px-3.5 text-[13px] text-accent underline-offset-2 hover:underline"
              >
                {showRetired ? "Hide retired" : `Show retired (${retired})`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function StoryRow({ story, open, onToggle }: { story: Hex; open: boolean; onToggle: () => void }) {
  const done = roleOf(story.status) === "terminal";
  const meta = Object.entries(story.meta ?? {});
  return (
    <li class="mt-2 rounded-[10px] border border-line-soft bg-bg">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        class={`flex min-h-[52px] w-full flex-wrap items-center gap-3.5 rounded-[10px] border-none bg-transparent px-4 text-left hover:bg-panel2 ${
          done ? "text-muted" : "text-ink"
        }`}
      >
        <Chevron open={open} size={14} />
        <span class="min-w-[112px] font-mono text-[13px] text-muted">{story.id}</span>
        <span
          class={`flex-[1_1_240px] text-[15px] ${done ? "line-through decoration-line-hover" : ""}`}
        >
          {story.title}
        </span>
        <StatusPill status={story.status} />
      </button>
      {open && (
        <div class="flex flex-col gap-4 pb-5 pl-11 pr-5 pt-1">
          {story.description
            ? <Markdown text={story.description} class="text-[15px] leading-relaxed text-ink-2" />
            : <p class="m-0 text-[15px] leading-relaxed text-ink-2">No description yet.</p>}
          {meta.length > 0 && (
            <dl class="m-0 grid grid-cols-[minmax(140px,max-content)_minmax(0,1fr)] gap-x-5 gap-y-2 font-mono text-[13px]">
              {meta.map(([k, v]) => (
                <>
                  <dt class="text-muted">{k}</dt>
                  <dd class="m-0 break-words text-ink">{v}</dd>
                </>
              ))}
            </dl>
          )}
          <div class="flex flex-wrap gap-2.5">
            <Link
              href={`/h/${story.id}`}
              class="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3.5 text-sm text-ink no-underline"
            >
              Open hex <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

function EpicAccordion({ epic, defaultOpen }: { epic: EpicView; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [openStory, setOpenStory] = useState<string | null>(null);
  const { done, total, pct } = epic.progress;
  const inReview = epic.stories.filter((s) => s.status === "in_review").length;
  return (
    <div
      class={`overflow-hidden rounded-[14px] border bg-panel ${
        open ? "border-line-strong" : "border-line"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        class="flex w-full flex-wrap items-center gap-[18px] border-none bg-transparent px-[22px] py-4 text-left text-ink hover:bg-panel2"
      >
        <Chevron open={open} />
        <div class="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
          <span class="font-mono text-xs text-muted">
            {epic.hex.id}
            {epic.gate ? ` · gate: ${epic.gate.title}` : ""}
          </span>
          <span class="flex flex-wrap items-center gap-2.5 text-lg font-semibold">
            {epic.hex.title}
            {isArchived(epic.hex) && (
              <span class="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                Archived
              </span>
            )}
          </span>
        </div>
        <div class="flex items-center gap-3.5">
          <div class="flex flex-col items-end gap-0.5">
            <span class="text-xl font-bold tabular-nums">{pct}%</span>
            <span class="font-mono text-xs text-muted">
              {inReview > 0 && <span class="text-accent">{inReview} in review ·</span>}{" "}
              {done}/{total} done
            </span>
          </div>
          <ProgressRing done={done} total={total} pct={pct} />
        </div>
      </button>
      {open && (
        <ul class="m-0 flex list-none flex-col gap-2 border-t border-line-soft px-4 pb-4 pt-1">
          {epic.stories.length === 0 && (
            <li class="px-1 pt-3 text-sm text-muted">
              This epic doesn't depend on any stories yet.
            </li>
          )}
          {epic.stories.map((s) => (
            <StoryRow
              key={s.id}
              story={s}
              open={openStory === s.id}
              onToggle={() => setOpenStory(openStory === s.id ? null : s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Archived epics stay behind a "Show archived (n)" toggle, after the others. */
function EpicList({ epics }: { epics: EpicView[] }) {
  const [showArchived, setShowArchived] = useState(false);
  const active = epics.filter((e) => !isArchived(e.hex));
  const archived = epics.filter((e) => isArchived(e.hex));
  const shown = showArchived ? [...active, ...archived] : active;
  return (
    <>
      {shown.map((e, i) => <EpicAccordion key={e.hex.id} epic={e} defaultOpen={i === 0} />)}
      {archived.length > 0 && (
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
          class="inline-flex h-9 items-center self-start rounded-lg border-none bg-transparent px-1 text-[13px] text-accent underline-offset-2 hover:underline"
        >
          {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
        </button>
      )}
    </>
  );
}

export function ProjectHeader(
  { projectId, title, children }: {
    projectId: string;
    title?: string;
    children?: ComponentChildren;
  },
) {
  return (
    <Header compact>
      <div class="flex flex-wrap items-center gap-3.5">
        <Link
          href="/projects"
          aria-label="All projects"
          class="flex min-h-11 items-center gap-3 text-ink no-underline"
        >
          <Logo />
          <span class="text-lg font-bold tracking-[-0.01em]">Hexes Studio</span>
        </Link>
        {title && (
          <>
            <span class="text-line-hover" aria-hidden="true">/</span>
            <Link
              href="/projects"
              class="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-ink-2 no-underline"
              title="Switch project"
            >
              {title} <ChevronDown size={14} />
            </Link>
          </>
        )}
      </div>
      <HexSearch projectId={projectId} class="order-last w-full sm:order-none sm:w-80" />
      <div class="flex items-center gap-2.5">
        <ThemeToggle />
        {children ?? (
          <Link href={`/p/${projectId}/new`} class="btn-primary">
            <Plus size={16} width={2.4} /> Create hex
          </Link>
        )}
      </div>
    </Header>
  );
}

/**
 * The project's auto-merge switch, kept in plain sight: while it is on, Studio merges every pull
 * request as soon as it is opened, without anyone reviewing it.
 */
function AutoMergeBar(
  { projectId, on, onChange }: { projectId: string; on: boolean; onChange: () => void },
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setAutoMerge(projectId, !on);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <section
      aria-labelledby="auto-merge-h"
      class={`flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border px-6 py-4 ${
        on ? "border-accent bg-accent-bg" : "border-line-strong bg-panel"
      }`}
    >
      <div class="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
        <h2
          id="auto-merge-h"
          class={`m-0 text-base font-semibold ${on ? "text-accent" : "text-ink"}`}
        >
          Auto-merge is {on ? "on" : "off"}
        </h2>
        <p class="m-0 text-sm leading-normal text-ink-2">
          {on
            ? "Studio merges each pull request into main as soon as it's opened, with no review, and brings the other open branches up to date."
            : "Pull requests wait for someone to review and merge them."}
        </p>
        {error && <span role="alert" class="text-[13px] text-blocked">{error}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="auto-merge-h"
        disabled={busy}
        onClick={toggle}
        class={`relative inline-flex h-8 w-14 flex-none items-center rounded-full border-none transition-colors duration-150 ${
          on ? "bg-accent" : "bg-line-strong"
        }`}
      >
        <span
          aria-hidden="true"
          class={`inline-block size-6 rounded-full bg-white shadow transition-transform duration-150 ${
            on ? "translate-x-7" : "translate-x-1"
          }`}
        />
      </button>
    </section>
  );
}

/** The project statement, cut off after about ten lines; the full text lives on the hex's own page. */
function ClampedDescription({ text, href }: { text: string; href: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <div class="flex max-w-[760px] flex-col items-start gap-2">
      <div
        ref={ref}
        class={`w-full overflow-hidden text-[17px] leading-relaxed text-ink-2 ${
          clamped ? "[mask-image:linear-gradient(to_bottom,#000_75%,transparent)]" : ""
        }`}
        style={{ maxHeight: "16.25em" }}
      >
        <Markdown text={text} />
      </div>
      {clamped && (
        <Link href={href} class="text-[13px] text-accent underline-offset-2 hover:underline">
          Read the full description
        </Link>
      )}
    </div>
  );
}

export function ProjectScreen({ id }: { id: string }) {
  const res = useResource(() => api.project(id), [id]);

  // Opening a project makes it the selected one, so Studio reopens here next time.
  useEffect(() => {
    void api.selectProject(id).catch(() => {});
  }, [id]);

  if (res.status !== "ready") {
    return (
      <Page header={<ProjectHeader projectId={id} />}>
        {res.status === "loading" ? <LoadingState /> : (
          <ErrorState
            message={res.error}
            action={<Link href="/projects" class="btn">All projects</Link>}
          />
        )}
      </Page>
    );
  }

  const { project, ideas, designs, specs, decisions, questions, facts, epics, autoMerge } =
    res.data;
  // Auto-merge has its own switch below.
  const meta = Object.entries(project.meta ?? {}).filter(([k]) => k !== AUTO_MERGE_KEY);
  return (
    <Page
      header={
        <ProjectHeader projectId={id} title={project.title}>
          <Link href={`/p/${id}/map`} class="btn">
            <HexGrid size={16} /> Hex map
          </Link>
          <Link href={`/p/${id}/new`} class="btn-primary">
            <Plus size={16} width={2.4} /> Create hex
          </Link>
        </ProjectHeader>
      }
    >
      <section
        aria-label="Project statement"
        class="flex flex-col gap-[18px] rounded-2xl border border-line bg-panel px-10 py-9"
      >
        <div class="flex flex-wrap items-center gap-3">
          <KindBadge kind={project.kind} />
          <Link
            href={`/h/${project.id}`}
            class="border-b border-dashed border-line-hover font-mono text-sm text-ink-2 no-underline"
          >
            {project.id}
          </Link>
          <CopyButton text={project.id} />
        </div>
        <h1 class="m-0 text-[40px] font-bold leading-[1.12] tracking-[-0.02em]">{project.title}</h1>
        {project.description && (
          <ClampedDescription text={project.description} href={`/h/${project.id}`} />
        )}
        <div class="flex flex-wrap gap-2.5 font-mono text-xs text-muted">
          {meta.map(([k, v]) => (
            <span key={k} class="rounded-md border border-line px-2.5 py-[5px]">{k}: {v}</span>
          ))}
          <span class="rounded-md border border-line px-2.5 py-[5px]">
            updated {relativeTime(project.lastUpdatedAtTimeInMs)}
          </span>
        </div>
      </section>

      <AutoMergeBar projectId={id} on={autoMerge} onChange={res.reload} />

      <div class="flex flex-col gap-2.5">
        <HexGroup label="Ideas" items={ideas} />
        <HexGroup label="Designs" items={designs} />
        <HexGroup label="Specs" items={specs} />
        <HexGroup label="Decisions" items={decisions} />
        <HexGroup label="Questions" items={questions} />
        <HexGroup label="Facts" items={facts} hideRetired />
      </div>

      <div class="flex flex-col gap-3.5">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 class="m-0 text-[22px] font-bold tracking-[-0.01em]">Epics</h2>
          <span class="text-[13px] text-muted">Progress counts stories each epic depends on</span>
        </div>
        {epics.length === 0 && (
          <p class="m-0 rounded-[14px] border border-dashed border-line-strong p-8 text-center text-muted">
            No epics yet. Use “Create hex” and pick <code class="font-mono">core.epic</code>.
          </p>
        )}
        <EpicList epics={epics} />
      </div>
    </Page>
  );
}
