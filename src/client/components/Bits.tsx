import { useState } from "preact/hooks";
import type { Status } from "../../shared/schemas.ts";
import { PILL } from "../lib/format.ts";
import { Check, Copy } from "./Icons.tsx";

export function StatusPill({ status }: { status: Status }) {
  return (
    <span class={`rounded-full px-2.5 py-[3px] font-mono text-xs ${PILL[status]}`}>{status}</span>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <span class="rounded-full bg-accent-bg px-2.5 py-1 font-mono text-xs text-accent">{kind}</span>
  );
}

export function CopyButton({ text, label = "Copy hex id" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable (insecure context): nothing to do */ }
      }}
      class="inline-flex size-8 items-center justify-center rounded-md border border-line-strong bg-transparent text-muted"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function ProgressRing({ done, total, pct }: { done: number; total: number; pct: number }) {
  const c = 113.1;
  const color = pct === 100 ? "var(--success)" : "var(--accent)";
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      role="img"
      aria-label={`${pct} percent, ${done} of ${total} stories done`}
    >
      <circle cx="24" cy="24" r="18" fill="none" stroke="var(--line)" stroke-width="5" />
      <circle
        cx="24"
        cy="24"
        r="18"
        fill="none"
        stroke={color}
        stroke-width="5"
        stroke-linecap="round"
        stroke-dasharray={`${total === 0 ? 0 : ((c * done) / total).toFixed(1)} ${c}`}
        transform="rotate(-90 24 24)"
      />
    </svg>
  );
}
