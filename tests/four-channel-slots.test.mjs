import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const screen = fs.readFileSync(path.join(ROOT, "app", "LiveCaptureScreen.tsx"), "utf8");
const deepgram = fs.readFileSync(path.join(ROOT, "server", "deepgram-live.mjs"), "utf8");

// The declared channels, read out of the screen rather than restated here -- a copy of the list
// would pass while the screen said something else.
function declaredSlots() {
  const block = screen.match(/const CHANNEL_SLOTS[\s\S]*?\n\];/);
  assert.ok(block, "CHANNEL_SLOTS is the one list of capture channels the screen offers");
  return [...block[0].matchAll(/\{\s*id:\s*"([^"]+)",\s*role:\s*"([^"]+)",\s*required:\s*(true|false)\s*\}/g)]
    .map(([, id, role, required]) => ({ id, role, required: required === "true" }));
}

function sharedRoles() {
  const line = deepgram.match(/const SHARED_ROLES=new Set\(\[([^\]]*)\]\)/);
  assert.ok(line, "SHARED_ROLES is what decides whether a channel is diarized");
  return new Set([...line[1].matchAll(/"([^"]+)"/g)].map(([, role]) => role));
}

test("the screen offers four capture channels, and exactly one is required", () => {
  const slots = declaredSlots();
  assert.equal(slots.length, 4);
  assert.equal(slots.filter((slot) => slot.required).length, 1, "a deposition needs one microphone to start, not four");
  assert.equal(slots[0].required, true, "the required one is CH1");
  assert.equal(new Set(slots.map((slot) => slot.id)).size, 4, "channel IDs are what the manifest keys artifacts on");
});

test("every channel ID is one validateSources will accept", () => {
  // SOURCE_ID in live-capture.mjs. A slot the screen offers but the server refuses would fail at
  // the moment the reporter presses record, which is the worst possible time to find out.
  for (const slot of declaredSlots()) assert.match(slot.id, /^[a-z][a-z0-9-]{0,63}$/);
});

test("a channel carrying one voice is never diarized", () => {
  // The cross-module invariant, and the reason this test reads both files instead of one.
  //
  // SHARED_ROLES exists because a microphone covering a room holds several speakers, and without
  // diarization it produces one unbroken block. The inverse is just as true and less obvious: a
  // microphone assigned to a single participant holds one voice, and diarizing it invents turns
  // that never happened -- in the live aid a reporter reads while the deposition is running.
  //
  // Adding PARTICIPANT_MICROPHONE to SHARED_ROLES would do exactly that, silently, and nothing in
  // either file on its own would look wrong.
  const shared = sharedRoles();
  const dedicated = declaredSlots().filter((slot) => slot.role === "PARTICIPANT_MICROPHONE");
  assert.ok(dedicated.length >= 1, "the participant channels are the ones this protects");
  for (const slot of dedicated)
    assert.ok(!shared.has(slot.role), `${slot.role} carries one voice and must not be diarized`);
  // And the room channels must stay in it, or they lose the diarization they exist to get.
  assert.ok(shared.has("LOCAL_MICROPHONE"));
  assert.ok(shared.has("VIRTUAL_MEETING_AUDIO"));
});

test("nothing on the screen assumes two channels any more", () => {
  // What this replaced: `mic === meeting`, which was a duplicate-device check that silently
  // stopped covering the case as soon as a third channel existed.
  assert.ok(
    !/\bmic === meeting\b/.test(screen),
    "the duplicate-device check must be over all channels, not the first two",
  );
  assert.ok(
    /new Set\(chosen\.map\(\(slot\) => slot\.value\)\)\.size !== chosen\.length/.test(screen),
    "two channels on one device is a channel that will not record, so it is refused for any pair",
  );
});

test("a reattached session's devices win over anything this client selected", () => {
  // Created by the merge and covered by neither branch alone. Four configurable channels came from
  // one change and session reattach from another; together, a client that reloads mid-recording
  // must show the devices actually being written, on every channel, not empty pickers beside live
  // meters. The lookup is by slot id rather than by name so it holds for four channels as it did
  // for two.
  const slots = screen.match(/const slots = CHANNEL_SLOTS\.map\([\s\S]*?\}\)\);/);
  assert.ok(slots, "the slot list is built from CHANNEL_SLOTS, so it is generic over channel count");
  assert.match(slots[0], /session\?\.sources\.find\(\(source\) => source\.id === slot\.id\)\?\.deviceId/,
    "the running session is consulted first, per slot");
  assert.ok(
    slots[0].indexOf("session?.sources") < slots[0].indexOf("channelDevices[slot.id]"),
    "and it takes precedence: a reattached client selected nothing, so its own state is the fallback",
  );
});
