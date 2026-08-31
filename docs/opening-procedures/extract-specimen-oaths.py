"""Regenerates specimen-oath-extraction.txt and verifies it against the findings that cite it.

The extraction is evidence. A regenerated file silently standing in for the original is a
substitution that is invisible later, so this script does two separate checks and reports them
separately:

  STRING MATCH  -- do the exact strings recorded in F-12 through F-17 still appear?
  OFFSET DRIFT  -- do they appear at the same byte offsets as the 2026-08-29 original?

String match failing means a finding is now wrong.
Offset drift alone means a source .docx was touched; the findings' text still holds but the
offsets printed in the extraction file no longer address the same bytes as the original.

Source .docx files are read from SOURCE_DIR. Output is written next to this script, in the repo.
"""
import zipfile, re, glob, io, os

SOURCE_DIR = r"C:\Users\james\Downloads"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_NAME = "specimen-oath-extraction.txt"

CANON = ["Baier_Jennifer_Deposition_2026-05-04.docx",
         "Etminan_Mohammad_Deposition_2026-04-24.docx",
         "Thomas_Heath_Deposition_2026-04-30.docx"]

# Offsets printed by the original 2026-08-29 run, before the Downloads file was removed.
BASELINE_OFFSETS = {
    "Baier_Jennifer_Deposition_2026-05-04.docx":
        {"OATH_COLLOQUY": 1046, "OATH_RESPONSE": 1161, "SETUP_LINE": 1305, "EXAM_HEADING": 1345, "STIPULATION": 604},
    "Etminan_Mohammad_Deposition_2026-04-24.docx":
        {"OATH_COLLOQUY": 1215, "OATH_RESPONSE": 1328, "SETUP_LINE": 1456, "EXAM_HEADING": 1496, "STIPULATION": 708},
    "Thomas_Heath_Deposition_2026-04-30.docx":
        {"OATH_COLLOQUY": 1193, "SETUP_LINE": 1564, "EXAM_HEADING": 1604, "STIPULATION": 656},
}

# Exact strings as recorded in the findings. Each entry: (finding, description, predicate).
OATH_CANONICAL = "Do you solemnly swear to tell the truth, the whole truth, and nothing but the truth, so help you God?"
OATH_VARIANT = "Do you solemnly swear to tell the truth, the whole truth, and nothing but the truth so help you God?"
STIPULATION_STRINGS = {
    "Baier_Jennifer_Deposition_2026-05-04.docx": "who you're representing, and the name of the city you're currently in",
    "Etminan_Mohammad_Deposition_2026-04-24.docx": "who you're representing, and the name of the city you are currently in",
    "Thomas_Heath_Deposition_2026-04-30.docx": "who you're representing, the name of the city you are currently in",
}
PARENTHETICAL_FILES = ["Dr_Etminan_Transcript.docx", "Dr_Etminan_Transcripttest.docx",
                       "Thomas_Deposition_Thursday April 30 2026.docx"]
VARIANT_FILES = ["Heath_Thomas_Current_DEPO_PRO_Export.docx", "Thomas_Deposition_Thursday April 30 2026.docx"]

PATS = {
    "OATH_COLLOQUY": r"raise your right hand.{0,400}?(?:so help you God[?.]?)",
    "OATH_RESPONSE":  r"so help you God[?.]?\s*(.{0,80}?)(?=\n|THE REPORTER)",
    "SETUP_LINE":     r"having been first duly sworn.{0,120}?(?:as follows:)",
    "EXAM_HEADING":   r"(?:as follows:)\s*\n?\s*((?:FURTHER |DIRECT |CROSS )?EXAMINATION)",
    "STIPULATION":    r"state your agreement for this remote deposition.{0,260}?(?=\n|MR\.|MS\.)",
    "PARENTHETICAL":  r"\((?:The witness was sworn|Interpreter sworn|The witness was affirmed)[^)]*\)",
    "CERT_LINE":      r"That the witness,.{0,200}?was duly sworn.{0,160}?(?:witness;)",
    "AFFIRM_WORD":    r"\baffirm(?:ed|ation|s)?\b",
}

os.chdir(SOURCE_DIR)


