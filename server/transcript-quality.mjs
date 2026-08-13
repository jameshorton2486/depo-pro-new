function words(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9' -]/g, " ").split(/\s+/).filter(Boolean);
}

function distance(reference, hypothesis) {
  const rows = Array.from({ length: reference.length + 1 }, () => Array(hypothesis.length + 1).fill(null));
  rows[0][0] = { cost: 0, s: 0, d: 0, i: 0 };
  for (let r = 1; r <= reference.length; r++) rows[r][0] = { cost: r, s: 0, d: r, i: 0 };
  for (let h = 1; h <= hypothesis.length; h++) rows[0][h] = { cost: h, s: 0, d: 0, i: h };
  for (let r = 1; r <= reference.length; r++) for (let h = 1; h <= hypothesis.length; h++) {
    if (reference[r - 1] === hypothesis[h - 1]) rows[r][h] = { ...rows[r - 1][h - 1] };
    else {
      const choices = [
        { ...rows[r - 1][h - 1], cost: rows[r - 1][h - 1].cost + 1, s: rows[r - 1][h - 1].s + 1 },
        { ...rows[r - 1][h], cost: rows[r - 1][h].cost + 1, d: rows[r - 1][h].d + 1 },
        { ...rows[r][h - 1], cost: rows[r][h - 1].cost + 1, i: rows[r][h - 1].i + 1 },
      ];
      rows[r][h] = choices.sort((a, b) => a.cost - b.cost)[0];
    }
  }
  return rows[reference.length][hypothesis.length];
}

export function compareTranscripts(referenceText, hypothesisText, criticalTerms = []) {
  const reference = words(referenceText);
  const hypothesis = words(hypothesisText);
  const result = distance(reference, hypothesis);
  const terms = [...new Set(criticalTerms.map(term => String(term).trim()).filter(Boolean))];
  const normalizedHypothesis = ` ${hypothesis.join(" ")} `;
  const critical = terms.map(term => ({ term, present: normalizedHypothesis.includes(` ${words(term).join(" ")} `) }));
  const expected = critical.filter(item => ` ${reference.join(" ")} `.includes(` ${words(item.term).join(" ")} `));
  const missed = expected.filter(item => !item.present);
  return {
    schemaVersion: 1,
    referenceWords: reference.length,
    hypothesisWords: hypothesis.length,
    substitutions: result.s,
    deletions: result.d,
    insertions: result.i,
    errors: result.cost,
    wer: reference.length ? result.cost / reference.length : null,
    criticalLegalErrorRate: expected.length ? missed.length / expected.length : null,
    criticalTermsExpected: expected.length,
    criticalTermsMissed: missed.map(item => item.term),
    comparedAt: new Date().toISOString(),
  };
}
