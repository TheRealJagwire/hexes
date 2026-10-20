import { allowedStatuses, REQUIRES_RESPONSE, type Status } from "../../shared/constants.ts";

/** Full class strings so Tailwind can see them. */
export const PILL: Record<Status, string> = {
  ready: "text-ready bg-ready-bg",
  blessed: "text-blessed bg-blessed-bg",
  in_progress: "text-accent bg-accent-bg",
  verified: "text-verified bg-verified-bg",
  blocked: "text-blocked bg-blocked-bg",
  done: "text-muted bg-line-soft",
  answered: "text-muted bg-line-soft",
};

/**
 * The statuses a person can pick for a hex of `kind`. `current` stays listed even when the kind
 * no longer allows it (data from before a workflow changed), so the picker can show it.
 */
export function statusOptions(kind: string, current?: Status): readonly Status[] {
  const allowed = allowedStatuses(kind);
  return current && !allowed.includes(current) ? [current, ...allowed] : allowed;
}

/** Statuses a new hex can start in: those that need a response are set after creating it. */
export function createStatusOptions(kind: string): readonly Status[] {
  return allowedStatuses(kind).filter((s) => !REQUIRES_RESPONSE.includes(s));
}

export function relativeTime(ms: number, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - ms) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function plural(n: number, word: string): string {
  if (n === 1) return `1 ${word}`;
  if (word.endsWith("y")) return `${n} ${word.slice(0, -1)}ies`;
  return `${n} ${/[xs]$/.test(word) ? word + "es" : word + "s"}`;
}
