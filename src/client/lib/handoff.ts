import { effect, signal } from "@preact/signals";
import type { Status } from "../../shared/constants.ts";
import type { AgentCall, ChannelsState } from "../../shared/views.ts";
import { api } from "./api.ts";
import { agentCall, channelState } from "./live.ts";
import { type ToastKind, toasts } from "./toasts.ts";

/**
 * Set by a hand-off, for the project page: scroll to the first hex Claude changes after `since`.
 * Cleared once it has scrolled, or when the person scrolls or types.
 */
export const pendingScroll = signal<{ projectId: string; since: number } | null>(null);

/** How long to wait for the send and for Claude to pick it up before saying so. */
export const PICKUP_MS = 60_000;

/** The statuses only a person sets that `hexes-channel` tells Claude about. */
export const HANDOFF_STATUSES: readonly Status[] = ["published", "blessed", "answered"];

export type HandoffStep = "telling" | "sent" | "picked" | "nobody" | "unsent" | "unanswered";

export interface HandoffState {
  hexId: string;
  /** "Published", "Blessed", "Answered". */
  verb: string;
  step: HandoffStep;
  /** The latest send for this hex before the action, so an older one isn't taken for it. */
  baseline: number;
  sentAt: number | null;
  /** The latest agent call seen, in case it is seen before the send is. */
  lastCallAt: number;
}

const latestSend = (hexId: string, state: ChannelsState) =>
  Math.max(
    0,
    ...state.channels.flatMap((c) => c.sent.filter((s) => s.hexId === hexId).map((s) => s.at)),
  );

const done = (s: HandoffState) => s.step !== "telling" && s.step !== "sent";

/** Right after the action: nobody listening, or telling Claude. */
export function startHandoff(hexId: string, verb: string, channels: ChannelsState): HandoffState {
  return {
    hexId,
    verb,
    step: channels.channels.length === 0 ? "nobody" : "telling",
    baseline: latestSend(hexId, channels),
    sentAt: null,
    lastCallAt: 0,
  };
}

export function onChannels(s: HandoffState, channels: ChannelsState): HandoffState {
  if (s.step !== "telling") return s;
  const at = latestSend(s.hexId, channels);
  if (at <= s.baseline) return s;
  return { ...s, sentAt: at, step: s.lastCallAt > at ? "picked" : "sent" };
}

export function onAgent(s: HandoffState, call: AgentCall): HandoffState {
  if (done(s)) return s;
  const next = { ...s, lastCallAt: Math.max(s.lastCallAt, call.at) };
  return s.step === "sent" && s.sentAt !== null && call.at > s.sentAt
    ? { ...next, step: "picked" }
    : next;
}

export function onTimeout(s: HandoffState): HandoffState {
  if (s.step === "telling") return { ...s, step: "unsent" };
  if (s.step === "sent") return { ...s, step: "unanswered" };
  return s;
}

/** What the hand-off toast says at each step; a null ttl keeps it up until the next step. */
export function handoffToast(
  s: HandoffState,
): { text: string; kind: ToastKind; ttl: number | null } {
  const did = `${s.verb} ${s.hexId}`;
  switch (s.step) {
    case "telling":
      return { text: `${did} · Telling Claude…`, kind: "info", ttl: null };
    case "sent":
      return { text: `${did} · Sent to Claude`, kind: "info", ttl: null };
    case "picked":
      return { text: `${did} · Claude picked it up`, kind: "success", ttl: 4000 };
    case "nobody":
      return {
        text: `${did}. No Claude session is listening — start one with the hexes channel.`,
        kind: "info",
        ttl: 8000,
      };
    case "unsent":
      return { text: `${did}. The channel hasn't sent it to Claude yet.`, kind: "info", ttl: 8000 };
    case "unanswered":
      return { text: `${did} · Sent. Claude hasn't picked it up yet.`, kind: "info", ttl: 8000 };
  }
}

/**
 * Follows what a person just did through the channel to Claude, in one toast that changes in
 * place: from the `channel` and `agent` events, with a 60 s limit.
 */
export async function followHandoff(
  hexId: string,
  verb: string,
  projectId: string,
): Promise<void> {
  pendingScroll.value = { projectId, since: Date.now() };
  const channels = await api.channels().catch((): ChannelsState => ({ channels: [] }));
  let state = startHandoff(hexId, verb, channels);
  const toast = toasts.show("", "info", null);
  const show = () => toast.update(handoffToast(state));
  show();
  if (done(state)) return;
  let seenChannels = channelState.peek();
  let seenCall = agentCall.peek();
  const stop = effect(() => {
    const c = channelState.value;
    const a = agentCall.value;
    let next = state;
    if (c && c !== seenChannels) next = onChannels(next, c);
    if (a && a !== seenCall) next = onAgent(next, a);
    seenChannels = c;
    seenCall = a;
    if (next !== state) {
      const before = state.step;
      state = next;
      if (state.step !== before) show();
    }
    if (done(state)) finish();
  });
  const timer = setTimeout(() => {
    state = onTimeout(state);
    show();
    finish();
  }, PICKUP_MS);
  function finish() {
    clearTimeout(timer);
    queueMicrotask(() => stop());
  }
}
