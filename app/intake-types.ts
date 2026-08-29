export type IntakeAttorney = {
  name:string; firm?:string; represents?:string[]; email?:string; phone?:string;
  barNumber?:string; address?:string; appearanceRole?:string; honorific?:string|null;
};

export type KeytermEntry = { term:string; tier?:number; reason?:string; source?:string; [key:string]:unknown };
export type UfmEntry = { canonical:string; category?:string; asr_variants?:string[]; rendering_rule?:string|null; spoken?:boolean; in_keyterms?:boolean; source?:string; confidence?:string; [key:string]:unknown };
export type DepositionCreationMode = "existing_recording" | "live";

export type ClaudeIntakeAnalysis = {
  caseStyle:string; witness:string; causeNumber:string; depositionDate:string; deponentType:string;
  confidence:string; warnings:string[]; keyterms:string[]; parties:string[]; attorneys:IntakeAttorney[];
  masterData:Record<string,unknown>;
  deepgramArtifact:Record<string,unknown> & { terms?:KeytermEntry[]; wire?:string[] };
  ufmData:Record<string,unknown> & { entries?:UfmEntry[]; entry_count?:number; anomalies?:unknown[]; cause_number?:string };
  [key:string]:unknown;
};
