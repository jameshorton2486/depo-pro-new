export const UFM_FREELANCE_LAYOUT_PROFILE = Object.freeze({
  id: "ufm-freelance-v1",
  linesPerPage: 25,
  font: Object.freeze({ family: "Courier New", pointSize: 12, monospace: true }),
  charactersPerLine: null,
  margins: null,
  lineNumberGutter: Object.freeze({ position: "left", width: null }),
  source: "Texas UFM, amended July 15 2003",
  verifiedBy: null,
  verifiedAt: null,
});

export function isLayoutProfileVerified(profile = UFM_FREELANCE_LAYOUT_PROFILE) {
  return Boolean(profile.verifiedBy && profile.verifiedAt);
}
