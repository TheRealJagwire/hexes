import type { DiffFile, DiffHunk } from "./views.ts";

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** `a/src/x.ts` → `src/x.ts`; `/dev/null` → null. */
function stripPrefix(p: string): string | null {
  if (p === "/dev/null") return null;
  return p.replace(/^[ab]\//, "");
}

/**
 * Parses `git diff` output (unified, with `diff --git` headers) into files, hunks and numbered
 * lines. Lines git emits outside that shape (`\ No newline at end of file`, …) are skipped.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let inHeader = false;

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // Until ---/+++ or rename lines say otherwise, take the path from "a/X b/X".
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      file = {
        path: m?.[2] ?? line.slice(11),
        oldPath: null,
        status: "modified",
        additions: 0,
        deletions: 0,
        binary: false,
        hunks: [],
      };
      files.push(file);
      hunk = null;
      inHeader = true;
      continue;
    }
    if (!file) continue;
    if (inHeader) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("rename from ")) {
        file.status = "renamed";
        file.oldPath = line.slice(12);
      } else if (line.startsWith("rename to ")) file.path = line.slice(10);
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
      else if (line.startsWith("--- ")) {
        const old = stripPrefix(line.slice(4));
        if (old === null) file.status = "added";
      } else if (line.startsWith("+++ ")) {
        const now = stripPrefix(line.slice(4));
        if (now === null) file.status = "deleted";
        else file.path = now;
      }
    }
    const h = HUNK_RE.exec(line);
    if (h) {
      inHeader = false;
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) });
      file.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) });
      file.deletions++;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  return files;
}
