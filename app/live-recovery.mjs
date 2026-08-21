// What the live screen should do when it loads and a recording is already going.
//
// A reporter who reloads mid-deposition loses every bit of client state; the recording does not
// notice. Before this, the screen came back offering "Start recording" while ffmpeg was still
// writing, and the session was unreachable -- no stop, no hash, no attach. The audio the whole
// application exists to produce could not be closed out.
//
// The server is asked and the answer is used. Nothing is kept in localStorage: a client copy of
// which session is running can only ever be a second answer to a question the server can already
// answer, and the two disagree exactly when it matters -- after a crash, a restart, a second tab.
//
// Pure: takes the server's reply, returns a decision. No fetch, no DOM, no state.

export const NONE = "NONE", REATTACH = "REATTACH", CHOOSE = "CHOOSE";

/**
 * Decides between reattaching, asking, and doing nothing.
 *
 * More than one running session is reported rather than guessed at. It should not happen -- one
 * screen starts one recording -- but if it does, the reasons are a second window or a session that
 * failed to close, and picking one for the reporter means the other keeps recording unattended,
 * which is the failure this whole module exists to end.
 */
export function chooseRecovery(payload) {
  const recoverable = Array.isArray(payload?.recoverable) ? payload.recoverable.filter(Boolean) : [];
  const orphaned = Array.isArray(payload?.orphaned) ? payload.orphaned.filter(Boolean) : [];
  if (recoverable.length === 1) return { kind: REATTACH, session: recoverable[0], sessions: recoverable, orphaned };
  if (recoverable.length > 1) return { kind: CHOOSE, session: null, sessions: recoverable, orphaned };
  return { kind: NONE, session: null, sessions: [], orphaned };
}

/**
 * What to tell the reporter about recordings an earlier run of the application left open.
 *
 * Reported, never repaired. Finalizing needs the capture processes that wrote the audio, and those
 * died with the run that started them; the manifest still says RECORDING, so attaching the audio to
 * a deposition is refused as well. Nothing here can fix that. What it can do is stop the recording
 * from being invisible -- a reporter who is not told assumes it was put away.
 */
export function orphanedNotice(orphaned = []) {
  if (!orphaned.length) return null;
  const count = orphaned.length;
  return `${count} recording${count === 1 ? " was" : "s were"} left open by an earlier run of the application. ` +
    `${count === 1 ? "It cannot" : "They cannot"} be stopped or attached from here.`;
}
