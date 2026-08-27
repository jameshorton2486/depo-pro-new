"use client";
import { useState, type KeyboardEvent } from "react";
import { DEPONENT_TYPES } from "./intake-logistics.mjs";
import { COUNSEL_SIDES, MANUAL_REQUIRED_FIELDS, counselSidePhrase } from "./manual-intake.mjs";

export type ManualAttorney = { name:string; firm:string; represents:string; side:string; sideOther:string };
export type ManualParty = { name:string; role:string };
export type ManualFields = {
  caseStyle:string; witness:string; causeNumber:string; depositionDate:string; deponentType:string;
  attorneys:ManualAttorney[]; parties:ManualParty[];
};

const EMPTY:ManualFields = {
  caseStyle:"", witness:"", causeNumber:"", depositionDate:"", deponentType:"",
  attorneys:[{ name:"", firm:"", represents:"", side:"", sideOther:"" }],
  parties:[{ name:"", role:"" }],
};

// Counsel are collected as rows, not as a block of prose, because the examiner on the complete
// transcript is stored as a canonical counsel id. Counsel typed as a sentence would leave
// examiner selection with nothing to reference and the certified index with nothing to print.
export default function ManualIntakeForm({ onReady, onCancel }:{ onReady:(fields:ManualFields)=>void; onCancel:()=>void }) {
  const [fields,setFields] = useState<ManualFields>(EMPTY);
  // Marking waits for a submit attempt. aria-invalid is true for an empty required field from
  // first render, which was invisible until the sheet gave it a border -- and then the panel
  // opened with all five required fields already marked as errors, before the reporter had typed
  // anything. A form that accuses on open is telling the reporter they got something wrong
  // before they did anything at all.
  const [attempted,setAttempted] = useState(false);
  const set = <K extends keyof ManualFields>(key:K, value:ManualFields[K]) => setFields(current => ({ ...current, [key]:value }));
  const required = new Set(MANUAL_REQUIRED_FIELDS.map((field:{key:string}) => field.key));
  const missing = (key:string) => attempted && required.has(key) && !String(fields[key as keyof ManualFields] ?? "").trim();

  const editAttorney = (index:number, key:keyof ManualAttorney, value:string) =>
    set("attorneys", fields.attorneys.map((row,position) => position===index ? { ...row, [key]:value } : row));
  // Enter is bound to the fields rather than to the panel, and the panel cannot be a <form> of its
  // own: it renders inside IntakeScreen's form (IntakeScreen.tsx:360), a nested form is dropped by
  // the parser, and a type="submit" button would fire the OUTER form -- advancing to Deposition
  // Setup with these fields incomplete, which is what implicit submission already did here.
  // Binding to the fields and not the panel also leaves Enter on Add counsel and Add party alone,
  // where it must still press the button.
  const attempt = () => { setAttempted(true); onReady(fields); };
  const submitOnEnter = (event:KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    attempt();
  };
  // Changing away from Other drops its wording with it. Left behind, it would be a value the
  // reporter had abandoned sitting on a row bound for a certified page.
  const chooseSide = (index:number, value:string) =>
    set("attorneys", fields.attorneys.map((row,position) => position===index
      ? { ...row, side:value, sideOther: value==="OTHER" ? row.sideOther : "" } : row));
  const editParty = (index:number, key:keyof ManualParty, value:string) =>
    set("parties", fields.parties.map((row,position) => position===index ? { ...row, [key]:value } : row));

  return (
    <section className="manual-intake" aria-label="Manual deposition entry">
      <h3>Enter the deposition details</h3>
      <p className="manual-intake-note">
        These become the canonical record, attributed to you. Keyterms are derived from the names
        below; case terminology a Notice would have supplied is not recovered, and can be added in
        the term review table.
      </p>

      <div className="form-row">
        <label>Case style<input value={fields.caseStyle} aria-invalid={missing("caseStyle")} onKeyDown={submitOnEnter} onChange={event=>set("caseStyle",event.target.value)} placeholder="Alex Plaintiff v. Delta Company" /></label>
        <label>Cause number<input value={fields.causeNumber} aria-invalid={missing("causeNumber")} onKeyDown={submitOnEnter} onChange={event=>set("causeNumber",event.target.value)} placeholder="2026-CI-10001" /></label>
      </div>
      <div className="form-row">
        <label>Witness<input value={fields.witness} aria-invalid={missing("witness")} onKeyDown={submitOnEnter} onChange={event=>set("witness",event.target.value)} placeholder="Full name of the deponent" /></label>
        <label>Deposition date<input type="date" value={fields.depositionDate} aria-invalid={missing("depositionDate")} onKeyDown={submitOnEnter} onChange={event=>set("depositionDate",event.target.value)} /></label>
      </div>
      <label>Deponent type
        <select value={fields.deponentType} aria-invalid={missing("deponentType")} onKeyDown={submitOnEnter} onChange={event=>set("deponentType",event.target.value)}>
          {/* No default selection. A deponent type nobody stated is unanswered, not a fact witness. */}
          <option value="">Select the deponent type</option>
          {(DEPONENT_TYPES as readonly string[]).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>

      <fieldset className="manual-intake-rows">
        <legend>Counsel</legend>
        {fields.attorneys.map((attorney,index)=>(
          <div className="form-row" key={index}>
            <label>Name<input value={attorney.name} onKeyDown={submitOnEnter} onChange={event=>editAttorney(index,"name",event.target.value)} placeholder="Pat Counsel" /></label>
            <label>Firm<input value={attorney.firm} onKeyDown={submitOnEnter} onChange={event=>editAttorney(index,"firm",event.target.value)} placeholder="Plaintiff Firm" /></label>
            <label>Represents<input value={attorney.represents} onKeyDown={submitOnEnter} onChange={event=>editAttorney(index,'represents',event.target.value)} placeholder='Alex Plaintiff' /></label>
            {/* The party NAMES this attorney appears for. The side is the separate field below:
                one is who, the other is which side, and the appearance page needs both. */}
            <label>Appears for<select value={attorney.side} onKeyDown={submitOnEnter} onChange={event=>chooseSide(index,event.target.value)}>
              <option value="">Select the side</option>
              {(COUNSEL_SIDES as readonly string[]).map(option => <option key={option} value={option}>{counselSidePhrase(option) ?? "Other"}</option>)}
            </select></label>
            {attorney.side==="OTHER" && (
              <label>How this appearance prints after the word FOR<input value={attorney.sideOther} onKeyDown={submitOnEnter} onChange={event=>editAttorney(index,"sideOther",event.target.value)} placeholder="THE GUARDIAN AD LITEM" /></label>
            )}
          </div>
        ))}
        <button type="button" className="secondary-button" onClick={()=>set("attorneys",[...fields.attorneys,{ name:"", firm:"", represents:"", side:"", sideOther:"" }])}>Add counsel</button>
      </fieldset>

      <fieldset className="manual-intake-rows">
        <legend>Parties</legend>
        {fields.parties.map((party,index)=>(
          <div className="form-row" key={index}>
            <label>Name<input value={party.name} onKeyDown={submitOnEnter} onChange={event=>editParty(index,"name",event.target.value)} placeholder="Alex Plaintiff" /></label>
            <label>Role<input value={party.role} onKeyDown={submitOnEnter} onChange={event=>editParty(index,"role",event.target.value)} placeholder="Plaintiff" /></label>
          </div>
        ))}
        <button type="button" className="secondary-button" onClick={()=>set("parties",[...fields.parties,{ name:"", role:"" }])}>Add party</button>
      </fieldset>

      <div className="manual-intake-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        {/* Not disabled on incomplete input. A disabled control says "not yet" without saying
            which field, and the refusal message names the field. */}
        <button type="button" className="primary-button" onClick={attempt}>Use these details</button>
      </div>
    </section>
  );
}
