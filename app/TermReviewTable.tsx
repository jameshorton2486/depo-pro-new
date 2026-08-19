"use client";
import { useMemo, useState } from "react";
import { applyTermCorrections, buildTermRows } from "@/server/keyterm-corrections.mjs";
import { KEYTERM_PRODUCT_CAP, KEYTERM_TOKEN_BUDGET } from "@/server/keyterm-limits.mjs";
import type { ClaudeIntakeAnalysis } from "./intake-types";

export type TermRow = { term:string; source:"keyterm"|"ufm"; flag:string|null; correction:string };
type Problem = { code:string; term?:string; message:string };
type Intake = ClaudeIntakeAnalysis;

export default function TermReviewTable({ intake, onSave, onCancel }:{ intake:Intake; onSave:(next:Intake)=>void; onCancel:()=>void }) {
  const initial = useMemo(()=>buildTermRows(intake) as TermRow[],[intake]);
  const [rows,setRows] = useState<TermRow[]>(initial);

  // Recomputed on every keystroke rather than on Save. The whole point of moving the cap and
  // budget checks here is that the reporter sees the ceiling while they are still typing --
  // discovering it at transcription time is the failure this replaces.
  const preview = useMemo(()=>applyTermCorrections(intake,rows) as { ok:boolean; problems:Problem[]; wire:string[]; estimatedTokens:number },[intake,rows]);
  const changed = rows.filter(row => row.correction.trim() && row.correction.trim() !== row.term).length;

  function edit(index:number, value:string) { setRows(current => current.map((row,position)=>position===index?{ ...row, correction:value }:row)); }

  return (
    <div className="term-review">
      <div className="term-review-summary">
        <span><strong>{preview.wire.length}</strong> / {KEYTERM_PRODUCT_CAP} keyterms</span>
        <span><strong>{preview.estimatedTokens}</strong> / {KEYTERM_TOKEN_BUDGET} estimated tokens</span>
        <span>{changed ? `${changed} correction${changed===1?"":"s"} pending` : "No corrections entered"}</span>
      </div>

      <p className="term-review-scope">
        Corrections here are sent to Deepgram with the audio, so the right spelling comes back in the
        first place. They do not change any transcript that already exists.
      </p>

      {preview.problems.length > 0 && (
        <ul className="term-review-problems" role="alert">
          {preview.problems.map(problem => <li key={`${problem.code}:${problem.term ?? ""}`}>{problem.message}</li>)}
        </ul>
      )}

      <div className="term-review-scroll">
        <table className="term-review-table">
          <caption className="visually-hidden">Extracted terms with an optional correction for each</caption>
          <thead>
            <tr><th scope="col">Term</th><th scope="col">Source</th><th scope="col">Correction</th><th scope="col">Flag</th></tr>
          </thead>
          <tbody>
            {rows.map((row,index)=>(
              <tr key={`${row.source}:${row.term}`} className={row.flag?"flagged":undefined}>
                <th scope="row">{row.term}</th>
                <td>{row.source === "keyterm" ? "Deepgram keyterm" : "UFM term"}</td>
                <td>
                  {/* The label names the term being corrected, not just "Correction" -- a screen
                      reader moving between inputs otherwise hears the same word every row. */}
                  <label className="visually-hidden" htmlFor={`term-correction-${index}`}>Correction for {row.term}</label>
                  <input
                    id={`term-correction-${index}`}
                    type="text"
                    value={row.correction}
                    placeholder="leave blank if correct"
                    onChange={event=>edit(index,event.target.value)}
                  />
                </td>
                <td className="term-review-flag">{row.flag ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={!preview.ok}
          onClick={()=>{ const result = applyTermCorrections(intake,rows); if (result.ok) onSave(result.intake); }}
        >
          {changed ? "Save corrections" : "Done reviewing"}
        </button>
      </div>
    </div>
  );
}
