"use client";

import { logisticsFields } from "./intake-logistics.mjs";

const futureSections=[
  ["Counsel & appearances","Attorney attendance and remote participation are confirmed at the deposition."],
  ["Interpreter, videographer & others","Actual participants and interpreter language are confirmed during the proceeding."],
  ["Examinations & indexes","Examinations, page references, requested information, and certified questions are transcript-derived."],
  ["Exhibits","Offering party, marked/admitted status, page, volume, disposition, and custody are transcript-derived and reporter-confirmed."],
  ["Signature & errata","Signature status, return deadlines, and changes are established during and after the deposition."],
  ["Certification","Custodial attorney, time used, charges, service, filing, and the Rule 203 variant are completed after the deposition."],
];

function object(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{}}
function text(value:unknown){return typeof value==="string"?value:""}
export default function CanonicalDataSheet({seed}:{seed?:Record<string,unknown>}){
  // Mapped, not read raw: the form's key names and the extractor's are different vocabularies,
  // and reading `logistics.platform` when the extractor writes `remote_platform` is why a Notice
  // that stated all of this produced a blank screen. See intake-logistics.mjs for what is
  // deliberately not mapped -- remote, videotaped and time_zone have no extractor counterpart and
  // stay MISSING rather than being inferred from prose.
  const mapped=logisticsFields(seed),caption=object(seed?.caption);
  return <section className="canonical-data-sheet">
    <header><div><span className="eyebrow">CANONICAL DEPOSITION DATA RECORD</span><h3>Reporter Data Sheet</h3></div><span className="data-sheet-phase">Before deposition</span></header>
    <p>Review extracted fields now. Items marked incomplete are intentionally supplied by the reporter, transcript, or workflow later.</p>
    <details open><summary>Case and court <span className="field-state extracted">Extracted</span></summary><div className="data-sheet-grid">
      <label>Court<input name="canonicalCourt" defaultValue={text(seed?.court)||text(caption.court)}/></label>
      <label>District<input name="canonicalDistrict" defaultValue={text(caption.district)}/></label>
      <label>Division<input name="canonicalDivision" defaultValue={text(caption.division)}/></label>
      <label>County<input name="canonicalCounty" defaultValue={text(caption.county)}/></label>
    </div></details>
    <details open><summary>Deposition method and schedule <span className="field-state review">Review</span></summary><div className="data-sheet-grid">
      <label>Scheduled start<input name="canonicalScheduledStart" type="time" defaultValue={mapped.scheduledStart??""}/></label>
      <label>Time zone<input name="canonicalTimeZone" defaultValue={text(seed?.timeZone)}/></label>
      <label>Location<input name="canonicalLocation" defaultValue={mapped.location??""}/></label>
      <label>Remote platform<input name="canonicalRemotePlatform" defaultValue={mapped.remotePlatform??""} placeholder="Zoom, Teams, etc."/></label>
      <label className="data-sheet-check"><input name="canonicalRemote" type="checkbox" /> Remote</label>
      <label className="data-sheet-check"><input name="canonicalVideotaped" type="checkbox" /> Videotaped</label>
      <label className="data-sheet-check"><input name="canonicalInterpreted" type="checkbox" /> Interpreted</label>
      <label className="data-sheet-check"><input name="canonicalCorporateRepresentative" type="checkbox"/> Corporate representative</label>
    </div></details>
    {futureSections.map(([title,note])=><details key={title}><summary>{title} <span className="field-state missing">Incomplete</span></summary><p>{note}</p></details>)}
  </section>
}
