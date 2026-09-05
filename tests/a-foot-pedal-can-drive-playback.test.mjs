// The three playback commands a foot pedal drives.
//
// The reporter's Infinity Foot Pedal 3 is read by NCH Pedable, whose wizard converts a press into a
// key combination. Measured on the release workstation: Pedable is installed and running, the pedal
// enumerates as VEC USB Footpedal (VID_05F3), three pedals are configured -- and PedalSettings holds
// no values, so nothing is bound. The missing half was on this side: Depo-Pro had exactly one
// playback key, Space, and no rewind or forward at all.
//
// Two properties matter more than the bindings themselves, and both are asserted below.
//
//   Space is the wrong key for a pedal. Pedable synthesizes a real keystroke at OS level, so a pedal
//   bound to Space types a space into the paragraph being corrected.
//
//   A pedal is pressed WHILE typing. The Space handler returns early when a text field has focus,
//   which is correct for a keyboard and fatal for a pedal, so these commands must not do that.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_PLAYBACK_BINDINGS, DEFAULT_SKIP_SECONDS, PLAYBACK_COMMANDS, SKIP_SECONDS_KEY,
  normalizeSkipSeconds, playbackCommandFor, seekTarget,
} from "../app/playback-commands.mjs";

const press = (key, modifiers = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...modifiers });

test("left rewinds, centre plays and pauses, right goes forward", () => {
  assert.equal(playbackCommandFor(press("F2")), PLAYBACK_COMMANDS.REWIND);
  assert.equal(playbackCommandFor(press("F4")), PLAYBACK_COMMANDS.PLAY_PAUSE);
  assert.equal(playbackCommandFor(press("F8")), PLAYBACK_COMMANDS.FAST_FORWARD);
});

test("a modifier disqualifies the key entirely", () => {
  // Alt+F4 closes the window and Ctrl+F4 closes the tab. Treating either as "play" would answer a
  // keystroke aimed somewhere else, and the window would be gone before the audio started.
  for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey"]) {
    assert.equal(playbackCommandFor(press("F4", { [modifier]: true })), null, `${modifier}+F4 must not play`);
  }
});

test("the keys Chrome claims are left alone", () => {
  // These never reach the page: F1 help, F3 find-next, F5 reload, F6 address bar, F7 caret
  // browsing, F10 menu, F11 fullscreen, F12 developer tools. Binding one would produce a pedal that
  // works on some machines and reloads the transcript on others.
  for (const key of ["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"]) {
    assert.equal(playbackCommandFor(press(key)), null, `${key} is Chrome's, not ours`);
  }
  assert.equal(playbackCommandFor(press(" ")), null, "Space is not a pedal command");
  assert.equal(playbackCommandFor(press("a")), null);
  assert.equal(playbackCommandFor(null), null);
});

test("rewinding stops at the beginning of the recording", () => {
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.REWIND), 7);
  assert.equal(seekTarget(1.5, 100, PLAYBACK_COMMANDS.REWIND), 0, "never negative");
  assert.equal(seekTarget(0, 100, PLAYBACK_COMMANDS.REWIND), 0);
});

test("forwarding stops at the end of the recording", () => {
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.FAST_FORWARD), 13);
  assert.equal(seekTarget(99, 100, PLAYBACK_COMMANDS.FAST_FORWARD), 100, "never past the end");
});

test("an unloaded duration still allows a skip", () => {
  // Metadata arrives asynchronously. Refusing to move because the far end is unknown would make the
  // pedal feel broken for the first seconds after opening a deposition.
  assert.equal(seekTarget(10, NaN, PLAYBACK_COMMANDS.FAST_FORWARD), 13);
  assert.equal(seekTarget(10, undefined, PLAYBACK_COMMANDS.FAST_FORWARD), 13);
  assert.equal(seekTarget(NaN, 100, PLAYBACK_COMMANDS.REWIND), 0, "an unknown position starts at zero");
});

test("play/pause is not a seek", () => {
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.PLAY_PAUSE), null);
  assert.equal(seekTarget(10, 100, "SOMETHING_ELSE"), null);
});

test("the interval is a parameter, not a constant baked into the arithmetic", () => {
  assert.equal(DEFAULT_SKIP_SECONDS, 3);
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.REWIND, 5), 5);
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.FAST_FORWARD, 0.5), 10.5);
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.REWIND, -5), 5, "a negative interval still rewinds");
});

