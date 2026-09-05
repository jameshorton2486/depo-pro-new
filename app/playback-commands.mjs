// The three playback commands a transcription foot pedal drives, and the arithmetic behind two of
// them. Pure, so the pedal boundary can be characterized without a browser or the hardware.
//
// WHY KEYSTROKES AND NOT USB. The reporter's Infinity pedal is read by NCH Pedable, which converts
// a pedal press into a key combination -- "Send Key Combination" is one of the four actions its
// wizard offers. That makes Pedable the hardware abstraction layer and leaves Depo-Pro needing only
// stable keyboard commands. Direct WebHID would be a second pedal subsystem competing with software
// that already works, and would tie the application to one manufacturer.
//
// WHY FUNCTION KEYS. Pedable synthesizes a real keystroke at the operating-system level, so whatever
// is bound arrives at whatever has focus. A pedal bound to Space would type a space into the
// paragraph being corrected -- not merely inert, destructive. Function keys carry no character, so
// they can be handled while the reporter is typing, which is exactly when a pedal is used.
//
// The bindings Chrome claims before the page ever sees them are deliberately left alone: F1 help,
// F3 find-next, F5 reload, F6 address bar, F7 caret browsing, F10 menu, F11 fullscreen, F12
// developer tools. F2, F4 and F8 are free.

export const PLAYBACK_COMMANDS = Object.freeze({
  PLAY_PAUSE: "PLAY_PAUSE",
  REWIND: "REWIND",
  FAST_FORWARD: "FAST_FORWARD",
});

/** Left pedal rewinds, centre plays and pauses, right goes forward. */
export const DEFAULT_PLAYBACK_BINDINGS = Object.freeze({
  F2: PLAYBACK_COMMANDS.REWIND,
  F4: PLAYBACK_COMMANDS.PLAY_PAUSE,
  F8: PLAYBACK_COMMANDS.FAST_FORWARD,
});

/** Three seconds: long enough to re-hear a word, short enough to press repeatedly. */
export const DEFAULT_SKIP_SECONDS = 3;

/** Where the reporter's chosen interval is kept between sessions. */
export const SKIP_SECONDS_KEY = "depo-pro:playback-skip-seconds";

const SKIP_MINIMUM = 0.5, SKIP_MAXIMUM = 30;

/**
 * The interval to actually skip by.
 *
 * Bounded rather than trusted. A pedal is pressed without looking, so an interval of 0 would make
 * it feel dead and one of 600 would throw the reporter out of the passage they were checking --
 * both read as the pedal being broken rather than as a setting being wrong. Anything unreadable
 * falls back to the default instead of propagating NaN into currentTime, which would leave the
 * player in an invalid state.
 */
export function normalizeSkipSeconds(value, fallback = DEFAULT_SKIP_SECONDS) {
  const seconds = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return Math.min(SKIP_MAXIMUM, Math.max(SKIP_MINIMUM, seconds));
}

/**
 * The command a key event asks for, or null.
 *
 * A modifier disqualifies the key entirely. Alt+F4 closes the window and Ctrl+F4 closes the tab;
 * treating either as "play" would answer a keystroke the reporter aimed somewhere else, and the
 * window would be gone before the audio started.
 */
export function playbackCommandFor(event, bindings = DEFAULT_PLAYBACK_BINDINGS) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
  return bindings[event.key] ?? null;
}

/**
 * Where a skip lands, clamped to the recording.
 *
 * Returns null for a command that is not a skip, so the caller branches once rather than asking
 * twice. An unknown duration -- the metadata has not loaded yet -- clamps only at zero: refusing to
 * move because the far end is unknown would make the pedal feel broken during the first seconds.
 */
export function seekTarget(currentTime, duration, command, seconds = DEFAULT_SKIP_SECONDS) {
  const from = Number.isFinite(currentTime) ? currentTime : 0;
  const step = Number.isFinite(seconds) ? Math.abs(seconds) : DEFAULT_SKIP_SECONDS;
  if (command === PLAYBACK_COMMANDS.REWIND) return Math.max(0, from - step);
  if (command === PLAYBACK_COMMANDS.FAST_FORWARD) {
    const end = Number.isFinite(duration) ? duration : Infinity;
    return Math.max(0, Math.min(end, from + step));
  }
  return null;
}
