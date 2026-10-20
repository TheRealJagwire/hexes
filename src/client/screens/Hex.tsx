import { useState } from "preact/hooks";
import type { Status } from "../../shared/schemas.ts";
import { kindQualifier } from "../../shared/graph.ts";
import type { HexSummary, HexView } from "../../shared/views.ts";
import { api } from "../lib/api.ts";
import { dateTime, PILL, plural, statusOptions } from "../lib/format.ts";
import { Link, navigate } from "../lib/router.tsx";
import { useResource } from "../lib/use-resource.ts";
import { ChevronDown, ChevronRight, Close, Plus } from "../components/Icons.tsx";
import { CopyButton, KindBadge } from "../components/Bits.tsx";
import { Markdown } from "../components/Markdown.tsx";
import {
  Brand,
  ErrorState,
  Header,
  LoadingState,
  Page,
  ThemeToggle,
} from "../components/Layout.tsx";
import { ProjectHeader } from "./Project.tsx";

const STATUS_TEXT: Record<Status, string> = {
  ready: "text-ready",
  blessed: "text-blessed",
  in_progress: "text-accent",
  verified: "text-verified",
  blocked: "text-blocked",
  done: "text-muted",
  answered: "text-muted",
};

/** Project crumbs go to the project screen; everything else to its hex screen. */
function crumbHref(h: HexSummary): string {
  return h.kind === "core.project" ? `/p/${h.id}` : `/h/${h.id}`;
}

