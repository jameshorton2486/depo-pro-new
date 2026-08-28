// One versioned geometry authority for transcript-body pagination and rendering.
// Legal requirements and product/proof choices are intentionally classified separately.
const classified=(value,authority,detail)=>Object.freeze({value,authority,detail});

export const TEXAS_FREELANCE_DEPOSITION_V1=Object.freeze({
  id:"TEXAS_FREELANCE_DEPOSITION_V1",version:"1.0.0",scope:"transcript-body",verifiedBy:"Profile B Microsoft Word round-trip proof",verifiedAt:"2026-08-26",
  source:"Texas UFM relative rules plus selected Profile B Word/PDF proof",
  linesPerPage:25,charactersPerLine:63,
  font:Object.freeze({family:"Courier New",pointSize:12,monospace:true,pitchCpi:10}),
  page:Object.freeze({widthTwips:12240,heightTwips:15840}),
  formatBox:Object.freeze({leftInches:1.4333,rightClearanceInches:0.5317,widthInches:6.5350,topInches:1.0,heightInches:8.6667,borderPoints:1}),
  text:Object.freeze({leftInsetInches:0.1,rightInsetInches:0.1,leftMarginTwips:2208,rightMarginTwips:910,widthTwips:9122,topMarginTwips:1560,bottomMarginTwips:2280,lineSpacingTwips:480}),
  lineNumbers:Object.freeze({position:"left",distanceTwips:216,restart:"newPage"}),
  tabs:Object.freeze({columns:Object.freeze([5,10,15]),inches:Object.freeze([0.5,1.0,1.5])}),
  pageNumber:Object.freeze({position:"upper-right",rightClearanceInches:0.5317}),
  authority:Object.freeze({
    linesPerPage:classified(25,"UFM_REQUIRED","Twenty-five physical transcript line positions on a full testimony page."),
    pitchCpi:classified(10,"UFM_REQUIRED","Ten-character pitch."),
    charactersPerLine:classified(63,"UFM_DERIVED","Sixty-five cells across 6.5 inches at 10 CPI, less one cell inset at each side."),
    tabColumns:classified([5,10,15],"UFM_REQUIRED","Fifth, tenth, and fifteenth character positions."),
    formatBox:classified({leftInches:1.4333,rightClearanceInches:0.5317,widthInches:6.5350},"PROFILE_B_WORD_PROVEN","Selected candidate retained 109/109 modeled-line parity through Word and PDF."),
    textMargins:classified({leftTwips:2208,rightTwips:910,widthTwips:9122},"PROFILE_B_WORD_PROVEN","Integer OOXML section units used in the successful Profile B proof."),
    font:classified({family:"Courier New",pointSize:12},"DEPO_PRO_IMPLEMENTATION_CHOICE","Professional monospaced type used by the proof; not characterized as a Texas legal requirement."),
    lineSpacing:classified(480,"PROFILE_B_WORD_PROVEN","Exact 24-point baseline used by the successful proof; not characterized as a UFM requirement."),
    boxVertical:classified({topInches:1.0,heightInches:8.6667},"DEPO_PRO_IMPLEMENTATION_CHOICE","Selected proof geometry."),
  }),
});

export const inchesToCssPixels=inches=>inches*96;
export const twipsToCssPixels=twips=>twips/15;
