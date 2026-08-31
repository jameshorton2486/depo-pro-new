import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { readDepositionCertificateWorkflow, writeDepositionCertificateWorkflow } from "../server/deposition-store.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { certifiedDate, certifiedDateValues } from "../server/insertion-pages/certified-date.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../server/insertion-pages/validate.mjs";

const ID="DEP-20260831-CW001";
function store(){const storageRoot=fs.mkdtempSync(path.join(os.tmpdir(),"depo-cert-workflow-")),directory=path.join(storageRoot,"reporter","cause","witness");fs.mkdirSync(path.join(directory,"intake"),{recursive:true});const record=createCanonicalDepositionRecord({court:"45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS",causeNumber:"2026-CI-1",witness:"Jordan Example",depositionDate:"2026-09-18",remote:true,remotePlatform:"Zoom",parties:[{name:"Alex Plaintiff",role:"Plaintiff"},{name:"Delta Company",role:"Defendant"}],attorneys:[{name:"Pat Counsel",side:"PLAINTIFF",appeared:true}],reporterProfile:{name:"Riley Reporter",licenseNumber:"1234",csrExpiration:"2027-06-30",firmRegistrationNumber:"5678",address:"300 Main",phone:"210-555-0103"}});fs.writeFileSync(path.join(directory,"deposition.json"),JSON.stringify({id:ID}));fs.writeFileSync(path.join(directory,"intake","canonical-deposition-record.json"),JSON.stringify(record));return{storageRoot,record,directory}}

test("certificate workflow dates persist with workflow-derived provenance",()=>{const s=store();writeDepositionCertificateWorkflow(null,{depositionId:ID,storageRoot:s.storageRoot,workflow:{submissionDate:"2026-09-18",returnDeadline:"2026-10-08",serviceDate:"2026-10-12"}});assert.deepEqual(readDepositionCertificateWorkflow(null,{depositionId:ID,storageRoot:s.storageRoot}).workflow,{submissionDate:"2026-09-18",returnDeadline:"2026-10-08",serviceDate:"2026-10-12"});const record=JSON.parse(fs.readFileSync(path.join(s.directory,"intake","canonical-deposition-record.json"),"utf8"));for(const field of [record.signature.submittedToWitnessDate,record.signature.dueDate,record.certification.serviceDate]){assert.equal(field.source,"WORKFLOW_DERIVED");assert.equal(field.state,"DERIVED")}});

test("certificate workflow refuses impossible and non-ISO dates",()=>{const s=store();assert.throws(()=>writeDepositionCertificateWorkflow(null,{depositionId:ID,storageRoot:s.storageRoot,workflow:{serviceDate:"August 14, 2026"}}),/YYYY-MM-DD/);assert.throws(()=>writeDepositionCertificateWorkflow(null,{depositionId:ID,storageRoot:s.storageRoot,workflow:{serviceDate:"2026-02-30"}}),/invalid/)});

test("certified dates use one deterministic projection",()=>{assert.equal(certifiedDate("2026-09-18"),"September 18, 2026");assert.equal(certifiedDate("August 14, 2026"),"August 14, 2026");assert.deepEqual(certifiedDateValues({"deposition.date":"2026-09-18","reporter.csrExpirationDate":"2027-06-30"}),{"deposition.date":"September 18, 2026","reporter.csrExpirationDate":"June 30, 2027"})});

test("missing workflow events block every certificate clause that names them",async()=>{const s=store(),template=await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED"),input=assembleInsertionInput({record:s.record,template,intake:{counselOfRecord:["Pat Counsel"]},operator:{jurisdiction:"texas-state",signatureDisposition:"requested",signatureDispositionBasis:"Stated on the record",appearances:s.record.counsel,certification:{custodialAttorney:"Pat Counsel",charges:"500",chargesResponsibleParty:"Plaintiff",certificationDate:"2026-09-18",furtherCertificationDate:"2026-10-12",returnStatus:"2026-10-01"},timeUsed:{parties:[{name:"Pat Counsel",minutes:10}]}},pagination:{index:{entries:[],actualSectionPages:{},declaredSectionPages:{},examinations:[],changesAndSignature:{startPage:2},reportersCertification:{startPage:3}}}});const targets=validateInsertionInput(input).filter(item=>item.severity==="blocking").map(item=>item.target);for(const target of ["cert.submissionDate","cert.returnDeadline","cert.serviceDate"])assert.ok(targets.includes(target),`${target} must block`)});