def text(f):
    with zipfile.ZipFile(f) as z:
        xml = z.read("word/document.xml").decode("utf8", "replace")
    xml = re.sub(r"</w:p>", "\n", xml)
    t = re.sub(r"<[^>]+>", "", xml)
    t = (t.replace("&apos;", "'").replace("&quot;", '"')
          .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"))
    return re.sub(r"[ \t]+", " ", t)


files = [f for f in sorted(glob.glob("*.docx")) if not os.path.basename(f).startswith("~$")]
files = [f for f in files if re.search(r"etminan|thomas|baier", f, re.I)]
TEXTS = {f: text(f) for f in files}

out = io.StringIO()
w = out.write
w("SPECIMEN OATH EXTRACTION\n")
w("Sources: .docx word/document.xml, tags stripped, whitespace collapsed, no normalisation.\n")
w("Cited by findings F-12 through F-17.\n")
w("REGENERATED 2026-08-29. The 2026-08-29 original was removed from Downloads before this run.\n")
w("Verification of this regeneration against the findings is in PART 4.\n")
w("=" * 100 + "\n")

found_offsets = {}


def dump(f, label):
    t = TEXTS[f]
    w("\n" + "#" * 100 + "\n%s\n  file: %s\n  chars: %d\n" % (label, f, len(t)))
    for k, p in PATS.items():
        ms = list(re.finditer(p, t, re.I | re.S))
        if not ms:
            w("\n  [%s] -- ABSENT --\n" % k)
            continue
        found_offsets.setdefault(f, {}).setdefault(k, ms[0].start())
        seen = set()
        for m in ms:
            g = m.group(1) if (m.groups() and k in ("OATH_RESPONSE", "EXAM_HEADING")) else m.group(0)
            g = re.sub(r"\s+", " ", g).strip()
            if g in seen:
                continue
            seen.add(g)
            w("\n  [%s] offset %d\n    %s\n" % (k, m.start(), g))


w("\n\n" + "*" * 100 + "\nPART 1 - THE THREE CANONICAL SPECIMENS\n" + "*" * 100 + "\n")
for f in CANON:
    dump(f, "CANONICAL") if f in TEXTS else w("\n!! MISSING: %s\n" % f)

w("\n\n" + "*" * 100 + "\nPART 2 - WORD-FOR-WORD COMPARISON OF THE OATH SENTENCE\n" + "*" * 100 + "\n")
oaths = {}
for f in files:
    m = re.search(r"Do you solemnly swear.{0,200}?so help you God[?.]?", TEXTS[f], re.I | re.S)
    if m:
        oaths.setdefault(re.sub(r"\s+", " ", m.group(0)).strip(), []).append(f)
w("\nDistinct oath sentences across %d files: %d\n" % (len(files), len(oaths)))
for i, (k, v) in enumerate(sorted(oaths.items(), key=lambda x: -len(x[1])), 1):
    w("\n--- VARIANT %d (%d file(s)) ---\n%s\n" % (i, len(v), k))
    for f in v:
        w("      %s%s\n" % (f, " <-- CANONICAL" if f in CANON else ""))

w("\n\n" + "*" * 100 + "\nPART 3 - ALL OTHER COPIES\n" + "*" * 100 + "\n")
for f in files:
    if f not in CANON:
        dump(f, "NON-CANONICAL")

# ------------------------------------------------------------------ PART 4
strings = []


def chk(finding, desc, ok):
    strings.append((finding, desc, bool(ok)))


chk("F-12", "oath string identical in all three canonical", all(OATH_CANONICAL in TEXTS[f] for f in CANON))
chk("F-12", "17 of 21 files carry the canonical oath", max((len(v) for v in oaths.values()), default=0) == 17)
chk("F-12", "preamble 'raise your right hand, ma'am?' in Baier", "raise your right hand, ma'am?" in TEXTS[CANON[0]])
chk("F-12", "preamble 'raise your right hand, sir?' in Etminan+Thomas",
    all("raise your right hand, sir?" in TEXTS[f] for f in CANON[1:]))
chk("F-12", "response 'MR. ETMINAN: I do.'", "MR. ETMINAN: I do." in TEXTS[CANON[1]])
chk("F-12", "response 'MS. BAIER: Yes, ma'am.'", "MS. BAIER: Yes, ma'am." in TEXTS[CANON[0]])
chk("F-13", "comma-dropped variant in exactly 2 files", len(oaths.get(OATH_VARIANT, [])) == 2)
chk("F-13", "both variant files are the two named", sorted(oaths.get(OATH_VARIANT, [])) == sorted(VARIANT_FILES))
chk("F-13", "ASR export carries 'SPEAKER 0:' inline", "SPEAKER 0:" in TEXTS.get(VARIANT_FILES[0], ""))
chk("F-13", "ASR export has no setup line",
    "having been first duly sworn" not in TEXTS.get(VARIANT_FILES[0], ""))
for f, s in STIPULATION_STRINGS.items():
    chk("F-14", "stipulation variant in %s" % f.split("_")[0], s in TEXTS[f])
chk("F-14", "the three stipulation variants are distinct", len(set(STIPULATION_STRINGS.values())) == 3)
chk("F-15", "parenthetical present in the 3 named non-canonical files",
    all("(The witness was sworn" in TEXTS.get(f, "") for f in PARENTHETICAL_FILES))
chk("F-15", "parenthetical absent from all three canonical",
    not any(re.search(PATS["PARENTHETICAL"], TEXTS[f], re.I) for f in CANON))
chk("F-16", "certificate line in exactly 7 files",
    sum(1 for f in files if re.search(PATS["CERT_LINE"], TEXTS[f], re.I | re.S)) == 7)
chk("F-16", "certificate line in no canonical file",
    not any(re.search(PATS["CERT_LINE"], TEXTS[f], re.I | re.S) for f in CANON))
chk("F-16", "UFM export has cert line and setup line but no colloquy",
    ("was duly sworn by the officer" in TEXTS.get("Etminan_Deposition_Transcript_UFM.docx", "")
     and "having been first duly sworn" in TEXTS.get("Etminan_Deposition_Transcript_UFM.docx", "")
     and "raise your right hand" not in TEXTS.get("Etminan_Deposition_Transcript_UFM.docx", "")))
chk("F-17", "'affirm' absent from all 21 files",
    not any(re.search(PATS["AFFIRM_WORD"], TEXTS[f], re.I) for f in files))

drift = []
for f, base in BASELINE_OFFSETS.items():
    for k, expected in base.items():
        got = found_offsets.get(f, {}).get(k)
        drift.append((f, k, expected, got))

w("\n\n" + "*" * 100 + "\nPART 4 - VERIFICATION OF THIS REGENERATION\n" + "*" * 100 + "\n")
w("\nSTRING MATCH -- do the exact strings recorded in F-12 through F-17 still appear?\n")
w("A failure here means a finding is now wrong.\n\n")
for finding, desc, ok in strings:
    w("  [%s] %-4s %-58s %s\n" % ("PASS" if ok else "FAIL", finding, desc, ""))
w("\n  string match: %d/%d\n" % (sum(1 for _, _, o in strings if o), len(strings)))

w("\nOFFSET DRIFT -- do they appear at the same byte offsets as the 2026-08-29 original?\n")
w("A failure here means a source .docx was touched. Findings text may still hold; the offsets\n")
w("printed above no longer address the same bytes the original addressed.\n\n")
for f, k, expected, got in drift:
    status = "same" if got == expected else ("DRIFT %+d" % (got - expected) if got is not None else "NOT FOUND")
    w("  %-46s %-14s baseline %5s  now %5s  %s\n" % (f[:46], k, expected, got, status))
n_same = sum(1 for _, _, e, g in drift if g == e)
w("\n  offsets unchanged: %d/%d\n" % (n_same, len(drift)))

io.open(os.path.join(OUT_DIR, OUT_NAME), "w", encoding="utf-8").write(out.getvalue())

print("wrote %s (%d bytes)\n" % (os.path.join(OUT_DIR, OUT_NAME),
                                 os.path.getsize(os.path.join(OUT_DIR, OUT_NAME))))
print("STRING MATCH -- a failure means a finding is now wrong")
for finding, desc, ok in strings:
    print("  %-4s %-4s %s" % ("PASS" if ok else "FAIL", finding, desc))
print("  -> %d/%d" % (sum(1 for _, _, o in strings if o), len(strings)))
print("\nOFFSET DRIFT -- a failure means a source .docx was touched")
for f, k, expected, got in drift:
    if got != expected:
        print("  DRIFT %-44s %-14s %s -> %s" % (f[:44], k, expected, got))
print("  -> %d/%d offsets unchanged" % (n_same, len(drift)))
