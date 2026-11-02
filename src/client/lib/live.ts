import { signal } from "@preact/signals";
import type { AgentCall, ChannelsState } from "../../shared/views.ts";

export type LiveStatus = "connecting" | "live" | "reconnecting";

/** Bumps whenever the server says the hexes on disk changed, or after a reconnect. */
export const liveVersion = signal(0);
export const liveStatus = signal<LiveStatus>("connecting");
/** The channels listening now, from the latest `channel` event (null until one arrives). */
export const channelState = signal<ChannelsState | null>(null);
/** The latest MCP tool call an agent made, from the `agent` event. */
export const agentCall = signal<AgentCall | null>(null);

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
  source.addEventListener("channel", (e) => {
    channelState.value = JSON.parse((e as MessageEvent<string>).data) as ChannelsState;
  });
  source.addEventListener("agent", (e) => {
    agentCall.value = JSON.parse((e as MessageEvent<string>).data) as AgentCall;
  });
  source.onerror = () => {
    liveStatus.value = opened ? "reconnecting" : "connecting";
  };
}
