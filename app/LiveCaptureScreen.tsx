"use client";
import { useEffect, useRef, useState } from "react";
import { groupLiveEvents } from "./live-paragraphs.mjs";
import { LOCAL_API_BASE_URL as API } from "./api-client";
type Device = { id: string; name: string; kind: "input" | "loopback" };
type Health = {
  rmsDb: number | null;
  peakDb: number | null;
  silence: boolean;
  clipping: boolean;
  receivedAudio: boolean;
  silentForSeconds?: number;
  silenceAlarm?: boolean;
};
type Source = {
  id: string;
  role: string;
  deviceId: string;
  deviceName: string;
  health?: Health;
  artifact?: {
    bytes: number | null;
    sha256: string | null;
    finalized: boolean;
  };
};
type Preflight = {
  preflightId: string;
  state: "NOT_TESTED" | "TEST_CAPTURED" | "PLAYBACK_CONFIRMED" | "ARMED";
  sources: Source[];
};
type SessionEvent = { type: string };
type Session = {
  sessionId: string;
  state: string;
  sources: Source[];
  events?: SessionEvent[];
};
// DEGRADED means two different things depending on when it was set. startCaptureSession sets it
// when a channel's ffmpeg exits mid-recording -- the surviving channels are still being written,
// and the reporter still has to be able to stop them. stopCaptureSession sets the same state when
// a channel failed to finalize, which is terminal. Testing state alone made a degraded live
// session read as finished: Stop disappeared, polling stopped, and Back unlocked while ffmpeg was
// still writing. LOCAL_RECORDING_STOPPED is the discriminator, because stop always appends it.
const isRunning = (session: Session | null) =>
  Boolean(session) &&
  (session!.state === "RECORDING" || session!.state === "DEGRADED") &&
  !(session!.events ?? []).some(
    (event) => event.type === "LOCAL_RECORDING_STOPPED",
  );
