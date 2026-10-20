import { useState } from "preact/hooks";
import type { DiffFile, HexView, PullRequestDiff } from "../../shared/views.ts";
import { api } from "../lib/api.ts";
import { dateTime, plural } from "../lib/format.ts";
import { Link } from "../lib/router.tsx";
import { useResource } from "../lib/use-resource.ts";
import { StatusPill } from "../components/Bits.tsx";
import {
  Brand,
  ErrorState,
  Header,
  LoadingState,
  Page,
  ThemeToggle,
} from "../components/Layout.tsx";
import { ProjectHeader } from "./Project.tsx";

const short = (sha: string | null | undefined) => sha?.slice(0, 7) ?? "";

/** Runs a git action, keeping its error for display and reporting whether it worked. */
function useAction(onChange: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** On a work hex: its branch, its pull requests, and the actions that move it along. */
export function WorkPanel({ view, onChange }: { view: HexView; onChange: () => void }) {
  const { busy, error, run } = useAction(onChange);
  const id = view.hex.id;
  const open = view.pullRequests.find((p) => p.status === "pull_requested");
  return (
    <section aria-labelledby="work-h" class="card flex flex-col gap-4 px-7 py-6">
      <h2 id="work-h" class="m-0 text-[15px] font-semibold tracking-[0.02em] text-muted">
        Branch &amp; pull requests
      </h2>
      {view.workBranch
        ? (
          <p class="m-0 text-sm text-ink-2">
            Work happens on <code class="break-all font-mono text-ink">{view.workBranch}</code>.
          </p>
        )
        : (
          <p class="m-0 text-sm text-muted">
            Not started. Starting work creates a branch off main and switches to it.
          </p>
        )}
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class={view.workBranch ? "btn" : "btn-primary"}
          disabled={busy}
          onClick={() => run(() => api.startWork(id))}
        >
          {view.workBranch ? "Switch to branch" : "Start work on a branch"}
        </button>
        {view.workBranch && !open && (
          <button
            type="button"
            class="btn-primary"
            disabled={busy}
            onClick={() => run(() => api.openPullRequest(id))}
          >
            Open pull request
          </button>
        )}
      </div>
      {error && <span role="alert" class="text-[13px] text-blocked">{error}</span>}
      {view.pullRequests.length > 0 && (
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          {view.pullRequests.map((pr) => (
            <li
              key={pr.id}
              class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line-soft bg-bg px-3.5 py-3"
            >
              <StatusPill status={pr.status} />
              <Link href={`/h/${pr.id}`} class="text-sm text-ink">{pr.title}</Link>
              <span class="font-mono text-xs text-muted">
                {pr.sourceBranch} → {pr.targetBranch}
                {pr.mergeSha && <>· {short(pr.mergeSha)}</>}
              </span>
              {pr.status !== "closed" && (
                <Link
                  href={`/h/${id}/diff/${pr.id}`}
                  class="ml-auto text-[13px] text-accent underline-offset-2 hover:underline"
                >
                  {pr.status === "merged" ? "View merged changes" : "View changes"}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** On a pull-request hex: what it merges, and merging or closing it (each asks once more). */
export function PullRequestPanel({ view, onChange }: { view: HexView; onChange: () => void }) {
  const { busy, error, run } = useAction(onChange);
  const [confirm, setConfirm] = useState<"merge" | "close" | null>(null);
  const pr = view.hex;
  const m = pr.meta ?? {};
  const work = view.workHex;
  return (
    <section aria-labelledby="pr-h" class="card flex flex-col gap-4 px-7 py-6">
      <h2 id="pr-h" class="m-0 text-[15px] font-semibold tracking-[0.02em] text-muted">
        Pull request
      </h2>
      <dl class="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        <dt class="text-muted">work</dt>
        <dd class="m-0">
          {work
            ? <Link href={`/h/${work.id}`} class="text-ink-2">{work.id} · {work.title}</Link>
            : <span class="text-muted">—</span>}
        </dd>
        <dt class="text-muted">merges</dt>
        <dd class="m-0 break-all font-mono">{m.source_branch} → {m.target_branch}</dd>
        <dt class="text-muted">commits</dt>
        <dd class="m-0 font-mono">
          {short(m.base_sha)}..{short(m.head_sha)}
          {m.merge_sha && <>· merged as {short(m.merge_sha)}</>}
        </dd>
        {m.merged_at && (
          <>
            <dt class="text-muted">merged</dt>
            <dd class="m-0">{dateTime(Date.parse(m.merged_at))}</dd>
          </>
        )}
      </dl>
      {pr.status === "pull_requested" && confirm === null && (
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary" onClick={() => setConfirm("merge")}>
            Merge into {m.target_branch}…
          </button>
          <button type="button" class="btn" onClick={() => setConfirm("close")}>
            Close without merging…
          </button>
        </div>
      )}
      {confirm && (
        <div class="flex flex-col gap-3 rounded-lg border border-line-strong p-4">
          <p class="m-0 text-[13px] leading-normal text-ink">
            {confirm === "merge"
              ? `Merge ${m.source_branch} into ${m.target_branch} with a merge commit. This switches the working tree to ${m.target_branch}.`
              : "Close this pull request? It is kept as a record, and the branch stays."}
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              class="btn-primary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  (confirm === "merge" ? api.mergePullRequest : api.closePullRequest)(pr.id)
                ).then(() => setConfirm(null))}
            >
              {busy ? "Working…" : confirm === "merge" ? "Merge" : "Close"}
            </button>
          </div>
        </div>
      )}
      {error && <span role="alert" class="text-[13px] text-blocked">{error}</span>}
      {work && pr.status !== "closed" && (
        <Link
          href={`/h/${work.id}/diff/${pr.id}`}
          class="text-[13px] text-accent underline-offset-2 hover:underline"
        >
          {pr.status === "merged" ? "View merged changes" : "View changes"}
        </Link>
      )}
    </section>
  );
}

const LINE_BG = { add: "bg-diff-add-bg", del: "bg-diff-del-bg", context: "" } as const;
const LINE_MARK = { add: "+", del: "−", context: " " } as const;

function FileDiff({ file, truncated }: { file: DiffFile; truncated: boolean }) {
  const label = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  return (
    <details open={file.hunks.length > 0 && file.hunks.length < 40} class="card min-w-0">
      <summary class="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 font-mono text-[13px]">
        <span class="min-w-0 break-all text-ink">{label}</span>
        <span class="text-muted">{file.status}</span>
        <span class="ml-auto whitespace-nowrap">
          <span class="text-success">+{file.additions}</span>{" "}
          <span class="text-blocked">−{file.deletions}</span>
        </span>
      </summary>
      {file.binary
        ? <p class="m-0 border-t border-line px-5 py-3 text-sm text-muted">Binary file changed.</p>
        : file.hunks.length === 0
        ? (
          <p class="m-0 border-t border-line px-5 py-3 text-sm text-muted">
            {truncated
              ? "Too large to show line by line."
              : "No line changes (mode or rename only)."}
          </p>
        )
        : (
          // Long lines scroll inside the file, never the page.
          <div class="overflow-x-auto border-t border-line">
            <table class="w-full border-collapse font-mono text-[12.5px] leading-[1.55]">
              {file.hunks.map((h, i) => (
                <tbody key={i}>
                  <tr>
                    <td colSpan={4} class="bg-panel2 px-3 py-1 text-muted">{h.header}</td>
                  </tr>
                  {h.lines.map((l, j) => (
                    <tr key={j} class={LINE_BG[l.kind]}>
                      <td class="w-px select-none whitespace-nowrap px-2 text-right text-muted">
                        {l.oldNo ?? ""}
                      </td>
                      <td class="w-px select-none whitespace-nowrap px-2 text-right text-muted">
                        {l.newNo ?? ""}
                      </td>
                      <td class="w-px select-none px-1 text-muted" aria-hidden="true">
                        {LINE_MARK[l.kind]}
                      </td>
                      <td class="whitespace-pre pr-4 text-ink">
                        <span class="sr-only">
                          {l.kind === "add" ? "added: " : l.kind === "del" ? "removed: " : ""}
                        </span>
                        {l.text}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
    </details>
  );
}

function DiffBody({ diff }: { diff: PullRequestDiff }) {
  const adds = diff.files.reduce((n, f) => n + f.additions, 0);
  const dels = diff.files.reduce((n, f) => n + f.deletions, 0);
  return (
    <div class="flex flex-col gap-3">
      <p class="m-0 text-sm text-muted">
        {plural(diff.files.length, "file")} changed · <span class="text-success">+{adds}</span>{" "}
        <span class="text-blocked">−{dels}</span>
        {diff.source === "snapshot" &&
          " · from the copy saved at merge time (the commits are gone)"}
        {diff.truncated && " · too large to show line by line"}
      </p>
      {diff.files.length === 0 && <p class="m-0 text-sm text-muted">No changes.</p>}
      {diff.files.map((f) => <FileDiff key={f.path} file={f} truncated={diff.truncated} />)}
    </div>
  );
}

/** `/h/:workId/diff/:prId`: a pull request's changes, viewed from inside its work hex. */
export function DiffScreen({ workId, prId }: { workId: string; prId: string }) {
  const work = useResource(() => api.hex(workId), [workId]);
  const pr = useResource(() => api.hex(prId), [prId]);
  const diff = useResource(() => api.pullRequestDiff(prId), [prId]);
  const header = work.status === "ready" && work.data.projectId
    ? <ProjectHeader projectId={work.data.projectId} />
    : (
      <Header compact>
        <Brand />
        <ThemeToggle />
      </Header>
    );
  const failed = [work, pr, diff].find((r) => r.status === "error");
  return (
    <Page header={header} top="pt-7">
      {failed?.status === "error"
        ? (
          <ErrorState
            message={failed.error}
            action={<Link href={`/h/${workId}`} class="btn">Back to the hex</Link>}
          />
        )
        : work.status !== "ready" || pr.status !== "ready" || diff.status !== "ready"
        ? <LoadingState />
        : (
          <>
            <nav aria-label="Back">
              <Link href={`/h/${workId}`} class="text-sm text-muted no-underline hover:text-ink">
                ← {work.data.hex.title}
              </Link>
            </nav>
            <section class="flex flex-col gap-3">
              <div class="flex flex-wrap items-center gap-3">
                <StatusPill status={pr.data.hex.status} />
                <Link href={`/h/${prId}`} class="font-mono text-[15px] text-ink-2">{prId}</Link>
              </div>
              <h1 class="m-0 text-[28px] font-bold leading-[1.2] tracking-[-0.02em]">
                {pr.data.hex.title}
              </h1>
              <p class="m-0 break-all font-mono text-sm text-muted">
                {pr.data.hex.meta?.source_branch} → {pr.data.hex.meta?.target_branch}
                {pr.data.hex.meta?.merge_sha && ` · merged as ${short(pr.data.hex.meta.merge_sha)}`}
              </p>
            </section>
            <DiffBody diff={diff.data} />
          </>
        )}
    </Page>
  );
}
