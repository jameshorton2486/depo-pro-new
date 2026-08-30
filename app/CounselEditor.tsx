"use client";
import { useCallback, useEffect, useState } from "react";

import { LOCAL_API_BASE_URL as API } from "./api-client";
import { COUNSEL_SIDES, counselSidePhrase } from "./manual-intake.mjs";

// Correcting counsel after the deposition exists.
//
// writeDepositionCounsel has been able to do this all along and no screen called it, so a
// misspelled name entered at intake stayed misspelled, and counsel who turned up unannounced could
// not be added at all. This is that screen, next to speaker reconciliation because that is where a
// reporter is already looking at who was in the room -- not a separate participant application.
//
// THE CONSTRAINT: ids are stable. counselEntry falls back to `attorney-${index + 1}` when none is
// supplied, so every row carries its id back untouched. Drop it and counsel are renumbered by
// position: the examiner id in the assembly and every speaker mapping then point at something that
// no longer exists, while the save looks entirely successful and the name updates on screen. A new
// row has no id and is meant not to -- the server assigns it.
type Counsel = {
  id?:string; name:string; honorific:string; firm:string; represents:string[];
  appearanceRole:string; side:string; sideOther:string; actualAppearance:boolean|null;
};
export type CounselSpeakerOption = { key:string; label:string };
const BLANK:Counsel = { name:"", honorific:"", firm:"", represents:[], appearanceRole:"", side:"", sideOther:"", actualAppearance:true };
const APPEARANCE_ROLES = ["", "QUESTIONING_ATTORNEY", "DEFENDING_ATTORNEY"];
const roleLabel = (role:string) => role ? role.replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase()) : "Not stated";

export default function CounselEditor({ depositionId, onSaved, speakerOptions=[], speakerAssignmentForCounsel, onSpeakerAssignment }:{ depositionId:string; onSaved?:()=>void; speakerOptions?:CounselSpeakerOption[]; speakerAssignmentForCounsel?:(counselId:string)=>string; onSpeakerAssignment?:(counselId:string,bucketKey:string,transcriptRole:string)=>void }) {
  const [counsel, setCounsel] = useState<Counsel[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const read = useCallback(async () => {
    const response = await fetch(`${API}/api/deposition/counsel?depositionId=${encodeURIComponent(depositionId)}`);
    return (await response.json()) as { counsel:Counsel[] };
  }, [depositionId]);
  const apply = useCallback((roster:{ counsel?:Counsel[] }) => {
    setCounsel((roster.counsel ?? []).map(entry => ({ ...BLANK, ...entry })));
    setError("");
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => { const roster = await read(); if (!cancelled) apply(roster); })();
    return () => { cancelled = true; };
  }, [read, apply]);

  const edit = (index:number, patch:Partial<Counsel>) =>
    setCounsel(current => current.map((row, position) => position === index ? { ...row, ...patch } : row));

  // Changing away from OTHER drops its wording, the same rule the intake form follows.
  const chooseSide = (index:number, side:string) =>
    edit(index, { side, sideOther: side === "OTHER" ? counsel[index].sideOther : "" });

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`${API}/api/deposition/counsel`, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        // Sent whole, each row carrying the id it arrived with. A row with no id is new.
        body:JSON.stringify({ depositionId, counsel }),
      });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "The counsel could not be saved."); return; }
      apply(await read());
      setMessage(`Saved ${body.counsel?.length ?? counsel.length} counsel.`);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="workspace-counsel-editor" className="counsel-editor" aria-label="Counsel">
      <p className="counsel-editor-note">
        Corrections here reach the canonical record as the reporter&rsquo;s own, and keep each
        attorney&rsquo;s identity: the examining attorney and the speaker map both refer to it.
      </p>

      {counsel.map((row, index) => (
        <fieldset className="counsel-editor-row" key={row.id ?? `new-${index}`}>
          <legend>{row.id ?? "New counsel"}</legend>
          <div className="form-row">
            <label>Honorific<input value={row.honorific} onChange={event => edit(index, { honorific:event.target.value })} placeholder="Ms." /></label>
            <label>Name<input value={row.name} onChange={event => edit(index, { name:event.target.value })} placeholder="Pat Counsel" /></label>
            <label>Firm<input value={row.firm} onChange={event => edit(index, { firm:event.target.value })} placeholder="Plaintiff Firm" /></label>
          </div>
          <div className="form-row">
            <label>Represents<input value={row.represents.join(", ")}
              onChange={event => edit(index, { represents:event.target.value.split(",").map(part => part.trim()).filter(Boolean) })}
              placeholder="Alex Plaintiff" /></label>
            <label>Appears for
              <select value={row.side} onChange={event => chooseSide(index, event.target.value)}>
                <option value="">Select the side</option>
                {(COUNSEL_SIDES as readonly string[]).map(option =>
                  <option key={option} value={option}>{counselSidePhrase(option) ?? "Other"}</option>)}
              </select>
            </label>
            <label>Examination role
              <select value={row.appearanceRole} onChange={event => {const appearanceRole=event.target.value;edit(index, { appearanceRole });if(row.id&&speakerAssignmentForCounsel?.(row.id))onSpeakerAssignment?.(row.id,speakerAssignmentForCounsel(row.id),appearanceRole)}}>
                {APPEARANCE_ROLES.map(role => <option key={role || "none"} value={role}>{roleLabel(role)}</option>)}
              </select>
            </label>
            <label>Deepgram speaker
              <select value={row.id?speakerAssignmentForCounsel?.(row.id)??"":""} disabled={!row.id}
                onChange={event=>{if(row.id)onSpeakerAssignment?.(row.id,event.target.value,row.appearanceRole)}}>
                <option value="">Unassigned</option>
                {speakerOptions.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
          </div>
          {row.id&&speakerOptions.length>0&&<small className="counsel-speaker-hint">This updates the speaker-map draft. Save the speaker map below after reviewing every person.</small>}
          {row.side === "OTHER" && (
            <label>How this appearance prints after the word FOR
              <input value={row.sideOther} onChange={event => edit(index, { sideOther:event.target.value })} placeholder="THE GUARDIAN AD LITEM" /></label>
          )}
          <label className="counsel-editor-appeared">
            <input type="checkbox" checked={row.actualAppearance !== false}
              onChange={event => edit(index, { actualAppearance:event.target.checked })} />
            Appeared at this deposition
          </label>
        </fieldset>
      ))}

      {error && <p className="counsel-editor-error" role="alert">{error}</p>}

      <div className="counsel-editor-actions">
        {message && <span className="counsel-editor-message" role="status">{message}</span>}
        <button id="workspace-add-missing-counsel" type="button" className="secondary-button" disabled={busy}
          onClick={() => setCounsel(current => [...current, { ...BLANK }])}>Add counsel</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save counsel"}
        </button>
      </div>
    </section>
  );
}