test("every default binding names a real command", () => {
  const commands = new Set(Object.values(PLAYBACK_COMMANDS));
  for (const [key, command] of Object.entries(DEFAULT_PLAYBACK_BINDINGS)) {
    assert.ok(commands.has(command), `${key} is bound to ${command}, which is not a command`);
  }
  assert.equal(Object.keys(DEFAULT_PLAYBACK_BINDINGS).length, 3, "three pedals, three bindings");
});

test("the skip interval is bounded, and unreadable input falls back rather than propagating", () => {
  // A pedal is pressed without looking. An interval of 0 reads as a dead pedal and one of 600
  // throws the reporter out of the passage they were checking -- both look like broken hardware
  // rather than a wrong setting. NaN would reach currentTime and leave the player invalid.
  assert.equal(normalizeSkipSeconds(5), 5);
  assert.equal(normalizeSkipSeconds("2.5"), 2.5);
  assert.equal(normalizeSkipSeconds("  4 "), 4);
  assert.equal(normalizeSkipSeconds(0.1), 0.5, "clamped up to the minimum");
  assert.equal(normalizeSkipSeconds(600), 30, "clamped down to the maximum");
  for (const bad of [0, -3, NaN, null, undefined, "", "abc", {}]) {
    assert.equal(normalizeSkipSeconds(bad), DEFAULT_SKIP_SECONDS, `${JSON.stringify(bad)} falls back`);
  }
  assert.equal(normalizeSkipSeconds("", 7), 7, "the fallback is a parameter");
});

test("the chosen interval reaches the seek, and is remembered", () => {
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /seekTarget\(audio\.currentTime,audio\.duration,command,skipSeconds\)/,
    "the reporter's interval must be what the skip uses, not the default");
  assert.match(screen, /\[playbackSource,skipSeconds\]/,
    "and the handler must be rebuilt when it changes, or it would keep skipping by the old one");
  assert.match(screen, /localStorage\.setItem\(SKIP_SECONDS_KEY/, "chosen once, kept between sessions");
  assert.match(screen, /localStorage\.getItem\(SKIP_SECONDS_KEY\)/);
  assert.match(screen, /workspace-skip-seconds/, "and it is set from the Workspace, not a config file");
  assert.ok(SKIP_SECONDS_KEY.startsWith("depo-pro:"), "namespaced so it cannot collide");
});

test("editing a paragraph no longer pauses the recording", () => {
  // Reversed deliberately. The old handler paused whenever an editor opened -- correct for someone
  // typing with two hands, wrong for a reporter working the transport with their foot, because it
  // took the transport away at the moment the pedal was being used. The editor still reports that
  // editing began; nothing acts on it by default.
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const handler = screen.slice(screen.indexOf("const editingChange="), screen.indexOf("const [skipSeconds"));
  assert.equal(/player\.current\?\.pause\(\)/.test(handler), false,
    "opening an editor must not stop the audio the pedal is controlling");
  assert.match(screen, /onEditingChange=\{editingChange\}/, "the signal itself is kept");
});

test("the pedal commands survive a text field having focus", () => {
  // THE PEDAL-CRITICAL PROPERTY, and the one thing that separates this handler from the Space
  // handler beside it. Asserted against the shipped source because it is a property of the wiring,
  // not of the pure module: the effect must not filter on input/textarea/contenteditable focus.
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const start = screen.indexOf("const command=playbackCommandFor(event)");
  assert.ok(start > 0, "the pedal handler must be wired into the Workspace");
  const handler = screen.slice(start, screen.indexOf('window.addEventListener("keydown",key)', start));
  assert.equal(/matches\("input,textarea/.test(handler), false,
    "a pedal is pressed while typing; this handler must not return early on editor focus");
  assert.match(handler, /playbackEnd\.current=null/,
    "skipping clears the paragraph stop point, or forwarding past it pauses immediately");
  assert.match(handler, /event\.preventDefault\(\)/);
  // The centre pedal's branch, asserted because a mutation that disabled it survived every other
  // test in this file: the pure module knows what PLAY_PAUSE means, and only the wiring acts on it.
  assert.match(handler, /command===PLAYBACK_COMMANDS\.PLAY_PAUSE/, "the centre pedal must toggle playback");
  assert.match(handler, /audio\.paused\)void audio\.play\(\)[\s\S]*?else audio\.pause\(\)/,
    "and toggle it in both directions");
});
