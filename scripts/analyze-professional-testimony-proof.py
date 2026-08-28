from __future__ import annotations
import argparse,json,re
from pathlib import Path
import pdfplumber

def norm(value):return re.sub(r"\s+"," ",str(value).strip())
def main():
    parser=argparse.ArgumentParser();parser.add_argument("--spec",required=True);parser.add_argument("--word",required=True);parser.add_argument("--pdf",required=True);parser.add_argument("--output",required=True);args=parser.parse_args()
    spec=json.loads(Path(args.spec).read_text(encoding="utf-8"));cycle=json.loads(Path(args.word).read_text(encoding="utf-8-sig"));expected=[(p["pageNumber"],l["position"],l["text"]) for p in spec["pages"] for l in p["lines"] if l["occupied"]]
    word=cycle["after"]["placements"]
    model_word=[e for e,w in zip(expected,word) if e[0]==w["page"] and e[2]==w["text"]]
    pdf_matches=[];pdf_groups=[]
    with pdfplumber.open(args.pdf) as document:
        for page_number,page in enumerate(document.pages,1):
            words=page.extract_words(x_tolerance=1,y_tolerance=2,keep_blank_chars=False)
            rows=[]
            for item in words:
                row=next((r for r in rows if abs(r["top"]-item["top"])<=2),None)
                if row is None:row={"top":item["top"],"items":[]};rows.append(row)
                row["items"].append(item)
            texts=[norm(" ".join(item["text"] for item in sorted(row["items"],key=lambda x:x["x0"]))) for row in sorted(rows,key=lambda x:x["top"])]
            pdf_groups.append({"page":page_number,"rows":texts})
            for model_page,line,text in [e for e in expected if e[0]==page_number]:
                target=norm(text);matching=[row for row in texts if target and (row==target or row.endswith(" "+target) or row.endswith(target))]
                if matching:pdf_matches.append((model_page,line,text))
    report={"profile":spec["profile"]["id"],"modelHash":spec["modelHash"],"modelLines":len(expected),"wordPages":cycle["after"]["pages"],"wordParagraphs":cycle["after"]["paragraphs"],"modelWordExact":len(model_word),"modelPdfExact":len(pdf_matches),"wordSaveReopenStable":cycle["before"]=={**cycle["after"],"label":"before-save"},"expected":expected,"pdfRows":pdf_groups}
    Path(args.output).write_text(json.dumps(report,indent=2),encoding="utf-8");print(json.dumps({k:v for k,v in report.items() if k not in {"expected","pdfRows"}},indent=2))
if __name__=="__main__":main()
