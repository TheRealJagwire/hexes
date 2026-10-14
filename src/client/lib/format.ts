import type { Status } from "../../shared/schemas.ts";

/** Full class strings so Tailwind can see them. */
export const PILL: Record<Status, string> = {
  ready: "text-ready bg-ready-bg",
  in_progress: "text-accent bg-accent-bg",
  verified: "text-verified bg-verified-bg",
  blocked: "text-blocked bg-blocked-bg",
  done: "text-muted bg-line-soft",
};

export const STATUS_OPTIONS: readonly Status[] = [
  "ready",
  "in_progress",
  "verified",
  "blocked",
  "done",
];

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
  return `${n} ${word.endsWith("y") ? word.slice(0, -1) + "ies" : word + "s"}`;
}
