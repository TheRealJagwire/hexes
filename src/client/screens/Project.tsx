import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { roleOf } from "../../shared/constants.ts";
import { AUTO_MERGE_KEY, canArchiveEpic, isArchived, statusSummary } from "../../shared/graph.ts";
import type { Hex } from "../../shared/schemas.ts";
import type {
  AgentActivity,
  EpicView,
  GateView,
  HexSummary,
  ProjectView,
} from "../../shared/views.ts";
import { api } from "../lib/api.ts";
import { notify, notifyError } from "../lib/toasts.ts";
import { relativeTime } from "../lib/format.ts";
import { pendingScroll } from "../lib/handoff.ts";
import { agentCall, liveVersion } from "../lib/live.ts";
import {
  focusFrom,
  PROJECT_TABS,
  type ProjectSpot,
  type ProjectTab,
  spotOf,
} from "../lib/project-focus.ts";
import { Link, location, navigate } from "../lib/router.tsx";
import { useResource } from "../lib/use-resource.ts";
import {
  Archive,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  HexGrid,
  Plus,
  Unarchive,
} from "../components/Icons.tsx";
import { CopyButton, KindBadge, ProgressRing, StatusPill } from "../components/Bits.tsx";
import { HexSearch } from "../components/HexSearch.tsx";
import { MilestoneStepper } from "../components/MilestoneStepper.tsx";
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

/** The hex an agent changed last (within ten minutes), and the tool it used. */
const Working = createContext<AgentActivity["working"]>(null);

/** The hex the page was asked to show (`?hex=`), while it flashes. */
const Focus = createContext<string | null>(null);

/** "Claude is working · start_work_branch" on the marked row. */
function WorkingLabel({ tool }: { tool: string }) {
  return (
    <span class="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
      <span class="hx-working-dot size-2 rounded-full bg-accent" aria-hidden="true" />
      Claude is working
      <span class="font-mono text-xs font-normal text-muted">· {tool}</span>
    </span>
  );
}

/** A list of hex rows; `hideRetired` keeps retired ones behind a "Show retired (n)" toggle. */
function HexRows(
  { label, items, hideRetired = false }: {
    label: string;
    items: HexSummary[];
    hideRetired?: boolean;
  },
) {
  const [showRetired, setShowRetired] = useState(false);
  const working = useContext(Working);
  const focus = useContext(Focus);
  const retired = hideRetired ? items.filter((h) => h.status === "retired").length : 0;
  // A retired hex the page was asked for shows anyway.
  const wanted = items.some((h) => h.id === focus && h.status === "retired");
  const hidden = retired > 0 && !showRetired && !wanted;
  const shown = hidden ? items.filter((h) => h.status !== "retired") : items;
  return (
    <ul class="m-0 flex list-none flex-col gap-1.5 px-3 pb-3">
      {items.length === 0 && (
        <li class="px-3.5 py-3 text-sm text-muted">No {label.toLowerCase()} yet.</li>
      )}
      {shown.map((h) => (
        <li key={h.id} data-hex-row={h.id}>
          <Link
            href={`/h/${h.id}`}
            class={`flex flex-wrap items-center gap-3.5 rounded-lg border border-line-soft bg-bg px-3.5 py-3 text-ink no-underline ${
              working?.hexId === h.id ? "hx-working" : ""
            } ${focus === h.id ? "hx-focus" : ""}`}
          >
            <span class="min-w-[120px] font-mono text-[13px] text-muted">{h.id}</span>
            <span class="flex-[1_1_260px] text-[15px]">{h.title}</span>
            {working?.hexId === h.id && <WorkingLabel tool={working.tool} />}
            <StatusPill status={h.status} />
          </Link>
        </li>
      ))}
      {retired > 0 && (
        <li>
          <button
            type="button"
            aria-pressed={!hidden}
            onClick={() => setShowRetired(hidden)}
            class="inline-flex h-9 items-center rounded-lg border-none bg-transparent px-3.5 text-[13px] text-accent underline-offset-2 hover:underline"
          >
            {hidden ? `Show retired (${retired})` : "Hide retired"}
          </button>
        </li>
      )}
    </ul>
  );
}

