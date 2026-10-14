import { signal } from "@preact/signals";

export type LiveStatus = "connecting" | "live" | "reconnecting";

/** Bumps whenever the server says the hexes on disk changed, or after a reconnect. */
export const liveVersion = signal(0);
export const liveStatus = signal<LiveStatus>("connecting");

let started = false;

/** Opens the one shared event stream. EventSource reconnects by itself. */
export function startLive(): void {
  if (started || typeof EventSource === "undefined") return;
  started = true;
  let opened = false;
  const source = new EventSource("/api/events");
  source.addEventListener("hello", () => {
    liveStatus.value = "live";
    // Changes may have been missed while disconnected, so refetch after a reconnect.
    if (opened) liveVersion.value++;
    opened = true;
  });
  source.addEventListener("change", () => {
    liveVersion.value++;
  });
  source.onerror = () => {
    liveStatus.value = opened ? "reconnecting" : "connecting";
  };
}
