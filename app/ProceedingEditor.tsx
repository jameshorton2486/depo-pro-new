"use client";
import { useCallback, useEffect, useState } from "react";

import { LOCAL_API_BASE_URL as API } from "./api-client";

// Where the deposition was taken, and in what court.
//
// These four have slots in the canonical record and print on the certified page, and until now no
// screen could set any of them: buildCanonicalRecord writes them at intake from a Notice, and the
// manual route has no Notice and no fields for them. A deposition created by the manual route
// could therefore never produce a complete transcript -- generation refused on caption.court and
// deposition.remote for the whole life of the record. This is the screen that was missing, next to
// the counsel editor because it is the same job: correcting the record after the deposition exists.
//
// Four rather than the two that block today, because validateDepositionMethod is a chain. Once
// `remote` has an answer it asks the follow-up -- location for in person, platform for remote -- so
// a two-field editor would clear the visible findings and immediately surface a third.
type Proceeding = { court:string; remote:boolean|null; location:string; remotePlatform:string };
const BLANK:Proceeding = { court:"", remote:null, location:"", remotePlatform:"" };
const value = (envelope:{ value?:unknown }|null|undefined) =>
  envelope && envelope.value !== null && envelope.value !== undefined ? String(envelope.value) : "";

export default function ProceedingEditor({ depositionId, onSaved }:{ depositionId:string; onSaved?:()=>void }) {
  const [form, setForm] = useState<Proceeding>(BLANK);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Read through the opening projection rather than a new read route: it already returns these
  // four by canonical path with their envelopes, and a second endpoint returning the same fields
  // is a second thing to keep in step with the record.
  const read = useCallback(async () => {
    const response = await fetch(`${API}/api/opening?depositionId=${encodeURIComponent(depositionId)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { fields?:Array<{ path:string; value?:unknown }> };
    return new Map((body.fields ?? []).map(item => [item.path, item]));
  }, [depositionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fields = await read();
      if (cancelled || !fields) return;
      const remote = fields.get("deposition.remote")?.value;
      setForm({
        court: value(fields.get("case.court")),
        remote: typeof remote === "boolean" ? remote : null,
        location: value(fields.get("deposition.location")),
        remotePlatform: value(fields.get("deposition.remotePlatform")),
      });
    })();
    return () => { cancelled = true; };
  }, [read]);

  const edit = (patch:Partial<Proceeding>) => setForm(current => ({ ...current, ...patch }));

  // Changing the method clears the answer that belonged to the other one, so a record cannot carry
  // a platform for a deposition taken in person. The same rule the intake form follows for OTHER.
  const chooseMethod = (remote:boolean|null) =>
    edit({ remote, location: remote === false ? form.location : "", remotePlatform: remote === true ? form.remotePlatform : "" });

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`${API}/api/deposition/proceeding`, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({ depositionId, proceeding:form }),
      });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "The proceeding details could not be saved."); return; }
      setMessage("Saved. Regenerate to see whether anything else is still blocking.");
      onSaved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The proceeding details could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="proceeding-editor" aria-label="Court and deposition method">
      <p className="counsel-editor-note">
        The court and how the deposition was taken. Both print on the certified pages, and
        generation is refused rather than guessing while either is unrecorded.
      </p>

      <label>Court
        <input value={form.court} onChange={event => edit({ court:event.target.value })}
          placeholder="285th Judicial District Court, Bexar County, Texas" />
      </label>

      <fieldset className="proceeding-method">
        <legend>How the deposition was taken</legend>
        {/* Three states, and "Not recorded" is a real one. A boolean defaulting to false would
            record "taken in person" because nobody answered, which is the provenance defect the
            canonical record's own header names. Unrecorded keeps blocking, which is correct. */}
        {([["In person", false], ["Remote", true], ["Not recorded", null]] as const).map(([label, option]) => (
          <label key={label}>
            <input type="radio" name="deposition-method" checked={form.remote === option}
              onChange={() => chooseMethod(option)} />
            {label}
          </label>
        ))}
      </fieldset>

      {form.remote === false && (
        <label>Where testimony was taken
          <input value={form.location} onChange={event => edit({ location:event.target.value })}
            placeholder="1200 Main Street, Suite 400, San Antonio, Texas" />
        </label>
      )}
      {form.remote === true && (
        <label>Platform
          <input value={form.remotePlatform} onChange={event => edit({ remotePlatform:event.target.value })}
            placeholder="Zoom" />
        </label>
      )}

      {error && <p className="counsel-editor-error" role="alert">{error}</p>}
      <div className="counsel-editor-actions">
        {message && <span className="counsel-editor-message" role="status">{message}</span>}
        <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save court and method"}
        </button>
      </div>
    </section>
  );
}
