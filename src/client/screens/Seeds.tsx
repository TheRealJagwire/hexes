import { useState } from "preact/hooks";
import { SEED_DESCRIPTION_LIMIT } from "../../shared/constants.ts";
import type { SeedView } from "../../shared/views.ts";
import { api } from "../lib/api.ts";
import { Link } from "../lib/router.tsx";
import { notify, notifyError } from "../lib/toasts.ts";
import { useResource } from "../lib/use-resource.ts";
import { StatusPill } from "../components/Bits.tsx";
import { Plus } from "../components/Icons.tsx";
import {
  Brand,
  ErrorState,
  Header,
  LoadingState,
  Page,
  ThemeToggle,
} from "../components/Layout.tsx";

interface Draft {
  title: string;
  description: string;
  gitUrl: string;
  branch: string;
}

const EMPTY: Draft = { title: "", description: "", gitUrl: "", branch: "main" };

/** Add or edit a seed; the description's length warning updates as you type. */
function SeedForm(
  { initial, onSave, onCancel }: {
    initial: Draft;
    onSave: (d: Draft) => Promise<void>;
    onCancel: () => void;
  },
) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const over = d.description.length - SEED_DESCRIPTION_LIMIT;
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(d);
    } catch (err) {
      setError(notifyError(err));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof Draft, label: string, placeholder: string, mono = false) => (
    <div class="flex flex-col gap-2">
      <label for={`seed-${key}`} class="label">{label}</label>
      <input
        id={`seed-${key}`}
        type="text"
        value={d[key]}
        placeholder={placeholder}
        spellcheck={!mono}
        onInput={(e) => setD({ ...d, [key]: e.currentTarget.value })}
        class={`field ${mono ? "field-mono" : ""}`}
      />
    </div>
  );
  return (
    <form onSubmit={save} class="card flex flex-col gap-4 p-6">
      {field("title", "Title", "Deno + Hono + Preact app")}
      <div class="flex flex-col gap-2">
        <label for="seed-description" class="label">Description</label>
        <textarea
          id="seed-description"
          rows={5}
          value={d.description}
          placeholder="About 5 lines: the stack, what works out of the box, what it is a good and a poor fit for."
          onInput={(e) => setD({ ...d, description: e.currentTarget.value })}
          class="box-border resize-y rounded-lg border border-line-strong bg-bg px-3.5 py-3 text-[15px] leading-normal text-ink"
        />
        <span
          role="status"
          class={`font-mono text-xs ${over > 0 ? "text-blocked" : "text-muted"}`}
        >
          {d.description.length}/{SEED_DESCRIPTION_LIMIT}
          {over > 0 ? ` · ${over} over: keep it short enough to judge fit at a glance` : ""}
        </span>
      </div>
      <div class="grid gap-4 sm:grid-cols-[1fr_160px]">
        {field("gitUrl", "Git URL", "git@github.com:me/starter.git or /path/to/repo", true)}
        {field("branch", "Branch", "main", true)}
      </div>
      {error && <span role="alert" class="text-[13px] text-blocked">{error}</span>}
      <div class="flex gap-2">
        <button
          type="submit"
          disabled={busy || !d.title.trim() || !d.gitUrl.trim()}
          class="btn-primary"
        >
          {busy ? "Saving…" : "Save seed"}
        </button>
        <button type="button" class="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function SeedCard(
  { seed, onEdit, onChange }: { seed: SeedView; onEdit: () => void; onChange: () => void },
) {
  const retired = seed.hex.status === "retired";
  const toggle = async () => {
    try {
      await (retired ? api.restoreSeed(seed.hex.id) : api.retireSeed(seed.hex.id));
      notify(`${retired ? "Restored" : "Retired"} ${seed.hex.title}`);
      onChange();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <li class={`card flex flex-col gap-2 px-6 py-5 ${retired ? "opacity-70" : ""}`}>
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-lg font-semibold">{seed.hex.title}</span>
        <StatusPill status={seed.hex.status} />
        <span class="font-mono text-xs text-muted">{seed.hex.id}</span>
        <div class="ml-auto flex gap-2">
          {!retired && <button type="button" class="btn text-sm" onClick={onEdit}>Edit</button>}
          <button type="button" class="btn text-sm" onClick={() => void toggle()}>
            {retired ? "Restore" : "Retire"}
          </button>
        </div>
      </div>
      <span class="font-mono text-[13px] text-ink-2">
        {seed.gitUrl} · {seed.branch}
      </span>
      {seed.hex.description && (
        <p class="m-0 whitespace-pre-line text-[15px] leading-normal text-muted">
          {seed.hex.description}
        </p>
      )}
      {seed.warnings.map((w) => <span key={w} class="text-[13px] text-blocked">⚠ {w}</span>)}
    </li>
  );
}

/** `/seeds`: the repository seeds every project can be forked from. */
export function Seeds() {
  const [showRetired, setShowRetired] = useState(false);
  const seeds = useResource(() => api.seeds(showRetired), [showRetired]);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const header = (
    <Header>
      <Brand />
      <div class="flex items-center gap-2.5">
        <ThemeToggle />
        <span class="font-mono text-[13px] text-muted">~/.hx/seeds/data.json</span>
      </div>
    </Header>
  );
  const reload = () => seeds.status === "ready" && seeds.reload();
  const toDraft = (s: SeedView): Draft => ({
    title: s.hex.title,
    description: s.hex.description,
    gitUrl: s.gitUrl,
    branch: s.branch,
  });

  return (
    <Page header={header} width={960} top="pt-14">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-col gap-2">
          <h1 class="m-0 text-[32px] font-bold tracking-[-0.02em]">Repository seeds</h1>
          <p class="m-0 max-w-[640px] text-[15px] text-muted">
            Repositories any project can be forked from. Keep each description short: enough for
            you, or an agent, to tell whether it fits a project.
          </p>
        </div>
        <div class="flex gap-2">
          <Link href="/projects" class="btn text-sm">All projects</Link>
          <button type="button" class="btn-primary text-sm" onClick={() => setEditing("new")}>
            <Plus /> New seed
          </button>
        </div>
      </div>

      {editing === "new" && (
        <SeedForm
          initial={EMPTY}
          onCancel={() => setEditing(null)}
          onSave={async (d) => {
            const made = await api.createSeed(d);
            notify(`Added ${made.hex.title}`);
            setEditing(null);
            reload();
          }}
        />
      )}

      <label class="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={showRetired}
          onChange={(e) => setShowRetired(e.currentTarget.checked)}
          class="size-4 accent-accent"
        />
        Show retired seeds
      </label>

      {seeds.status === "loading" && <LoadingState />}
      {seeds.status === "error" && <ErrorState message={seeds.error} />}
      {seeds.status === "ready" && seeds.data.length === 0 && (
        <p class="m-0 rounded-[14px] border border-dashed border-line-strong p-8 text-center text-muted">
          No seeds yet. Add a repository you'd like new projects to start from.
        </p>
      )}
      {seeds.status === "ready" && (
        <ul class="m-0 flex list-none flex-col gap-3 p-0">
          {seeds.data.map((s) =>
            editing === s.hex.id
              ? (
                <li key={s.hex.id}>
                  <SeedForm
                    initial={toDraft(s)}
                    onCancel={() => setEditing(null)}
                    onSave={async (d) => {
                      await api.updateSeed(s.hex.id, d);
                      notify(`Saved ${d.title}`);
                      setEditing(null);
                      reload();
                    }}
                  />
                </li>
              )
              : (
                <SeedCard
                  key={s.hex.id}
                  seed={s}
                  onEdit={() => setEditing(s.hex.id)}
                  onChange={reload}
                />
              )
          )}
        </ul>
      )}
    </Page>
  );
}