/** A collapsible group of hex rows; it opens for the hex being worked on or asked for. */
function HexGroup(
  { label, items, hideRetired = false }: {
    label: string;
    items: HexSummary[];
    hideRetired?: boolean;
  },
) {
  const [open, setOpen] = useState(false);
  const working = useContext(Working);
  const focus = useContext(Focus);
  const holdsWorking = working !== null && items.some((h) => h.id === working.hexId);
  const holdsFocus = focus !== null && items.some((h) => h.id === focus);
  useEffect(() => {
    if (holdsWorking || holdsFocus) setOpen(true);
  }, [holdsWorking, working?.hexId, holdsFocus]);
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
      {open && <HexRows label={label} items={items} hideRetired={hideRetired} />}
    </div>
  );
}

/**
 * Ideas, designs, specs, decisions and questions as tabs. A tab holding the hex Claude is working
 * on shows a dot. Arrow keys, Home and End move between tabs.
 */
function ProjectTabs(
  { lists, tab, onTab }: {
    lists: Record<ProjectTab, HexSummary[]>;
    tab: ProjectTab;
    onTab: (tab: ProjectTab) => void;
  },
) {
  const working = useContext(Working);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = PROJECT_TABS.findIndex((t) => t.key === tab);
  const move = (e: KeyboardEvent) => {
    const last = PROJECT_TABS.length - 1;
    const next = e.key === "ArrowRight"
      ? (index + 1) % PROJECT_TABS.length
      : e.key === "ArrowLeft"
      ? (index + last) % PROJECT_TABS.length
      : e.key === "Home"
      ? 0
      : e.key === "End"
      ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onTab(PROJECT_TABS[next]!.key);
    refs.current[next]?.focus();
  };
  const current = PROJECT_TABS[index]!;
  const items = lists[tab];
  return (
    <div class="overflow-hidden rounded-xl border border-line bg-panel">
      <div
        role="tablist"
        aria-label="Planning hexes"
        class="flex overflow-x-auto border-b border-line px-2"
        onKeyDown={move}
      >
        {PROJECT_TABS.map((t, i) => {
          const selected = t.key === tab;
          const busy = working !== null && lists[t.key].some((h) => h.id === working.hexId);
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTab(t.key)}
              class={`-mb-px inline-flex min-h-[52px] flex-none items-center gap-2 border-x-0 border-t-0 border-b-2 border-solid bg-transparent px-4 text-[15px] ${
                selected
                  ? "border-accent font-semibold text-ink"
                  : "border-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {t.label}
              <span class="rounded-full bg-line-soft px-2 py-0.5 font-mono text-xs font-normal text-muted">
                {lists[t.key].length}
              </span>
              {busy && (
                <span
                  class="hx-working-dot size-2 rounded-full bg-accent"
                  title="Claude is working on a hex here"
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`tabpanel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        class="flex flex-col"
      >
        {items.length > 0 && (
          <p class="m-0 px-6 pb-2 pt-3.5 text-[13px] text-muted">{statusSummary(items)}</p>
        )}
        <div class={items.length > 0 ? "" : "pt-3"}>
          <HexRows key={tab} label={current.label} items={items} />
        </div>
      </div>
    </div>
  );
}

/**
 * The project's gates as a milestone track, in milestone order (`sortGates` puts done gates
 * first). The leading done gates are filled in, the next one is current, and each step opens its gate.
 */
function GateStepper({ gates }: { gates: GateView[] }) {
  const working = useContext(Working);
  const focus = useContext(Focus);
  if (gates.length === 0) return null;
  const done = gates.filter((g) => g.hex.status === "done").length;
  const leading = gates.findIndex((g) => g.hex.status !== "done");
  const current = leading < 0 ? gates.length : leading;
  const milestones = gates.map((g) => ({ id: g.hex.id, label: g.hex.title }));
  return (
    <section
      aria-labelledby="milestones-h"
      class="flex flex-col gap-4 rounded-2xl border border-line bg-panel px-6 py-5"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="milestones-h" class="m-0 text-base font-semibold">Milestones</h2>
        <span class="font-mono text-xs text-muted">
          {done}/{gates.length} gates done · {Math.round((done / gates.length) * 100)}%
        </span>
      </div>
      <MilestoneStepper
        milestones={milestones}
        current={current}
        onSelect={(_, m) => navigate(`/h/${m.id}`)}
        accent="var(--accent)"
        ink="var(--ink)"
        track="var(--line)"
        muted="var(--muted)"
        hollow="var(--line-hover)"
        surface="var(--panel)"
        aria-label={`Gates: ${done} of ${gates.length} done`}
        itemProps={(m) => ({
          "data-hex-row": m.id,
          class: [
            "rounded-lg",
            working?.hexId === m.id ? "hx-working" : "",
            focus === m.id ? "hx-focus" : "",
          ].filter(Boolean).join(" "),
        })}
        class="mx-3"
      />
    </section>
  );
}

function StoryRow({ story, open, onToggle }: { story: Hex; open: boolean; onToggle: () => void }) {
  const done = roleOf(story.status) === "terminal";
  const meta = Object.entries(story.meta ?? {});
  const working = useContext(Working);
  const focus = useContext(Focus);
  const here = working?.hexId === story.id;
  return (
    <li
      data-hex-row={story.id}
      class={`mt-2 rounded-[10px] border border-line-soft bg-bg ${here ? "hx-working" : ""} ${
        focus === story.id ? "hx-focus" : ""
      }`}
    >
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
        {here && <WorkingLabel tool={working.tool} />}
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

/**
 * Archive a finished epic, or unarchive an archived one, from its row. Nothing for an epic that
 * still has open stories (or none).
 */
function ArchiveButton({ epic, onChange }: { epic: EpicView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = isArchived(epic.hex);
  if (!archived && !canArchiveEpic(epic.stories)) return null;
  const label = archived ? "Unarchive hex" : "Archive hex";
  const press = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setArchived(epic.hex.id, !archived);
      notify(`${archived ? "Unarchived" : "Archived"} ${epic.hex.id}`);
      onChange();
    } catch (e) {
      setError(notifyError(e));
    }
    setBusy(false);
  };
  return (
    <div class="flex flex-none items-center gap-2">
      {error && <span role="alert" class="max-w-[220px] text-[13px] text-blocked">{error}</span>}
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled={busy}
        onClick={press}
        class="inline-flex size-9 flex-none items-center justify-center rounded-lg border border-line-strong bg-transparent text-muted hover:bg-panel2 hover:text-ink disabled:opacity-50"
      >
        {archived ? <Unarchive size={18} /> : <Archive size={18} />}
      </button>
    </div>
  );
}

function EpicAccordion(
  { epic, defaultOpen, onChange }: { epic: EpicView; defaultOpen: boolean; onChange: () => void },
) {
  const [open, setOpen] = useState(defaultOpen);
  const [openStory, setOpenStory] = useState<string | null>(null);
  const working = useContext(Working);
  const here = working?.hexId === epic.hex.id;
  const focus = useContext(Focus);
  const holdsWorking = working !== null && epic.stories.some((s) => s.id === working.hexId);
  const focusStory = epic.stories.some((s) => s.id === focus) ? focus : null;
  // A story being worked on shows, so the epic opens for it; one asked for opens too.
  useEffect(() => {
    if (holdsWorking) setOpen(true);
  }, [holdsWorking, working?.hexId]);
  useEffect(() => {
    if (focusStory) {
      setOpen(true);
      setOpenStory(focusStory);
    }
  }, [focusStory]);
  const { done, total, pct } = epic.progress;
  const inReview = epic.stories.filter((s) => s.status === "in_review").length;
  return (
    <div
      data-hex-row={epic.hex.id}
      class={`overflow-hidden rounded-[14px] border bg-panel ${
        open ? "border-line-strong" : "border-line"
      } ${here ? "hx-working" : ""} ${focus === epic.hex.id ? "hx-focus" : ""}`}
    >
      <div class="flex items-center gap-3 pr-4 hover:bg-panel2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          class="flex min-w-0 flex-1 flex-wrap items-center gap-[18px] border-none bg-transparent py-4 pl-[22px] text-left text-ink"
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
            {here && <WorkingLabel tool={working.tool} />}
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
        <ArchiveButton epic={epic} onChange={onChange} />
      </div>
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
function EpicList({ epics, onChange }: { epics: EpicView[]; onChange: () => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const focus = useContext(Focus);
  const active = epics.filter((e) => !isArchived(e.hex));
  const archived = epics.filter((e) => isArchived(e.hex));
  // An archived epic the page was asked for (or a story in one) brings the archived ones out.
  const wanted = archived.some((e) => e.hex.id === focus || e.stories.some((s) => s.id === focus));
  useEffect(() => {
    if (wanted) setShowArchived(true);
  }, [wanted]);
  const shown = showArchived ? [...active, ...archived] : active;
  return (
    <>
      {shown.map((e, i) => (
        <EpicAccordion key={e.hex.id} epic={e} defaultOpen={i === 0} onChange={onChange} />
      ))}
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
 * The project's auto-merge switch, small, in the project statement's top row. While it is on,
 * Studio merges every pull request as soon as it is opened, without anyone reviewing it; the
 * tooltip (on hover or keyboard focus) says so.
 */
function AutoMergeToggle(
  { projectId, on, onChange }: { projectId: string; on: boolean; onChange: () => void },
) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api.setAutoMerge(projectId, !on);
      notify(`Auto-merge is ${on ? "off" : "on"}`);
      onChange();
    } catch (e) {
      notifyError(e);
    }
    setBusy(false);
  };
  return (
    <div class="group relative ml-auto flex items-center">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby="auto-merge-tip"
        disabled={busy}
        onClick={toggle}
        class={`inline-flex min-h-9 items-center gap-2 rounded-full border border-solid bg-transparent py-1 pl-1.5 pr-3 disabled:opacity-50 ${
          on ? "border-accent text-accent" : "border-line-strong text-ink-2 hover:text-ink"
        }`}
      >
        <span
          aria-hidden="true"
          class={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors duration-150 ${
            on ? "bg-accent" : "bg-line-strong"
          }`}
        >
          <span
            class={`inline-block size-4 rounded-full bg-white shadow transition-transform duration-150 ${
              on ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </span>
        <span class="font-mono text-xs font-medium">auto-merge</span>
      </button>
      <span
        id="auto-merge-tip"
        role="tooltip"
        class="pointer-events-none invisible absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border border-line-strong bg-panel px-3.5 py-2.5 text-[13px] leading-normal text-ink-2 opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <strong class="text-ink">Auto-merge is {on ? "on" : "off"}.</strong>{" "}
        When on, Studio merges each pull request into main as soon as it's opened, with no review,
        and brings the other open branches up to date. When off, pull requests wait for someone to
        review and merge them.
      </span>
    </div>
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

/** Re-reads agent activity on every agent event, hex change, and every 30 s (to let it expire). */
function useWorking(projectId: string): AgentActivity["working"] {
  const [working, setWorking] = useState<AgentActivity["working"]>(null);
  const [tick, setTick] = useState(0);
  const call = agentCall.value;
  const version = liveVersion.value;
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    api.agent(projectId).then((a) => live && setWorking(a.working)).catch(() => {});
    return () => {
      live = false;
    };
  }, [projectId, call, version, tick]);
  return working;
}

/**
 * After a hand-off, scrolls the working hex's row into view the first time Claude changes a hex:
 * once, and not at all if the person scrolled or typed since arriving.
 */
function useHandoffScroll(
  projectId: string,
  working: AgentActivity["working"],
  data: unknown,
): void {
  useEffect(() => {
    const cancel = () => {
      if (pendingScroll.peek()?.projectId === projectId) pendingScroll.value = null;
    };
    const events = ["wheel", "touchmove", "keydown"] as const;
    for (const e of events) addEventListener(e, cancel, { passive: true });
    return () => {
      for (const e of events) removeEventListener(e, cancel);
    };
  }, [projectId]);
  useEffect(() => {
    const pending = pendingScroll.peek();
    if (!working || pending?.projectId !== projectId || working.at < pending.since) return;
    // The row may only appear once the project reloads (a hex just created) and the group or
    // epic holding it has opened, so look for a few frames; this runs again when data reloads.
    let frame = 0;
    let tries = 0;
    const look = () => {
      if (pendingScroll.peek() !== pending) return;
      const row = document.querySelector(`[data-hex-row="${CSS.escape(working.hexId)}"]`);
      if (row) {
        pendingScroll.value = null;
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        row.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      } else if (++tries < 10) {
        frame = requestAnimationFrame(look);
      } else {
        // Still missing 5 s on: not on this page (a pull request, say). Give up rather than
        // jump to some later change instead.
        giveUp = setTimeout(() => {
          if (pendingScroll.peek() === pending) pendingScroll.value = null;
        }, Math.max(0, working.at + 5000 - Date.now()));
      }
    };
    let giveUp: number | undefined;
    frame = requestAnimationFrame(look);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(giveUp);
    };
  }, [projectId, working?.hexId, working?.at, data]);
}

/**
 * `?hex=<id>` (after creating a hex, say): picks the tab or opens the group that lists it, scrolls
 * to its row and flashes it, then drops the parameter. A hex the page doesn't list opens its own
 * page instead. Returns the hex while it flashes.
 */
function useFocusHex(
  projectId: string,
  view: ProjectView | null,
  onTab: (tab: ProjectTab) => void,
): string | null {
  const wanted = focusFrom(location.value.search);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || !view) return;
    const spot: ProjectSpot | null = spotOf(view, wanted);
    if (!spot) {
      navigate(`/h/${wanted}`, { replace: true });
      return;
    }
    if (spot.in === "tab") onTab(spot.tab);
    setFocus(wanted);
    // Drop the parameter so a reload or going back doesn't do this again.
    history.replaceState(null, "", `/p/${projectId}`);
    location.value = { path: `/p/${projectId}`, search: "" };
  }, [wanted, view, projectId]);
  // The row may only appear once its tab, group or epic has opened, so look for a few frames.
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    let frame = 0;
    const look = () => {
      const row = document.querySelector(`[data-hex-row="${CSS.escape(focus)}"]`);
      if (row) {
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        row.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      } else if (++tries < 10) frame = requestAnimationFrame(look);
    };
    frame = requestAnimationFrame(look);
    const done = setTimeout(() => setFocus(null), 2600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, [focus]);
  return focus;
}

export function ProjectScreen({ id }: { id: string }) {
  const res = useResource(() => api.project(id), [id]);
  const working = useWorking(id);
  const [tab, setTab] = useState<ProjectTab>("ideas");
  const view = res.status === "ready" ? res.data : null;
  useEffect(() => setTab("ideas"), [id]);
  const focus = useFocusHex(id, view, setTab);
  // A hand-off scrolls to the hex Claude changes; if a tab lists it, that tab has to show first.
  const pending = pendingScroll.value;
  const workingSpot = view && working ? spotOf(view, working.hexId) : null;
  useEffect(() => {
    if (pending?.projectId !== id || !working || working.at < pending.since) return;
    if (workingSpot?.in === "tab") setTab(workingSpot.tab);
  }, [pending, working?.hexId, working?.at, workingSpot?.in === "tab" && workingSpot.tab]);
  useHandoffScroll(id, view ? working : null, view);

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

  const { project, ideas, designs, specs, decisions, questions, facts, gates, epics, autoMerge } =
    res.data;
  // Auto-merge has its own switch below.
  const repoPath = project.meta?.repo_path;
  const meta = Object.entries(project.meta ?? {}).filter(([k]) =>
    k !== AUTO_MERGE_KEY && k !== "repo_path" && k !== "schema_version"
  );
  return (
    <Working.Provider value={working}>
      <Focus.Provider value={focus}>
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
              <AutoMergeToggle projectId={id} on={autoMerge} onChange={res.reload} />
            </div>
            <h1 class="m-0 text-[40px] font-bold leading-[1.12] tracking-[-0.02em]">
              {project.title}
            </h1>
            {project.description && (
              <ClampedDescription text={project.description} href={`/h/${project.id}`} />
            )}
            <div class="flex flex-wrap gap-2.5 font-mono text-xs text-muted">
              {repoPath && (
                <span
                  class="rounded-md border border-line px-2.5 py-[5px]"
                  title="The git repository this project works on (meta.repo_path)"
                >
                  repo: {repoPath}
                </span>
              )}
              {meta.map(([k, v]) => (
                <span key={k} class="rounded-md border border-line px-2.5 py-[5px]">{k}: {v}</span>
              ))}
              <span class="rounded-md border border-line px-2.5 py-[5px]">
                updated {relativeTime(project.lastUpdatedAtTimeInMs)}
              </span>
            </div>
          </section>

          <GateStepper gates={gates} />

          <div class="flex flex-col gap-2.5">
            <ProjectTabs
              lists={{ ideas, designs, specs, decisions, questions }}
              tab={tab}
              onTab={setTab}
            />
            <HexGroup label="Facts" items={facts} hideRetired />
          </div>

          <div class="flex flex-col gap-3.5">
            <div class="flex flex-wrap items-baseline justify-between gap-3">
              <h2 class="m-0 text-[22px] font-bold tracking-[-0.01em]">Epics</h2>
              <span class="text-[13px] text-muted">
                Progress counts stories each epic depends on
              </span>
            </div>
            {epics.length === 0 && (
              <p class="m-0 rounded-[14px] border border-dashed border-line-strong p-8 text-center text-muted">
                No epics yet. Use “Create hex” and pick <code class="font-mono">core.epic</code>.
              </p>
            )}
            <EpicList epics={epics} onChange={res.reload} />
          </div>
        </Page>
      </Focus.Provider>
    </Working.Provider>
  );
}
