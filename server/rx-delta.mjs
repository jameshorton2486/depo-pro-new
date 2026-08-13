function number(value) { return Number.isFinite(value) ? value : null; }
function outcome(beforeBad, afterBad, improvement) {
  if (beforeBad && !afterBad) return "resolved";
  if (!beforeBad && afterBad) return "worsened";
  if (improvement > 1) return "improved";
  if (improvement < -1) return "worsened";
  return "unchanged";
}

export function compareRxMeasurements(before = {}, after = {}) {
  const beforeLowFrequency = number(before.lowFrequencyMeanDb) !== null && number(before.meanVolumeDb) !== null ? before.lowFrequencyMeanDb - before.meanVolumeDb : null;
  const afterLowFrequency = number(after.lowFrequencyMeanDb) !== null && number(after.meanVolumeDb) !== null ? after.lowFrequencyMeanDb - after.meanVolumeDb : null;
  const beforeClipping = number(before.clippedSampleCount), afterClipping = number(after.clippedSampleCount);
  const clippingPresent = beforeClipping !== null && beforeClipping > 8;
  const beforeHum=number(before.humHarmonicMeanDb),afterHum=number(after.humHarmonicMeanDb);
  const beforeImpulses=number(before.impulseCount),afterImpulses=number(after.impulseCount);
  const beforeFricatives=number(before.fricativeBandMeanDb),afterFricatives=number(after.fricativeBandMeanDb);
  const fricativeRetention=beforeFricatives === null || afterFricatives === null ? null : 10 ** ((afterFricatives-beforeFricatives)/20);
  return [
    {
      id:"humHarmonics",label:"Hum harmonic energy",unit:"dBFS",before:beforeHum,after:afterHum,
      status:beforeHum === null || afterHum === null ? "unavailable" : beforeHum-afterHum > 1 ? "improved" : afterHum-beforeHum > 1 ? "worsened" : "unchanged",
      note:`Measured at the stronger ${before.humLineFrequencyHz ?? after.humLineFrequencyHz ?? 50}/60 Hz harmonic family.`,
    },
    {
      id:"impulses",label:"Impulse count",unit:"events",before:beforeImpulses,after:afterImpulses,
      status:beforeImpulses === null || afterImpulses === null ? "unavailable" : beforeImpulses>afterImpulses ? "improved" : afterImpulses>beforeImpulses ? "worsened" : "unchanged",
    },
    {
      id:"fricativeRetention",label:"Fricative-band retention",unit:"ratio",before:1,after:fricativeRetention,
      status:fricativeRetention === null ? "unavailable" : fricativeRetention < .8 ? "worsened" : "unchanged",
      note:"A ratio below 0.80 warns that processing may have stripped speech consonant energy.",
    },
    {
      id:"lowFrequencyEnergy", label:"Low-frequency energy", unit:"dB relative to full band", before:beforeLowFrequency, after:afterLowFrequency,
      status:beforeLowFrequency === null || afterLowFrequency === null ? "unavailable" : outcome(beforeLowFrequency > -13, afterLowFrequency > -13, beforeLowFrequency - afterLowFrequency),
    },
    {
      id:"level", label:"Average level", unit:"dBFS", before:number(before.meanVolumeDb), after:number(after.meanVolumeDb),
      status:number(before.meanVolumeDb) === null || number(after.meanVolumeDb) === null ? "unavailable" : outcome(before.meanVolumeDb < -32, after.meanVolumeDb < -32, Math.abs(before.meanVolumeDb + 23) - Math.abs(after.meanVolumeDb + 23)),
    },
    {
      id:"dynamicRange", label:"Dynamic range", unit:"dB", before:number(before.dynamicRangeDb), after:number(after.dynamicRangeDb),
      status:number(before.dynamicRangeDb) === null || number(after.dynamicRangeDb) === null ? "unavailable" : outcome(before.dynamicRangeDb > 35, after.dynamicRangeDb > 35, before.dynamicRangeDb - after.dynamicRangeDb),
    },
    {
      id:"clipping", label:"Original clipping", unit:"clipped samples", before:beforeClipping, after:afterClipping,
      status:beforeClipping === null || afterClipping === null ? "unavailable" : clippingPresent && afterClipping <= 8 ? "concealed" : !clippingPresent && afterClipping > 8 ? "worsened" : "unchanged",
      note:clippingPresent ? "Clipping remains an original-recording defect; processing may conceal it but cannot restore lost samples." : undefined,
    },
  ];
}