// The live record is an aid, and its own schema says so: canonicalTranscriptAuthority is false and
// it never writes the working transcript. Surfaced here so the screen can state it rather than
// leaving a reporter to assume the text on screen is the record.
type LiveChannel = { id: string; role: string; connectionState: string };
type Hit = {
  eventId: string;
  channelId: string;
  channelRole: string | null;
  streamSeconds: number;
  text: string;
  matched: string | null;
  playFromSeconds: number | null;
  positionable: boolean;
  precision: string;
};
type LiveEvent = {
  id: string;
  channelId: string;
  start: number;
  duration: number;
  transcript: string;
  words: { speaker: number | null }[];
};
type Live = {
  state: string;
  canonicalTranscriptAuthority: boolean;
  channels: LiveChannel[];
  finalizedEvents: LiveEvent[];
  interimByChannel?: Record<string, LiveEvent>;
  errors: { message?: string }[];
};
type Unassigned = {
  sessionId: string;
  label: string | null;
  state: string;
  // Whether this application instance is the one recording it. See listCaptureSessions: state
  // alone cannot tell a live capture from one whose instance died mid-recording.
  running: boolean;
  createdAt: string;
  assignedDepositionId: string | null;
  channels: { id: string; role: string; state: string; bytes: number | null }[];
};
type LibraryDeposition = { id: string; caseStyle: string; witness: string };
export default function LiveCaptureScreen({
  deposition,
  onDepositionUpdated,
  onBack,
}: {
  deposition: LibraryDeposition | null;
  onDepositionUpdated?: (deposition: LibraryDeposition) => void;
  onBack: () => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]),
    [mic, setMic] = useState(""),
    [meeting, setMeeting] = useState(""),
    [preflight, setPreflight] = useState<Preflight | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [monitor, setMonitor] = useState("ALL"),
    [live, setLive] = useState<Live | null>(null),
    [channel, setChannel] = useState(""),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<Hit[] | null>(null),
    [handoff, setHandoff] = useState<string>(""),
    [registeredUploads, setRegisteredUploads] = useState<string[]>([]),
    [transcriptProgress, setTranscriptProgress] = useState(""),
    [label, setLabel] = useState(""),
    [unassigned, setUnassigned] = useState<Unassigned[]>([]),
    [library, setLibrary] = useState<LibraryDeposition[]>([]),
    [assignTo, setAssignTo] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const running = isRunning(session),
    sessionId = session?.sessionId ?? null;
  const openDepositionId = deposition?.id ?? "";
  const scroller = useRef<HTMLDivElement | null>(null),
    [following, setFollowing] = useState(true);
  // Newest card, whenever one arrives -- but only while the reporter has not scrolled away.
  useEffect(() => {
    if (following && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  });
  useEffect(() => {
    let current = true;
    fetch(`${API}/api/live-capture/devices`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload.devices ?? [];
      })
      .then((available: Device[]) => {
        if (current) {
          setDevices(available);
          setMic(available.find((item) => item.kind === "input")?.id || "");
          setMeeting("");
        }
      })
      .catch((reason) => {
        if (current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not enumerate audio devices.",
          );
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!running || !sessionId) return;
    const timer = setInterval(() => {
      fetch(
        `${API}/api/live-capture/session?depositionId=${encodeURIComponent(openDepositionId)}&sessionId=${encodeURIComponent(sessionId)}`,
      )
        .then((response) => response.json())
        .then((payload) => setSession(payload))
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [openDepositionId, sessionId, running]);
  // Polls the live aid separately from the capture session, because they fail independently and are
  // meant to: Deepgram dropping must show as Deepgram dropping, never as a problem with the
  // recording. Keyed on live.state rather than the live object so an identical poll result does not
  // restart the interval.
  const liveState = live?.state ?? null;
  useEffect(() => {
    if (!sessionId || !liveState || liveState === "CLOSED") return;
    const timer = setInterval(() => {
      fetch(
        `${API}/api/live-capture/deepgram?depositionId=${encodeURIComponent(openDepositionId)}&sessionId=${encodeURIComponent(sessionId)}`,
      )
        .then((response) => response.json())
        .then((payload) => setLive(payload))
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [openDepositionId, sessionId, liveState]);
  // A client that mounts with no local state must still find a recording that is running. The
  // server is asked, because it is the only party that knows: this browser may have just been
  // reloaded, reopened, or opened on another machine entirely.
  //
  // This reattaches and nothing else. It never stops or finalizes the session it finds -- a
  // recovery path that treated a discovered recording as stale would end a live deposition on a
  // stray page load.
  useEffect(() => {
    let current = true;
    fetch(`${API}/api/live-capture/running?depositionId=${encodeURIComponent(openDepositionId)}`)
      .then((response) => response.json())
      .then((payload) => {
        if (!current || !payload?.sessionId) return;
        setSession(payload);
        setLabel(payload.label ?? "");
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [openDepositionId]);
  const slots = [
    {
      id: "local-microphone",
      role: "LOCAL_MICROPHONE",
      // While a session is running the devices it is actually recording are the truth, whoever
      // selected them and whenever. A reattached client never selected anything.
      value: session?.sources.find((source) => source.id === "local-microphone")?.deviceId ?? mic,
      set: setMic,
      required: true,
    },
    {
      id: "meeting-audio",
      role: "VIRTUAL_MEETING_AUDIO",
      value: session?.sources.find((source) => source.id === "meeting-audio")?.deviceId ?? meeting,
      set: setMeeting,
      required: false,
    },
  ];
  const refreshSessions = () => {
    fetch(`${API}/api/live-capture/sessions`)
      .then((response) => response.json())
      .then((payload) => setUnassigned(payload.sessions ?? []))
      .catch(() => undefined);
  };
  useEffect(() => {
    refreshSessions();
    fetch(`${API}/api/depositions`)
      .then((response) => response.json())
      .then((payload) => setLibrary(payload.depositions ?? []))
      .catch(() => undefined);
  }, []);
  const sources = (): Source[] =>
    slots
      .filter((slot) => slot.value)
      .map((slot) => ({
        id: slot.id,
        role: slot.role,
        deviceId: slot.value,
        deviceName:
          devices.find((item) => item.id === slot.value)?.name || slot.value,
      }));
  async function post(route: string, payload: object) {
    const response = await fetch(`${API}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Live capture request failed.");
    return result;
  }
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Live capture request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshOpenDeposition() {
    if (!deposition || !onDepositionUpdated) return;
    const response = await fetch(`${API}/api/depositions`), payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not refresh the deposition after recording.");
    const updated = (payload.depositions ?? []).find((item: LibraryDeposition) => item.id === deposition.id);
    if (updated) onDepositionUpdated(updated);
  }
  const beginTest = () =>
      act(async () => {
        const created = await post("/api/live-capture/preflight", {
          depositionId: deposition?.id ?? null,
          sources: sources(),
        });
        setPreflight(
          await post("/api/live-capture/preflight/test", {
            depositionId: deposition?.id ?? null,
            preflightId: created.preflightId,
          }),
        );
      }),
    confirm = () =>
      act(async () =>
        setPreflight(
          await post("/api/live-capture/preflight/confirm", {
            depositionId: deposition?.id ?? null,
            preflightId: preflight?.preflightId,
          }),
        ),
      ),
    arm = () =>
      act(async () =>
        setPreflight(
          await post("/api/live-capture/preflight/arm", {
            depositionId: deposition?.id ?? null,
            preflightId: preflight?.preflightId,
          }),
        ),
      ),
    start = () =>
      act(async () => {
        const configured = await post("/api/live-capture/session", {
          depositionId: deposition?.id ?? null,
          label,
          sources: sources(),
        });
        setSession(
          await post("/api/live-capture/start", {
            depositionId: deposition?.id ?? null,
            sessionId: configured.sessionId,
            preflightId: preflight?.preflightId,
          }),
        );
      }),
    search = () =>
      act(async () => {
        const result = await post("/api/live-capture/read-back", {
          depositionId: deposition?.id ?? null,
          sessionId: session?.sessionId,
          channelId: channel,
          query,
        });
        setHits(result.indexed ? result.hits : []);
        if (!result.indexed) setError(result.message);
      }),
    addToDeposition = () =>
      act(async () => {
        const result = await post("/api/live-capture/add-to-deposition", {
          depositionId: deposition?.id ?? null,
          sessionId: session?.sessionId,
        });
        setHandoff(
          `${result.added.length} channel${result.added.length === 1 ? "" : "s"} added to this deposition${result.skipped.length ? `; ${result.skipped.length} skipped (${result.skipped.map((s: { id: string }) => s.id).join(", ")})` : ""}.`,
        );
        setRegisteredUploads(result.added.map((item: { uploadId: string }) => item.uploadId));
        await refreshOpenDeposition();
      }),
    createWorkingTranscript = () =>
      act(async () => {
        for (const [index, uploadId] of registeredUploads.entries()) {
          setTranscriptProgress(`Transcribing channel ${index + 1} of ${registeredUploads.length}…`);
          await post("/api/audio/transcribe", {
            depositionId: deposition?.id ?? null,
            uploadId,
          });
        }
        setTranscriptProgress("Working transcript created. Open the Workspace to review speakers and corrections.");
      }),
    assign = (sessionId: string) =>
      act(async () => {
        await post("/api/live-capture/assign", {
          sessionId,
          depositionId: assignTo,
        });
        setHandoff("Recording attached. It is now this deposition's audio.");
        refreshSessions();
      }),
    stopSession = (sessionId: string) =>
      act(async () => {
        await post("/api/live-capture/stop", { depositionId: null, sessionId });
        setHandoff("Recording stopped and hashed.");
        refreshSessions();
      }),
    recover = (sessionId: string) =>
      act(async () => {
        await post("/api/live-capture/recover", { sessionId });
        setHandoff(
          "Recording finalized and hashed. It is marked degraded because the capture was interrupted and the moment it ended was not observed.",
        );
        refreshSessions();
      }),
    startRecording = () =>
      act(async () => {
        const configured = await post("/api/live-capture/session", {
          depositionId: deposition?.id ?? null,
          label,
          sources: sources(),
        });
        setSession(
          await post("/api/live-capture/start", {
            depositionId: deposition?.id ?? null,
            sessionId: configured.sessionId,
          }),
        );
        try {
          setLive(
            await post("/api/live-capture/deepgram/start", {
              depositionId: deposition?.id ?? null,
              sessionId: configured.sessionId,
            }),
          );
        } catch (reason) {
          setError(
            reason instanceof Error
              ? `Recording is running. Live text unavailable: ${reason.message}`
              : "Recording is running. Live text unavailable.",
          );
        }
      }),
    rename = (sessionId: string, next: string) =>
      act(async () => {
        await post("/api/live-capture/rename", {
          sessionId,
          depositionId: deposition?.id ?? null,
          label: next,
        });
        refreshSessions();
      }),
    startLive = () =>
      act(async () =>
        setLive(
          await post("/api/live-capture/deepgram/start", {
            depositionId: deposition?.id ?? null,
            sessionId: session?.sessionId,
          }),
        ),
      ),
    // Deepgram is closed before the recording is finalized, so the socket is finalized while its
    // audio source still exists. A failure here must not prevent the local recording from being
    // finalized -- that is the one thing on this screen that cannot be allowed to fail -- so the
    // deepgram stop is caught and surfaced rather than thrown.
    stop = () =>
      act(async () => {
        if (live && live.state !== "CLOSED") {
          try {
            setLive(
              await post("/api/live-capture/deepgram/stop", {
                depositionId: deposition?.id ?? null,
                sessionId: session?.sessionId,
              }),
            );
          } catch (reason) {
            setError(
              reason instanceof Error
                ? `Deepgram did not close cleanly: ${reason.message}. Finalizing the local recording anyway.`
                : "Deepgram did not close cleanly. Finalizing the local recording anyway.",
            );
          }
        }
        const finalized = await post("/api/live-capture/stop", {
            depositionId: deposition?.id ?? null,
            sessionId: session?.sessionId,
          });
        setSession(finalized);
        if (deposition) {
          const result = await post("/api/live-capture/add-to-deposition", {
            depositionId: deposition.id,
            sessionId: finalized.sessionId,
          });
          setRegisteredUploads(result.added.map((item: { uploadId: string }) => item.uploadId));
          setHandoff(`${result.added.length} verified channel${result.added.length === 1 ? " was" : "s were"} automatically attached to this deposition.`);
          await refreshOpenDeposition();
        }
      });
  const recording = running,
    tested = preflight?.state === "TEST_CAPTURED",
    confirmed = preflight?.state === "PLAYBACK_CONFIRMED",
    armed = preflight?.state === "ARMED";
  return (
    <main className="live-capture-screen">
      <header>
        <div>
          <span className="eyebrow">WINDOWS AUDIO SETUP</span>
          <h1>Live deposition</h1>
          <p>
            {deposition
              ? `${deposition.caseStyle} · ${deposition.witness}`
              : "No deposition open — this recording can be attached to one after you stop."}
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={onBack}
          disabled={recording}
        >
          Back to Workspace
        </button>
      </header>
      {deposition && <section className="live-readiness-summary" aria-labelledby="live-readiness-title">
        <div><span className="eyebrow">SCHEDULED DEPOSITION</span><h2 id="live-readiness-title">Confirm the case, then test both audio channels</h2></div>
        <dl><div><dt>Case</dt><dd>{deposition.caseStyle}</dd></div><div><dt>Witness</dt><dd>{deposition.witness}</dd></div><div><dt>Deposition ID</dt><dd>{deposition.id}</dd></div></dl>
        <p>Live text is preserved as a provisional transcript. The working transcript is created only after the verified local recordings are finalized.</p>
      </section>}
      <section className="live-capture-card">
        <h2>Local recording preflight</h2>
        <p>
          Local lossless recording is authoritative. Deepgram readiness never
          controls whether you can go on the record.
        </p>
        {error && (
          <p className="analysis-error" role="alert">
            {error}
          </p>
        )}
        <div className="preflight-steps">
          {["NOT_TESTED", "TEST_CAPTURED", "PLAYBACK_CONFIRMED", "ARMED"].map(
            (value) => (
              <span
                className={
                  (preflight?.state ?? "NOT_TESTED") === value ? "active" : ""
                }
                key={value}
              >
                {value.replaceAll("_", " ")}
              </span>
            ),
          )}
        </div>
        {!session && (
          <div className="quick-record">
            <button
              className="record-button"
              type="button"
              disabled={busy || !mic}
              onClick={() => void startRecording()}
            >
              {busy ? "Starting…" : "Start recording"}
            </button>
            <span>
              Records locally and connects live text. Name it when you stop.
            </span>
          </div>
        )}
        {!deposition && (
          <label className="session-label">
            <strong>Name this recording (optional)</strong>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Tues AM Garza — Herber depo"
              disabled={Boolean(session)}
            />
            <span>
              Optional. You can name it now or when you stop; either way it is
              how you find it before attaching it to a case.
            </span>
          </label>
        )}
        <div className="live-source-grid">
          {slots.map((slot, index) => {
            const live = session?.sources.find(
                (item) => item.id === slot.id,
              )?.health,
              tested = preflight?.sources.find(
                (item) => item.id === slot.id,
              )?.health,
              health = live ?? tested;
            return (
              <label key={slot.id}>
                <strong>
                  CH{index + 1} · {slot.role.replaceAll("_", " ")}
                  {slot.required ? "" : " (optional)"}
                </strong>
                <select
                  value={slot.value}
                  onChange={(event) => {
                    slot.set(event.target.value);
                    setPreflight(null);
                  }}
                  disabled={Boolean(session)}
                >
                  <option value="">
                    {slot.required ? "Select device" : "Not used"}
                  </option>
                  {devices.map((device) => (
                    <option value={device.id} key={`${slot.id}-${device.id}`}>
                      {device.name}
                    </option>
                  ))}
                </select>
                {health ? (
                  <div
                    className={`source-health ${health.silenceAlarm ? "alarm" : ""}`}
                  >
                    <meter min={-70} max={0} value={health.rmsDb ?? -70} />
                    <span className="source-level">
                      {health.rmsDb === null
                        ? "no reading"
                        : `${health.rmsDb.toFixed(1)} dB`}
                    </span>
                    <span>
                      {health.silenceAlarm
                        ? `NO AUDIO for ${Math.round(health.silentForSeconds ?? 0)}s — this channel is recording silence`
                        : health.receivedAudio === false
                          ? "Below -70 dB — cannot go on the record"
                          : health.clipping
                            ? "Clipping"
                            : health.silence
                              ? "Very quiet"
                              : "Audio received"}
                    </span>
                    {preflight && (
                      /* This is a preflight source check before any transcript exists. */
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <audio
                        controls
                        muted={
                          monitor !== "ALL" && monitor !== `CH${index + 1}`
                        }
                        crossOrigin="anonymous"
                        src={`${API}/api/live-capture/preflight/audio?depositionId=${encodeURIComponent(openDepositionId)}&preflightId=${encodeURIComponent(preflight.preflightId)}&sourceId=${slot.id}`}
                      />
                    )}
                  </div>
                ) : null}
              </label>
            );
          })}
        </div>
        <div className="monitoring">
          <strong>Confidence monitoring</strong>
          {["ALL", ...sources().map((_, index) => `CH${index + 1}`)].map(
            (value) => (
              <button
                type="button"
                className={monitor === value ? "active" : ""}
                onClick={() => setMonitor(value)}
                key={value}
              >
                {value}
              </button>
            ),
          )}
        </div>
        <div className="live-actions">
          {!session && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !mic || (Boolean(meeting) && mic === meeting)}
              onClick={() => void beginTest()}
            >
              {busy
                ? "Capturing each source…"
                : preflight
                  ? "Test again"
                  : "Test the microphone first (optional)"}
            </button>
          )}
          {tested && (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
            >
              I heard the test recording{sources().length > 1 ? "s" : ""}
            </button>
          )}
          {confirmed && (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void arm()}
            >
              Arm local recording
            </button>
          )}
          {armed && !session && (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void start()}
            >
              Go On the Record
            </button>
          )}
          {recording && (
            <button
              className="danger-button"
              type="button"
              disabled={busy}
              onClick={() => void stop()}
            >
              Stop and finalize recordings
            </button>
          )}
        </div>
        {session && !recording && (
          <div className="live-finalized">
            <strong>Local recording {session.state.toLowerCase()}</strong>
            <label className="rename-recording">
              <span>Name this recording</span>
              <input
                defaultValue={label}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next && next !== label) {
                    setLabel(next);
                    void rename(session.sessionId, next);
                  }
                }}
                placeholder="Tues AM Horton — James"
              />
            </label>
            {session.sources.map((source) => (
              <p key={source.id}>
                {source.deviceName}:{" "}
                {source.artifact?.finalized
                  ? `${source.artifact.bytes?.toLocaleString()} bytes · SHA-256 ${source.artifact.sha256?.slice(0, 12)}…`
                  : "Not finalized"}
              </p>
            ))}
            <div className="live-handoff">
              {deposition && registeredUploads.length === 0 && <button
                className="primary-button"
                type="button"
                disabled={busy}
                onClick={() => void addToDeposition()}
              >
                Retry attaching these recordings
              </button>}
              {handoff && <p className="live-handoff-result">{handoff}</p>}
              {deposition && registeredUploads.length > 0 && <button className="primary-button" type="button" disabled={busy} onClick={()=>void createWorkingTranscript()}>
                {busy && transcriptProgress ? transcriptProgress : "Create Working Transcript"}
              </button>}
              {transcriptProgress && !busy && <p className="live-handoff-result" role="status">{transcriptProgress}</p>}
            </div>
            {/* Read-back: find a moment and play the audio. The text is an index into the recording, not
          a transcript of it, so a misheard word the reporter can still place has done its job.
          One channel at a time, because a read-back is one person saying one thing -- and because
          a hit found in one channel cannot position playback in another, the offset between them
          having never been measured. */}
            <div className="live-read-back">
              <h3>Read-back</h3>
              <p className="live-read-back-note">
                Search the live index to find a moment, then play the recording.
                Playback starts a few seconds early so the context settles the
                word. The index is an aid; the recording is the record.
              </p>
              <div className="live-read-back-controls">
                <label htmlFor="read-back-channel">Channel</label>
                <select
                  id="read-back-channel"
                  value={channel}
                  onChange={(event) => {
                    setChannel(event.target.value);
                    setHits(null);
                  }}
                >
                  <option value="">Choose a channel</option>
                  {session.sources
                    .filter((source) => source.artifact?.finalized)
                    .map((source) => (
                      <option value={source.id} key={source.id}>
                        {source.role.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
                <label htmlFor="read-back-query">Words to find</label>
                <input
                  id="read-back-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="a few words you remember"
                />
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy || !channel || !query.trim()}
                  onClick={() => void search()}
                >
                  Find
                </button>
              </div>
              {hits &&
                (hits.length ? (
                  <ul className="live-read-back-hits">
                    {hits.map((hit) => (
                      <li key={hit.eventId}>
                        <p>{hit.text}</p>
                        {hit.positionable ? (
                          /* The adjacent read-back text is the transcript for this clip. */
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <audio
                            controls
                            preload="none"
                            crossOrigin="anonymous"
                            src={`${API}/api/live-capture/channel-audio?depositionId=${encodeURIComponent(openDepositionId)}&sessionId=${encodeURIComponent(session.sessionId)}&channelId=${encodeURIComponent(hit.channelId)}#t=${hit.playFromSeconds}`}
                          />
                        ) : (
                          <span>
                            This moment could not be positioned in the
                            recording.
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Nothing in this channel matched.</p>
                ))}
            </div>
          </div>
        )}
        {!recording &&
          unassigned.filter((item) => !item.assignedDepositionId).length > 0 && (
            <div className="unassigned-sessions">
              <h3>Recordings not yet attached to a case</h3>
              <p className="unassigned-note">
                The audio is saved and hashed. Attaching it moves it into the
                deposition and verifies it arrived intact.
              </p>
              <select
                aria-label="Deposition to attach to"
                value={assignTo}
                onChange={(event) => setAssignTo(event.target.value)}
              >
                <option value="">Choose a deposition</option>
                {library.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.witness} — {item.caseStyle}
                  </option>
                ))}
              </select>
              <ul>
                {unassigned
                  // Nothing reading RECORDING is filtered out any more. Hiding them was how a live
                  // recording became unreachable: the screen that started it had lost it on a
                  // reload, and the one list that would have shown it excluded it by state. A
                  // reporter on another machine, or after a crash, had no path back to their own
                  // audio. This block is that path -- and the whole block is already hidden while
                  // this client is the one recording, so a reattached session is never listed twice.
                  .filter((item) => !item.assignedDepositionId)
                  .map((item) => {
                    const stillRecording =
                      item.state === "RECORDING" && item.running;
                    const interrupted =
                      item.state === "RECORDING" && !item.running;
                    return (
                      <li key={item.sessionId}>
                        <strong>{item.label ?? item.sessionId}</strong>
                        <span>
                          {new Date(item.createdAt).toLocaleString()} ·{" "}
                          {stillRecording
                            ? "recording now on this computer"
                            : interrupted
                            ? "interrupted before it was finalized"
                            : `${
                                item.channels.filter(
                                  (channel) => channel.state === "FINALIZED",
                                ).length
                              } channel(s)`}
                        </span>
                        {stillRecording ? (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void stopSession(item.sessionId)}
                          >
                            Stop this recording
                          </button>
                        ) : interrupted ? (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void recover(item.sessionId)}
                          >
                            Finalize this recording
                          </button>
                        ) : (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy || !assignTo}
                            onClick={() => void assign(item.sessionId)}
                          >
                            Attach to this deposition
                          </button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}
        <div className="deepgram-readiness">
          <p>
            Deepgram Live: {live ? live.state.toLowerCase() : "not connected"} ·
            Does not block local recording
          </p>
          {recording && (!live || live.state === "CLOSED") && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void startLive()}
            >
              Connect Deepgram Live
            </button>
          )}
          {live && live.state !== "CLOSED" && (
            <>
              <p className="live-aid-notice">
                Live text is an aid for finding a moment in the audio. The local
                recording is the record; this text is never written to the
                transcript.
              </p>
              <ul className="live-channels">
                {live.channels.map((channel) => (
                  <li key={channel.id}>
                    {channel.role.replaceAll("_", " ")}:{" "}
                    {channel.connectionState.toLowerCase()}
                  </li>
                ))}
              </ul>
              <div
                className="live-transcript"
                ref={scroller}
                aria-live="polite"
                aria-label="Live transcript aid"
                onScroll={(event) => {
                  const node = event.currentTarget;
                  setFollowing(
                    node.scrollHeight - node.scrollTop - node.clientHeight < 40,
                  );
                }}
              >
                {groupLiveEvents(live.finalizedEvents ?? [])
                  .slice(-60)
                  .map((paragraph) => (
                    <article className="live-turn" key={paragraph.id}>
                      {paragraph.voice && <h4>{paragraph.voice}</h4>}
                      <p>{paragraph.text}</p>
                    </article>
                  ))}
                {Object.values(live.interimByChannel ?? {}).map((item) =>
                  item?.transcript ? (
                    <article className="live-turn interim" key={item.id}>
                      <p>{item.transcript}</p>
                    </article>
                  ) : null,
                )}
                {!(live.finalizedEvents ?? []).length && (
                  <p className="live-waiting">
                    Listening. Text appears a few seconds behind the speech.
                  </p>
                )}
              </div>
              {!following && (
                <button
                  className="secondary-button scroll-to-bottom"
                  type="button"
                  onClick={() => setFollowing(true)}
                >
                  Scroll to bottom
                </button>
              )}
            </>
          )}
          {live?.errors?.length ? (
            <p className="analysis-error" role="alert">
              Deepgram reported {live.errors.length} error
              {live.errors.length === 1 ? "" : "s"}. The local recording is
              unaffected.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
