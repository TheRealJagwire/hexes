import { useState } from "preact/hooks";
import { CORE_KINDS, type Status } from "../../shared/constants.ts";
import { kindQualifier, prefixOf } from "../../shared/graph.ts";
import type { HexSummary } from "../../shared/views.ts";
import { api } from "../lib/api.ts";
import { STATUS_OPTIONS } from "../lib/format.ts";
import { Link, navigate } from "../lib/router.tsx";
import { useResource } from "../lib/use-resource.ts";
import { Close, Minus, Plus } from "../components/Icons.tsx";
import { ErrorState, LoadingState, ThemeToggle } from "../components/Layout.tsx";

/** Project hexes can be created here; projects themselves come from the welcome screen. */
const KINDS = CORE_KINDS.filter((k) => k !== "project").map((k) => `core.${k}`);
const CREATE_STATUSES: Status[] = ["blocked", ...STATUS_OPTIONS.filter((s) => s !== "blocked")];

/** Search-and-chip multi-select over the project's hexes. */
function HexPicker(
  { id, label, hint, placeholder, options, value, onChange }: {
    id: string;
    label: string;
    hint: string;
    placeholder: string;
    options: HexSummary[];
    value: HexSummary[];
    onChange: (next: HexSummary[]) => void;
  },
) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const taken = new Set(value.map((v) => v.id));
  const matches = needle
    ? options.filter((o) =>
      !taken.has(o.id) && (o.id.includes(needle) || o.title.toLowerCase().includes(needle))
    ).slice(0, 8)
    : [];
  return (
    <div class="relative flex flex-col gap-2">
      <label for={id} class="label">
        {label} <span class="font-normal text-muted">· {hint}</span>
      </label>
      <div class="box-border flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-bg px-2 py-1.5">
        {value.map((v) => (
          <span
            key={v.id}
            class="inline-flex h-[30px] items-center gap-1.5 rounded-md border border-line-strong bg-panel2 pl-2.5 pr-1 font-mono text-xs"
          >
            {kindQualifier(v.kind)} · {v.id} {v.title}
            <button
              type="button"
              aria-label={`Remove ${v.id}`}
              onClick={() => onChange(value.filter((x) => x.id !== v.id))}
              class="inline-flex size-[22px] items-center justify-center border-none bg-transparent text-muted"
            >
              <Close size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={query}
          placeholder={placeholder}
          autocomplete="off"
          onInput={(e) => setQuery(e.currentTarget.value)}
          class="h-[30px] min-w-[120px] flex-1 border-none bg-transparent text-sm text-ink outline-none"
        />
      </div>
      {matches.length > 0 && (
        <ul class="absolute inset-x-0 top-full z-10 m-0 mt-1 flex max-h-64 list-none flex-col overflow-y-auto rounded-lg border border-line-strong bg-panel p-1 shadow-lg">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...value, m]);
                  setQuery("");
                }}
                class="flex w-full flex-col items-start gap-0.5 rounded-md border-none bg-transparent px-3 py-2 text-left text-ink hover:bg-panel2"
              >
                <span class="font-mono text-xs text-muted">
                  {m.id} · {kindQualifier(m.kind)} · {m.status}
                </span>
                <span class="text-sm">{m.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CreateHex(
  { projectId, emergedFrom }: { projectId: string; emergedFrom: string | null },
) {
  const project = useResource(() => api.hex(projectId), [projectId]);
  const hexes = useResource(() => api.projectHexes(projectId), [projectId]);

  const [kind, setKind] = useState("core.story");
  const [customKind, setCustomKind] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("blocked");
  const [emerged, setEmerged] = useState(emergedFrom ?? "");
  const [requiredBy, setRequiredBy] = useState<HexSummary[]>([]);
  const [dependsOn, setDependsOn] = useState<HexSummary[]>([]);
  const [meta, setMeta] = useState<{ k: string; v: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = emergedFrom ? `/h/${emergedFrom}` : `/p/${projectId}`;
  const effectiveKind = customKind.trim() || kind;
  const canSubmit = title.trim() !== "" && effectiveKind !== "" && !busy;
  const prefix = prefixOf(projectId) ?? "…";

  if (project.status === "loading" || hexes.status === "loading") return <LoadingState />;
  if (project.status === "error") {
    return (
      <ErrorState
        message={project.error}
        action={<Link href="/projects" class="btn">All projects</Link>}
      />
    );
  }
  if (hexes.status === "error") return <ErrorState message={hexes.error} />;
  const options = hexes.data;

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const metaMap: Record<string, string> = {};
      for (const { k, v } of meta) if (k.trim()) metaMap[k.trim()] = v;
      const hex = await api.createHex({
        projectId,
        kind: effectiveKind,
        title,
        description,
        status,
        ...(emerged ? { emergedFrom: emerged } : {}),
        requiredBy: requiredBy.map((h) => h.id),
        dependsOn: dependsOn.map((h) => h.id),
        meta: metaMap,
      });
      navigate(`/h/${hex.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div class="box-border flex min-h-screen justify-center bg-backdrop px-5 py-12 text-ink">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-h"
        class="flex w-full max-w-[760px] flex-col self-start rounded-[18px] border border-line bg-panel"
      >
        <div class="flex items-center justify-between gap-3 border-b border-line px-7 py-[22px]">
          <div class="flex flex-col gap-1">
            <h1 id="create-h" class="m-0 text-[22px] font-bold tracking-[-0.01em]">Create hex</h1>
            <span class="font-mono text-xs text-muted">
              in {project.data.hex.title} · {projectId}
            </span>
          </div>
          <div class="flex items-center gap-2.5">
            <ThemeToggle />
            <Link
              href={back}
              aria-label="Close"
              class="inline-flex size-11 items-center justify-center rounded-[10px] text-muted"
            >
              <Close size={18} />
            </Link>
          </div>
        </div>

        <form onSubmit={submit}>
          <div class="flex flex-col gap-[22px] px-7 py-6">
            <fieldset class="m-0 flex flex-col gap-2.5 border-none p-0">
              <legend class="label pb-2.5">Kind</legend>
              <div class="flex flex-wrap gap-2">
                {KINDS.map((k) => {
                  const on = !customKind.trim() && k === kind;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setKind(k);
                        setCustomKind("");
                      }}
                      class={`h-10 rounded-full border px-3.5 font-mono text-[13px] ${
                        on
                          ? "border-accent bg-accent font-semibold text-on-accent"
                          : "border-line-strong bg-bg text-ink-2"
                      }`}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
              <div class="flex items-center gap-2 text-[13px] text-muted">
                <label for="custom-kind">or a custom kind</label>
                <input
                  id="custom-kind"
                  type="text"
                  value={customKind}
                  placeholder="studio.selected_project"
                  onInput={(e) => setCustomKind(e.currentTarget.value)}
                  class="field field-mono h-9 flex-1 px-3 text-[13px]"
                />
              </div>
            </fieldset>

            <div class="flex flex-col gap-2">
              <label for="hx-title" class="label">Title</label>
              <input
                id="hx-title"
                type="text"
                value={title}
                required
                onInput={(e) => setTitle(e.currentTarget.value)}
                class="field h-[46px] text-base"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label for="hx-desc" class="label">Description / value</label>
              <textarea
                id="hx-desc"
                rows={4}
                value={description}
                placeholder="Detail on how to do the thing, a value being tracked, or other stored state."
                onInput={(e) => setDescription(e.currentTarget.value)}
                class="box-border resize-y rounded-lg border border-line-strong bg-bg px-3.5 py-3 text-[15px] leading-normal text-ink"
              />
            </div>

            <div class="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
              <div class="flex flex-col gap-2">
                <label for="hx-status" class="label">Status</label>
                <select
                  id="hx-status"
                  value={status}
                  onChange={(e) => setStatus(e.currentTarget.value as Status)}
                  class="field field-mono"
                >
                  {CREATE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div class="flex flex-col gap-2">
                <label for="hx-emerged" class="label">
                  Emerged from <span class="font-normal text-muted">optional</span>
                </label>
                <select
                  id="hx-emerged"
                  value={emerged}
                  onChange={(e) => setEmerged(e.currentTarget.value)}
                  class="field field-mono"
                >
                  <option value="">—</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.id} · {o.title.slice(0, 40)}</option>
                  ))}
                </select>
              </div>
            </div>

            <HexPicker
              id="hx-req"
              label="Required by"
              hint="these hexes will depend on this one"
              placeholder="Search hexes"
              options={options}
              value={requiredBy}
              onChange={setRequiredBy}
            />
            <HexPicker
              id="hx-dep"
              label="Depends on"
              hint="must be done before this is ready"
              placeholder="Search substories, specs…"
              options={options}
              value={dependsOn}
              onChange={setDependsOn}
            />

            <fieldset class="m-0 flex flex-col gap-2 border-none p-0">
              <legend class="label pb-2">Meta</legend>
              {meta.map((row, i) => (
                <div key={i} class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_44px] gap-2">
                  <label for={`mk${i}`} class="sr-only">Meta key {i + 1}</label>
                  <input
                    id={`mk${i}`}
                    type="text"
                    value={row.k}
                    placeholder="key"
                    onInput={(e) =>
                      setMeta(meta.map((r, j) =>
                        j === i ? { ...r, k: e.currentTarget.value } : r
                      ))}
                    class="field field-mono h-10 px-3 text-[13px]"
                  />
                  <label for={`mv${i}`} class="sr-only">Meta value {i + 1}</label>
                  <input
                    id={`mv${i}`}
                    type="text"
                    value={row.v}
                    placeholder="value"
                    onInput={(e) =>
                      setMeta(meta.map((r, j) => j === i ? { ...r, v: e.currentTarget.value } : r))}
                    class="field field-mono h-10 px-3 text-[13px]"
                  />
                  <button
                    type="button"
                    aria-label="Remove meta row"
                    onClick={() => setMeta(meta.filter((_, j) => j !== i))}
                    class="inline-flex h-10 items-center justify-center rounded-lg border border-line-strong bg-transparent text-muted"
                  >
                    <Minus size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setMeta([...meta, { k: "", v: "" }])}
                class="inline-flex h-9 items-center gap-1.5 self-start rounded-lg border border-dashed border-line-hover bg-transparent px-3 text-[13px] text-ink-2"
              >
                <Plus size={14} width={2.2} /> Add meta
              </button>
            </fieldset>
            {error && (
              <div
                role="alert"
                class="rounded-lg border border-danger-line p-3 text-sm text-blocked"
              >
                {error}
              </div>
            )}
          </div>

          <div class="flex flex-wrap items-center justify-between gap-4 border-t border-line px-7 py-[18px]">
            <span class="font-mono text-xs text-muted">
              id is hashed on save from title · kind · createdAt →
              hx-{prefix}-<span class="text-ink">???</span>
            </span>
            <div class="flex gap-2.5">
              <Link href={back} class="btn">Cancel</Link>
              <button type="submit" disabled={!canSubmit} class="btn-primary px-5">
                {busy ? "Creating…" : `Create ${kindQualifier(effectiveKind)}`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
