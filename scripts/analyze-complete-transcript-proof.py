from __future__ import annotations
import argparse,json,re
from pathlib import Path
import pdfplumber

def norm(value):return re.sub(r"\s+"," ",str(value).strip())
def main():
    parser=argparse.ArgumentParser();parser.add_argument("--spec",required=True);parser.add_argument("--mapping",required=True);parser.add_argument("--word",required=True);parser.add_argument("--pdf",required=True);parser.add_argument("--output",required=True);args=parser.parse_args()
    spec=json.loads(Path(args.spec).read_text(encoding="utf-8"));mapping=json.loads(Path(args.mapping).read_text(encoding="utf-8"))["lines"];cycle=json.loads(Path(args.word).read_text(encoding="utf-8-sig"));by_key={(page["pageNumber"],line["position"]):line for page in spec["pages"] for line in page["lines"]}
    before=cycle["before"]["placements"];after=cycle["after"]["placements"]
    def parity(placements):return sum(1 for mapped,placed in zip(mapping,placements) if mapped["modelPage"]==placed["page"] and norm(by_key[(mapped["modelPage"],mapped["modelLine"])]["text"])==norm(placed["text"]))
    pdf_pages=[];pdf_exact=0;occupied=[(page["pageNumber"],line["position"],norm(line["text"])) for page in spec["pages"] for line in page["lines"] if line["occupied"]]
    with pdfplumber.open(args.pdf) as document:
        for page_number,page in enumerate(document.pages,1):
            words=page.extract_words(x_tolerance=1,y_tolerance=2,keep_blank_chars=False);rows=[]
            for item in words:
                row=next((entry for entry in rows if abs(entry["top"]-item["top"])<=2),None)
                if row is None:row={"top":item["top"],"items":[]};rows.append(row)
                row["items"].append(item)
            texts=[norm(" ".join(item["text"] for item in sorted(row["items"],key=lambda entry:entry["x0"]))) for row in sorted(rows,key=lambda entry:entry["top"])]
            pdf_pages.append({"page":page_number,"rows":texts})
            for _,_,target in [entry for entry in occupied if entry[0]==page_number]:
                if any(target and (row==target or row.endswith(" "+target) or row.endswith(target)) for row in texts):pdf_exact+=1
    testimony_mapping=[line for line in mapping if spec["pages"][line["modelPage"]-1]["role"]=="testimony"]
    report={"profile":spec["profile"]["id"],"modelHash":spec["modelHash"],"modelPages":len(spec["pages"]),"mappedPhysicalLines":len(mapping),"wordPagesBefore":cycle["before"]["pages"],"wordPagesAfter":cycle["after"]["pages"],"wordParagraphsBefore":cycle["before"]["paragraphs"],"wordParagraphsAfter":cycle["after"]["paragraphs"],"modelWordExactBefore":parity(before),"modelWordExactAfter":parity(after),"testimonyMappedLines":len(testimony_mapping),"occupiedLines":len(occupied),"occupiedPdfExact":pdf_exact,"wordSaveReopenStable":[(p["page"],norm(p["text"])) for p in before]==[(p["page"],norm(p["text"])) for p in after],"roles":[page["role"] for page in spec["pages"]],"pdfRows":pdf_pages}
    Path(args.output).write_text(json.dumps(report,indent=2),encoding="utf-8");print(json.dumps({key:value for key,value in report.items() if key!="pdfRows"},indent=2))
if __name__=="__main__":main()
