import { assertEquals } from "@std/assert";
import {
  handoffToast,
  onAgent,
  onChannels,
  onTimeout,
  startHandoff,
} from "../src/client/lib/handoff.ts";
import type { AgentCall, ChannelsState } from "../src/shared/views.ts";

const H = "hx-demo-abc";
const channels = (...sent: { hexId: string; at: number }[]): ChannelsState => ({
  channels: [{
    pid: 1,
    startedAt: 0,
    heartbeatAt: 0,
    sent: sent.map((s) => ({ ...s, event: "blessed" })),
  }],
});
const call = (at: number): AgentCall => ({ tool: "get_hex_view", read: true, hexId: H, at });

Deno.test("telling → sent → picked up, and only a send newer than before counts", () => {
  let s = startHandoff(H, "Blessed", channels({ hexId: H, at: 50 }));
  assertEquals([s.step, s.baseline], ["telling", 50]);
  s = onChannels(s, channels({ hexId: H, at: 50 })); // the old send again: still telling
  assertEquals(s.step, "telling");
  s = onChannels(s, channels({ hexId: "hx-demo-zzz", at: 200 })); // another hex
  assertEquals(s.step, "telling");
  s = onChannels(s, channels({ hexId: H, at: 50 }, { hexId: H, at: 100 }));
  assertEquals([s.step, s.sentAt], ["sent", 100]);
  s = onAgent(s, call(90)); // before the send: not a pickup
  assertEquals(s.step, "sent");
  s = onAgent(s, call(150));
  assertEquals(s.step, "picked");
  assertEquals(handoffToast(s), {
    text: `Blessed ${H} · Claude picked it up`,
    kind: "success",
    ttl: 4000,
  });
  assertEquals(onTimeout(s).step, "picked");
});

Deno.test("a pickup seen before its send still counts once the send shows", () => {
  let s = startHandoff(H, "Published", channels());
  s = onAgent(s, call(300));
  assertEquals(s.step, "telling");
  s = onChannels(s, channels({ hexId: H, at: 200 }));
  assertEquals(s.step, "picked");
});

Deno.test("nobody listening, never sent, and sent but not picked up", () => {
  const nobody = startHandoff(H, "Answered", { channels: [] });
  assertEquals(nobody.step, "nobody");
  assertEquals(handoffToast(nobody).ttl, 8000);
  assertEquals(onAgent(nobody, call(5)).step, "nobody");

  const s = startHandoff(H, "Blessed", channels());
  assertEquals(handoffToast(s), {
    text: `Blessed ${H} · Telling Claude…`,
    kind: "info",
    ttl: null,
  });
  assertEquals(onTimeout(s).step, "unsent");
  const sent = onChannels(s, channels({ hexId: H, at: 10 }));
  assertEquals(handoffToast(sent).text, `Blessed ${H} · Sent to Claude`);
  const late = onTimeout(sent);
  assertEquals(late.step, "unanswered");
  assertEquals(handoffToast(late).text, `Blessed ${H} · Sent. Claude hasn't picked it up yet.`);
});
