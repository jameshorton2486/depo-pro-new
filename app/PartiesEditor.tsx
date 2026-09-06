"use client";
import { useCallback, useEffect, useState } from "react";

import { LOCAL_API_BASE_URL as API } from "./api-client";

// Recording the caption's parties after the deposition exists.
//
// writeDepositionParties has been able to do this all along and no screen called it. Manual intake
// collects parties when a deposition is created, so a deposition made from an existing recording --
// or one whose Notice extraction found none -- reached finalization with an empty parties list, a
// certified caption with nothing under PLAINTIFF or DEFENDANT, and nowhere in the application to
// put a name. That was two of the five findings blocking a real transcript.
//
// THE CONSTRAINT is the same one the Counsel Editor carries: ids are stable. partyEntry falls back
// to `party-${index + 1}` when none is supplied, so every row sends back the id it arrived with. A
// row with no id is new.
//
// The role list is the server's PARTY_ROLES, and a role outside it is refused rather than coerced --
// the caption prints these words.

type Party = { id?:string; name:string; role:string; entityType:string; captionDisplayName:string };

const BLANK:Party = { name:"", role:"", entityType:"", captionDisplayName:"" };
const PARTY_ROLES = ["", "PLAINTIFF", "DEFENDANT", "INTERVENOR", "THIRD_PARTY", "OTHER"];
const roleLabel = (role:string) => role ? role.replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase()) : "Not stated";

export default function PartiesEditor({ depositionId, onSaved }:{ depositionId:string; onSaved?:()=>void }) {
  const [parties, setParties] = useState<Party[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const read = useCallback(async () => {
    const response = await fetch(`${API}/api/deposition/parties?depositionId=${encodeURIComponent(depositionId)}`);
    return (await response.json()) as { parties:Party[] };
  }, [depositionId]);
  const apply = useCallback((roster:{ parties?:Party[] }) => {
    setParties((roster.parties ?? []).map(entry => ({ ...BLANK, ...entry })));
    setError("");
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => { const roster = await read(); if (!cancelled) apply(roster); })();
    return () => { cancelled = true; };
  }, [read, apply]);

  const edit = (index:number, patch:Partial<Party>) =>
    setParties(current => current.map((row, position) => position === index ? { ...row, ...patch } : row));

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`${API}/api/deposition/parties`, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        // Sent whole, each row carrying the id it arrived with.
        body:JSON.stringify({ depositionId, parties }),
      });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "The parties could not be saved."); return; }
      apply(await read());
      setMessage(`Saved ${body.parties?.length ?? parties.length} ${(body.parties?.length ?? parties.length) === 1 ? "party" : "parties"}.`);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="workspace-parties-editor" className="counsel-editor" aria-label="Parties">
      <p className="counsel-editor-note">
        The parties as the caption states them. These print under PLAINTIFF and DEFENDANT on the
        title page and on every certificate page, so enter them as the style of the cause has them.
      </p>

      {parties.length === 0 && <p className="counsel-editor-note">No parties are recorded for this deposition.</p>}

      {parties.map((row, index) => (
        <fieldset key={row.id ?? `new-${index}`} className="counsel-editor-row">
          <legend>{row.name || "New party"}{row.role ? ` — ${roleLabel(row.role)}` : ""}</legend>
          <label><span>Name</span>
            <input value={row.name} onChange={event => edit(index, { name:event.target.value })}
              placeholder="ROCIO LAURA ELIZONDO VARGAS" /></label>
          <label><span>Role</span>
            <select value={row.role} onChange={event => edit(index, { role:event.target.value })}>
              {PARTY_ROLES.map(role => <option key={role || "none"} value={role}>{role ? roleLabel(role) : "Select the role"}</option>)}
            </select></label>
          <label><span>Caption name</span>
            <input value={row.captionDisplayName} onChange={event => edit(index, { captionDisplayName:event.target.value })}
              placeholder="Leave empty to use the name above" /></label>
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => setParties(current => current.filter((_, position) => position !== index))}>
            Remove this party
          </button>
        </fieldset>
      ))}

      {error && <p className="counsel-editor-error" role="alert">{error}</p>}

      <div className="counsel-editor-actions">
        {message && <span className="counsel-editor-message" role="status">{message}</span>}
        <button id="workspace-add-party" type="button" className="secondary-button" disabled={busy}
          onClick={() => setParties(current => [...current, { ...BLANK }])}>Add party</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save parties"}
        </button>
      </div>
    </section>
  );
}
