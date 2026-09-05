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
  CONTINUOUS_RATE_KEY, CONTINUOUS_TICK_MS, DEFAULT_CONTINUOUS_RATE, DEFAULT_PLAYBACK_BINDINGS,
  DEFAULT_SKIP_SECONDS, HOLD_THRESHOLD_MS, PLAYBACK_COMMANDS, SKIP_SECONDS_KEY,
  continuousStep, normalizeContinuousRate, normalizeSkipSeconds, playbackCommandFor, seekTarget,
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
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.REWIND), 5);
  assert.equal(seekTarget(4, 100, PLAYBACK_COMMANDS.REWIND), 0, "never negative");
  assert.equal(seekTarget(0, 100, PLAYBACK_COMMANDS.REWIND), 0);
});

test("forwarding stops at the end of the recording", () => {
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.FAST_FORWARD), 15);
  assert.equal(seekTarget(97, 100, PLAYBACK_COMMANDS.FAST_FORWARD), 100, "never past the end");
});

test("an unloaded duration still allows a skip", () => {
  // Metadata arrives asynchronously. Refusing to move because the far end is unknown would make the
  // pedal feel broken for the first seconds after opening a deposition.
  assert.equal(seekTarget(10, NaN, PLAYBACK_COMMANDS.FAST_FORWARD), 15);
  assert.equal(seekTarget(10, undefined, PLAYBACK_COMMANDS.FAST_FORWARD), 15);
  assert.equal(seekTarget(NaN, 100, PLAYBACK_COMMANDS.REWIND), 0, "an unknown position starts at zero");
});

test("play/pause is not a seek", () => {
  assert.equal(seekTarget(10, 100, PLAYBACK_COMMANDS.PLAY_PAUSE), null);
  assert.equal(seekTarget(10, 100, "SOMETHING_ELSE"), null);
});

test("the interval is a parameter, not a constant baked into the arithmetic", () => {
  assert.equal(DEFAULT_SKIP_SECONDS, 5, "the reporter set five after working a real transcript");
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
  assert.match(screen, /seekBy\(command,skipSeconds\)/,
    "the reporter's interval must be what a tap uses, not the default");
  assert.match(screen, /seekTarget\(audio\.currentTime,audio\.duration,command,seconds\)/,
    "and every seek goes through the same clamped arithmetic");
  assert.match(screen, /\[playbackSource,skipSeconds,continuousRate\]/,
    "the handler must be rebuilt when either setting changes, or it would keep using the old one");
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

// ---------------------------------------------------------------------------------------------
// Hold transport. Measured on the reporter's Infinity Foot Pedal 3 through Pedable before any of
// this was written: a four-second hold produced ONE keydown and ONE keyup 4223ms apart, with no
// auto-repeat between them. Release is therefore observable, and the speed of a held transport is
// this application's to set rather than a consequence of the operator's Windows repeat settings.
// ---------------------------------------------------------------------------------------------

test("the hold threshold clears a real pedal tap", () => {
  // MEASURED, not chosen. Two deliberate quick taps on the physical pedal both registered 313ms --
  // a pedal has travel a key does not. A 300ms threshold would have read both as holds and started
  // a continuous rewind nobody asked for.
  assert.equal(HOLD_THRESHOLD_MS, 500);
  assert.ok(HOLD_THRESHOLD_MS > 313, "a measured 313ms tap must not be mistaken for a hold");
});

test("a held pedal moves at a rate this application sets", () => {
  // 4x at 50ms ticks: four seconds of recording per second of holding, in twenty steps.
  assert.equal(CONTINUOUS_TICK_MS, 50);
  assert.equal(DEFAULT_CONTINUOUS_RATE, 4);
  assert.equal(continuousStep(4, 50), 0.2);
  assert.equal(continuousStep(1, 50), 0.05);
  assert.equal(continuousStep(20, 50), 1);
  const perSecond = continuousStep(4, 50) * (1000 / 50);
  assert.equal(perSecond, 4, "one second of holding covers four seconds of recording");
});

test("the hold speed is bounded and independent of the tap interval", () => {
  assert.equal(normalizeContinuousRate(6), 6);
  assert.equal(normalizeContinuousRate("2.5"), 2.5);
  assert.equal(normalizeContinuousRate(0.1), 1, "clamped up");
  assert.equal(normalizeContinuousRate(999), 20, "clamped down");
  for (const bad of [0, -4, NaN, null, undefined, "", "fast", {}]) {
    assert.equal(normalizeContinuousRate(bad), DEFAULT_CONTINUOUS_RATE, `${JSON.stringify(bad)} falls back`);
  }
  assert.notEqual(CONTINUOUS_RATE_KEY, SKIP_SECONDS_KEY, "two settings, two keys");
});

test("a held pedal steps through the same clamps a tap does", () => {
  // Continuous transport reuses seekTarget, so it cannot run past either end of the recording.
  const step = continuousStep(4, 50);
  assert.equal(seekTarget(0.1, 100, PLAYBACK_COMMANDS.REWIND, step), 0, "held rewind stops at the start");
  assert.equal(seekTarget(99.9, 100, PLAYBACK_COMMANDS.FAST_FORWARD, step), 100, "held forward stops at the end");
});

test("the transport handles release, not just press", () => {
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /addEventListener\("keyup",up\)/, "release is what stops a hold");
  assert.match(screen, /addEventListener\("blur",abandon\)/,
    "a pedal released while another window has focus never delivers its keyup here");
  assert.match(screen, /if\(event\.repeat\)return/, "a repeat must not restart the action underneath it");
  assert.match(screen, /transport\.current&&transport\.current\.key!==event\.key\)clear\(\)/,
    "a second transport pedal supersedes the first rather than running both");
  assert.match(screen, /duration>=HOLD_THRESHOLD_MS\|\|held\.wasPlaying\)audio\.pause\(\)/,
    "a hold pauses on release; a tap keeps the keyboard's toggle");
  assert.match(screen, /window\.clearTimeout\(held\.threshold\)/);
  assert.match(screen, /window\.clearInterval\(held\.ticker\)/);
  // The cleanup path must run on unmount and whenever the deposition changes, or a released pedal
  // could strand a timer still seeking a transcript nobody is looking at.
  const effect = screen.slice(screen.indexOf("const seekBy=(command:string"), screen.indexOf("[playbackSource,skipSeconds,continuousRate]"));
  assert.match(effect, /return\(\)=>\{[\s\S]*abandon\(\);[\s\S]*\}/, "unmount releases the pedal");
  assert.match(screen, /\[playbackSource,skipSeconds,continuousRate\]/, "and a deposition change rebuilds it");
});

