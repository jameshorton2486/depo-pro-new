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
  return [
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