function Breadcrumbs({ trail }: { trail: HexSummary[] }) {
  return (
    <nav aria-label="Dependency trail">
      <ol class="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-sm">
        {trail.map((h, i) => {
          const last = i === trail.length - 1;
          const body = (
            <>
              <span class="font-mono text-[11px] text-accent">{kindQualifier(h.kind)}</span>
              {h.title}
            </>
          );
          return (
            <li key={h.id} class="flex items-center gap-1">
              {last
                ? (
                  <span
                    aria-current="page"
                    class="inline-flex min-h-9 items-center gap-2 px-2 text-ink"
                  >
                    {body}
                  </span>
                )
                : (
                  <>
                    <Link
                      href={crumbHref(h)}
                      class="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-muted no-underline hover:text-ink"
                    >
                      {body}
                    </Link>
                    <span class="text-line-hover">
                      <ChevronRight size={14} />
                    </span>
                  </>
                )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function RelatedPanel(
  { id, title, items, footer }: {
    id: string;
    title: string;
    items: HexSummary[];
    footer?: HexSummary[];
  },
) {
  return (
    <section aria-labelledby={id} class="card flex flex-col gap-3 p-[22px]">
      <h2 id={id} class="m-0 text-sm font-semibold text-muted">{title}</h2>
      {items.length === 0 && <span class="font-mono text-xs text-muted">none</span>}
      {items.map((h) => (
        <Link
          key={h.id}
          href={`/h/${h.id}`}
          class="flex flex-col gap-1 rounded-lg border border-line-soft bg-bg px-3.5 py-3 text-ink no-underline hover:border-line-hover"
        >
          <span class="flex justify-between gap-2 font-mono text-xs">
            <span class="text-muted">{h.id} · {kindQualifier(h.kind)}</span>
            <span class={STATUS_TEXT[h.status]}>{h.status}</span>
          </span>
          <span class="text-sm">{h.title}</span>
        </Link>
      ))}
      {footer && footer.length > 0 && (
        <span class="font-mono text-xs text-muted">
          emerged from here: {footer.map((h, i) => (
            <>
              {i > 0 && ", "}
              <Link href={`/h/${h.id}`} class="text-ink-2">{h.id}</Link>
            </>
          ))}
        </span>
      )}
    </section>
  );
}

function MetaPanel({ view, onChange }: { view: HexView; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const [error, setError] = useState<string | null>(null);
  const meta = Object.entries(view.hex.meta ?? {});

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  return (
    <section aria-labelledby="meta-h" class="card flex flex-col gap-4 px-7 py-6">
      <div class="flex items-center justify-between gap-3">
        <h2 id="meta-h" class="m-0 text-[15px] font-semibold tracking-[0.02em] text-muted">Meta</h2>
        <button
          type="button"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
          class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-transparent px-3 text-[13px] text-ink"
        >
          <Plus size={14} width={2.2} /> Add key
        </button>
      </div>
      {adding && (
        <form
          class="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.setMeta(view.hex.id, k.trim(), v))) {
              setK("");
              setV("");
              setAdding(false);
            }
          }}
        >
          <label class="sr-only" for="meta-k">Meta key</label>
          <input
            id="meta-k"
            value={k}
            placeholder="key"
            onInput={(e) => setK(e.currentTarget.value)}
            class="field field-mono h-10 w-auto flex-[2_1_140px]"
          />
          <label class="sr-only" for="meta-v">Meta value</label>
          <input
            id="meta-v"
            value={v}
            placeholder="value"
            onInput={(e) => setV(e.currentTarget.value)}
            class="field field-mono h-10 w-auto flex-[3_1_200px]"
          />
          <button type="submit" disabled={!k.trim()} class="btn-primary h-10">Save</button>
        </form>
      )}
      {error && <span role="alert" class="text-[13px] text-blocked">{error}</span>}
      {meta.length === 0
        ? <span class="font-mono text-[13px] text-muted">No meta keys.</span>
        : (
          <div class="overflow-x-auto">
            <table class="w-full border-collapse font-mono text-[13px]">
              <thead>
                <tr>
                  <th
                    scope="col"
                    class="border-b border-line pb-2.5 pr-3 text-left font-medium text-muted"
                  >
                    key
                  </th>
                  <th
                    scope="col"
                    class="border-b border-line pb-2.5 text-left font-medium text-muted"
                  >
                    value
                  </th>
                  <th scope="col" class="w-10 border-b border-line">
                    <span class="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {meta.map(([key, value]) => (
                  <tr key={key}>
                    <td class="whitespace-nowrap border-b border-line-soft py-2.5 pr-3 align-top text-ink-2">
                      {key}
                    </td>
                    <td class="break-words border-b border-line-soft py-2.5 align-top">{value}</td>
                    <td class="border-b border-line-soft py-1 text-right align-top">
                      <button
                        type="button"
                        aria-label={`Remove ${key}`}
                        onClick={() => run(() => api.removeMeta(view.hex.id, key))}
                        class="inline-flex size-8 items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-ink"
                      >
                        <Close size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

/** Delete… → Continue → Delete forever. */
function DeletePanel({ view }: { view: HexView }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { dependents, emerged, projectHexes } = view.deleteImpact;

  const destroy = async () => {
    setBusy(true);
    try {
      await api.deleteHex(view.hex.id);
      navigate(view.hex.kind === "core.project" || !view.projectId ? "/" : `/p/${view.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const impact = projectHexes !== null
    ? `This deletes the project and all ${projectHexes} hexes in it.`
    : dependents + emerged === 0
    ? "Nothing else references this hex."
    : `${plural(dependents, "hex")} ${
      dependents === 1 ? "depends" : "depend"
    } on this one and ${emerged} emerged from it. Their references will be removed.`;

  return (
    <section
      aria-labelledby="danger-h"
      class="flex flex-col gap-3 rounded-[14px] border border-danger-line p-[22px]"
    >
      <h2 id="danger-h" class="m-0 text-sm font-semibold text-blocked">Delete hex</h2>
      {step === 0 && (
        <>
          <p class="m-0 text-[13px] leading-normal text-muted">
            Removes this hex from data.json. You'll be asked twice.
          </p>
          <button
            type="button"
            onClick={() => setStep(1)}
            class="h-11 rounded-[10px] border border-blocked bg-transparent font-semibold text-blocked"
          >
            Delete…
          </button>
        </>
      )}
      {step === 1 && (
        <>
          <p class="m-0 text-[13px] leading-normal text-ink">{impact}</p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep(0)}
              class="h-11 flex-1 rounded-[10px] border border-line-strong bg-panel2 text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              class="h-11 flex-1 rounded-[10px] border border-blocked bg-transparent font-semibold text-blocked"
            >
              Continue
            </button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <p class="m-0 text-[13px] leading-normal text-ink">
            Last check: permanently delete{" "}
            <code class="font-mono text-blocked">{view.hex.id}</code>?
          </p>
          {error && <span role="alert" class="text-[13px] text-blocked">{error}</span>}
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep(0)}
              class="h-11 flex-1 rounded-[10px] border border-line-strong bg-panel2 text-ink"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={destroy}
              class="h-11 flex-1 rounded-[10px] border-none bg-danger text-[15px] font-semibold text-white"
            >
              {busy ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function StatusSelect({ view, onChange }: { view: HexView; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const status = view.hex.status;
  return (
    <div class="flex flex-col gap-1.5">
      <label for="hex-status" class="text-xs font-medium text-muted">Status</label>
      <div class="relative">
        <select
          id="hex-status"
          value={status}
          onChange={async (e) => {
            setError(null);
            try {
              await api.updateHex(view.hex.id, { status: e.currentTarget.value as Status });
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
            onChange();
          }}
          class={`h-11 min-w-[190px] appearance-none rounded-[10px] border border-line-strong pl-3.5 pr-10 font-mono text-sm ${
            PILL[status]
          }`}
        >
          {statusOptions(view.hex.kind, status).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span class="pointer-events-none absolute right-3.5 top-[15px] text-ink-2">
          <ChevronDown size={14} />
        </span>
      </div>
      {error && <span role="alert" class="max-w-[260px] text-xs text-blocked">{error}</span>}
    </div>
  );
}

export function HexScreen({ id }: { id: string }) {
  const res = useResource(() => api.hex(id), [id]);
  const [editing, setEditing] = useState(false);

  if (res.status !== "ready") {
    return (
      <Page
        header={
          <Header compact>
            <Brand />
            <ThemeToggle />
          </Header>
        }
        top="pt-7"
      >
        {res.status === "loading" ? <LoadingState /> : (
          <ErrorState
            message={res.error}
            action={<Link href="/" class="btn">Back to start</Link>}
          />
        )}
      </Page>
    );
  }

  const view = res.data;
  const { hex } = view;
  const reload = res.reload;
  const createHref = view.projectId ? `/p/${view.projectId}/new?emergedFrom=${hex.id}` : null;

  const header = view.projectId
    ? (
      <ProjectHeader projectId={view.projectId}>
        <Link href={createHref ?? "#"} class="btn-primary">
          <Plus size={16} width={2.4} /> Create hex
        </Link>
      </ProjectHeader>
    )
    : (
      <Header compact>
        <Brand />
        <ThemeToggle />
      </Header>
    );

  return (
    <Page header={header} top="pt-7">
      <Breadcrumbs trail={view.breadcrumbs} />

      <section class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
          <KindBadge kind={hex.kind} />
          <span class="font-mono text-[15px] text-ink-2">{hex.id}</span>
          <CopyButton text={hex.id} />
        </div>
        <div class="flex flex-wrap items-start justify-between gap-6">
          <h1 class="m-0 flex-[1_1_480px] text-[34px] font-bold leading-[1.15] tracking-[-0.02em]">
            {hex.title}
          </h1>
          <StatusSelect view={view} onChange={reload} />
        </div>
        {editing
          ? (
            <EditText
              view={view}
              onDone={() => {
                setEditing(false);
                reload();
              }}
            />
          )
          : (
            <div class="flex flex-col items-start gap-2">
              {hex.description
                ? (
                  <Markdown
                    text={hex.description}
                    class="max-w-[760px] text-base leading-relaxed text-ink-2"
                  />
                )
                : <p class="m-0 text-base text-muted">No description.</p>}
              <button
                type="button"
                onClick={() => setEditing(true)}
                class="text-[13px] text-accent underline-offset-2 hover:underline"
              >
                Edit title &amp; description
              </button>
            </div>
          )}
      </section>

      <div class="flex flex-wrap items-start gap-6">
        <div class="flex min-w-0 flex-[999_1_520px] flex-col gap-6">
          <section aria-labelledby="fields-h" class="card flex flex-col gap-4 px-7 py-6">
            <h2 id="fields-h" class="m-0 text-[15px] font-semibold tracking-[0.02em] text-muted">
              Fields
            </h2>
            <dl class="m-0 grid grid-cols-[minmax(160px,max-content)_minmax(0,1fr)] gap-x-6 gap-y-3 text-sm">
              <dt class="text-muted">kind</dt>
              <dd class="m-0 font-mono">{hex.kind}</dd>
              <dt class="text-muted">createdAtTimeInMs</dt>
              <dd class="m-0 font-mono">
                {hex.createdAtTimeInMs}{" "}
                <span class="text-muted">· {dateTime(hex.createdAtTimeInMs)}</span>
              </dd>
              <dt class="text-muted">lastUpdatedAtTimeInMs</dt>
              <dd class="m-0 font-mono">
                {hex.lastUpdatedAtTimeInMs}{" "}
                <span class="text-muted">· {dateTime(hex.lastUpdatedAtTimeInMs)}</span>
              </dd>
              <dt class="text-muted">emergedFrom</dt>
              <dd class="m-0 font-mono">
                {view.emergedFromHex
                  ? (
                    <Link href={`/h/${view.emergedFromHex.id}`} class="text-ink-2">
                      {view.emergedFromHex.id} · {view.emergedFromHex.title}
                    </Link>
                  )
                  : <span class="text-muted">—</span>}
              </dd>
            </dl>
          </section>
          <MetaPanel view={view} onChange={reload} />
        </div>

        <aside class="flex min-w-0 flex-[1_1_280px] flex-col gap-6">
          <RelatedPanel id="dep-h" title="Depends on" items={view.dependsOn} />
          <RelatedPanel
            id="req-h"
            title="Depended on by"
            items={view.dependedOnBy}
            footer={view.emergedHere}
          />
          <DeletePanel key={hex.id} view={view} />
        </aside>
      </div>
    </Page>
  );
}

function EditText({ view, onDone }: { view: HexView; onDone: () => void }) {
  const [title, setTitle] = useState(view.hex.title);
  const [description, setDescription] = useState(view.hex.description);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      class="flex max-w-[760px] flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.updateHex(view.hex.id, { title, description });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <label class="label" for="edit-title">Title</label>
      <input
        id="edit-title"
        value={title}
        onInput={(e) => setTitle(e.currentTarget.value)}
        class="field"
      />
      <label class="label" for="edit-desc">Description / value</label>
      <textarea
        id="edit-desc"
        rows={5}
        value={description}
        onInput={(e) => setDescription(e.currentTarget.value)}
        class="box-border resize-y rounded-lg border border-line-strong bg-bg px-3.5 py-3 text-[15px] leading-normal text-ink"
      />
      {error && <span role="alert" class="text-[13px] text-blocked">{error}</span>}
      <div class="flex gap-2">
        <button type="button" onClick={onDone} class="btn">Cancel</button>
        <button type="submit" disabled={!title.trim()} class="btn-primary">Save</button>
      </div>
    </form>
  );
}