test("the tap fires on the way down, so a quick press is exactly one interval", () => {
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const down = screen.slice(screen.indexOf("const down=(event:KeyboardEvent)"), screen.indexOf("const up=(event:KeyboardEvent)"));
  const tap = down.indexOf("seekBy(command,skipSeconds)");
  const hold = down.indexOf("setTimeout");
  assert.ok(tap > 0 && hold > tap, "the single seek happens before the hold timer is armed");
  assert.match(down, /setInterval\(\(\)=>seekBy\(command,continuousStep\(continuousRate\)\),CONTINUOUS_TICK_MS\)/,
    "and continuous transport runs at the configured rate on this application's clock");
});

test("the pedal commands survive a text field having focus", () => {
  // THE PEDAL-CRITICAL PROPERTY, and the one thing that separates this handler from the Space
  // handler beside it. Asserted against the shipped source because it is a property of the wiring,
  // not of the pure module: the effect must not filter on input/textarea/contenteditable focus.
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const start = screen.indexOf("const seekBy=(command:string");
  assert.ok(start > 0, "the pedal handler must be wired into the Workspace");
  const handler = screen.slice(start, screen.indexOf("[playbackSource,skipSeconds,continuousRate]", start));
  assert.equal(/matches\("input,textarea/.test(handler), false,
    "a pedal is pressed while typing; this handler must not return early on editor focus");
  assert.match(handler, /playbackEnd\.current=null/,
    "skipping clears the paragraph stop point, or forwarding past it pauses immediately");
  assert.match(handler, /event\.preventDefault\(\)/);
  // The centre pedal's branch, asserted because a mutation that disabled it survived every other
  // test in this file: the pure module knows what PLAY_PAUSE means, and only the wiring acts on it.
  assert.match(handler, /command===PLAYBACK_COMMANDS\.PLAY_PAUSE/, "the centre pedal must toggle playback");
  assert.match(handler, /if\(audio\.paused\)void audio\.play\(\)/, "pressing it starts playback");
  assert.match(handler, /audio\.pause\(\)/, "and releasing it stops playback");
});
