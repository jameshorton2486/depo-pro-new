// Chunk invariance: no rule is known. Measure every module.
//
// De-hum and Voice De-noise render identically at 10-second and 30-second chunks. De-click,
// De-reverb, Dialogue Isolate and Repair Assistant do not. There is no property of a module
// that predicts which side it lands on -- "spectral repair is invariant, separation is not"
// was the obvious hypothesis and De-click kills it, being a repair module that fails.
//
// So do not infer from the pattern. A module without a renderChunkSeconds pin is one that
// was measured and found invariant, never one that was assumed to be. Anything added to this
// catalog is unqualified until qualifyProfile has been run against it.
//
// Two modules also carry measuredLatencyFrames, and the same applies: De-hum and Voice
// De-noise measured 0, Dialogue Isolate 4096 and Repair Assistant 8159, and nothing about
// the modules predicted which. De-click and De-reverb carry no figure at all because their
// alignment is indeterminate -- correlation cannot resolve a lag for a module that reshapes
// the waveform rather than delaying it. Absent is not zero.
const identity = (id, module, description, rawParameters, metadata) => Object.freeze({
  id, version:"1.0.0", product:"iZotope RX 12", edition:"Standard", module, description,
  engine:"rx",...metadata,
  pluginFile:`RX 12 ${module}.vst3`, pluginIdentifier:`iZotope RX 12 ${module}.vst3`, expectedPlugin:`RX 12 ${module}`,
  presetIdentity:`Depo-Pro reviewed RX 12 ${module} profile v1`, rawParameters:Object.freeze(rawParameters),
});

export const RX_PROFILES = Object.freeze({
  "rx12-voice-denoise-factory-adaptive-v1": identity("rx12-voice-denoise-factory-adaptive-v1","Voice De-noise","Adaptive dialogue noise reduction.",{threshold_1:.5555555820465088,threshold_2:.5555555820465088,threshold_3:.5555555820465088,threshold_4:.5555555820465088,threshold_5:.5555555820465088,threshold_6:.5555555820465088,master_threshold:.6666666865348816,reduction:.6000000238418579,adaptive_mode:1,optimize_for:0,filter_type:0,input_gain_db:.6666666865348816,output_gain_db:.6666666865348816,global_bypass:0},{displayName:"Voice De-noise",plainPurpose:"Reduces steady broadband background noise around spoken voices.",riskLevel:"high",asrSafe:false,chainOrder:4,recommendFor:[],excludes:["rx12-dialogue-isolate-conservative-v1"],measuredRealTimeFactor:.030,caution:"May remove quiet consonants or distant speech. Review the result before transcription."}),
  "rx12-de-click-conservative-v1": identity("rx12-de-click-conservative-v1","De-click","Conservative single-band click removal.",{algorithm:0,sensitivity:.2631579041481018,output_clicks_only:0,global_bypass:0,frequency_skew:.5,click_widening:0},{displayName:"De-click",plainPurpose:"Reduces isolated clicks, pops, and digital impulses.",riskLevel:"moderate",asrSafe:false,chainOrder:1,recommendFor:["impulses"],excludes:[],measuredRealTimeFactor:.022,
    // Version 2.0.0, demoted from asrSafe on measurement rather than opinion.
    //
    // Qualification against a known fixture found the output NOT chunk-invariant: renders at
    // 10-second and 30-second chunks differ, while two renders at the same chunk size in
    // separate processes are byte-identical. So the module is deterministic but its output
    // depends on block boundaries -- the Pedalboard state-leakage behaviour Spotify
    // documents. Chunk size is therefore part of this profile's identity, not an
    // implementation detail, and renderChunkSeconds pins it.
    //
    // Alignment is also unresolved: marker offsets came back [0, 0, 0, -6466, -6467], with
    // every zero inside the first ten-second chunk. Until that is settled this profile stays
    // review-only, because the failure mode is silently shifted Deepgram timestamps feeding
    // the token model. The version bump is required because existing derivatives were
    // rendered before chunk size was recorded and cannot be told apart otherwise.
    version:"2.0.0", renderChunkSeconds:10,
    caution:"Review-only pending qualification. Output depends on the render chunk size, and time alignment beyond the first ten seconds is not yet established."}),
  "rx12-de-hum-dynamic-v1": identity("rx12-de-hum-dynamic-v1","De-hum","Dynamic 60 Hz hum and harmonic reduction.",{enable_learning:0,enable_adaptive_learning:0,base_frequency:1,notch_frequency:.0020874931942671537,filter_q:.3265993297100067,linear_phase_filters:0,enable_highpass:0,highpass_freq:.0002722817298490554,highpass_q:.06779661029577255,enable_lowpass:0,lowpass_freq:.9069704413414001,lowpass_q:.06779661029577255,number_of_harmonics:.46666666865348816,harmonic_1_gain:.2,harmonic_2_gain:.2,harmonic_3_gain:.2,harmonic_4_gain:.2,harmonic_5_gain:.2,harmonic_6_gain:.2,harmonic_7_gain:.2,harmonic_8_gain:.2,linking_type:0,harmonic_base_slope:0,harmonic_base_odd_slope:0,enable_dc_offset:1,output_hum_only:0,global_bypass:0,dynamic_bands:0,dynamic_sensitivity:.5,dynamic_q:.09090909361839294,hum_mode:1,dynamic_low_cutoff:.0000520860448887106,dynamic_high_cutoff:1},{displayName:"De-hum",plainPurpose:"Reduces steady electrical hum and its harmonics while leaving speech frequencies alone.",riskLevel:"low",asrSafe:true,chainOrder:2,recommendFor:["lineHum"],excludes:[],measuredRealTimeFactor:.016,caution:null}),
  "rx12-de-reverb-conservative-v1": identity("rx12-de-reverb-conservative-v1","De-reverb","Conservative room-reverb reduction.",{tail_length:.1428571492433548,artifact_smoothing:.8999999761581421,reduction:.6666666865348816,band_strength_low:.6000000238418579,band_strength_low_mid:.6000000238418579,band_strength_high_mid:.6000000238418579,band_strength_high:.6000000238418579,enhance_dry_signal:0,output_reverb_only:0,global_bypass:0},{displayName:"De-reverb",plainPurpose:"Reduces room echo and reverberation around speech.",riskLevel:"moderate",asrSafe:false,chainOrder:5,recommendFor:["echo"],excludes:[],measuredRealTimeFactor:.032,
    // Version 2.0.0: qualification found the output not chunk-invariant, so chunk size is
    // part of this profile's identity. Alignment is indeterminate rather than shifted --
    // De-reverb reshapes the waveform by removing tails, so input and output are not related
    // by a time shift and whole-file correlation returns a different answer at every search
    // width. No latency figure can be recorded, and none is claimed.
    version:"2.0.0", renderChunkSeconds:10,
    caution:"May alter speech tails and room context. Output depends on the render chunk size, and time alignment cannot be measured by correlation. The result is review-only unless you explicitly promote it."}),
  "rx12-dialogue-isolate-conservative-v1": identity("rx12-dialogue-isolate-conservative-v1","Dialogue Isolate","Preserves dialogue while reducing noise and reverb by 12 dB.",{dialogue_gain_db:.75,reverb_gain_db:.6,noise_gain_db:.6,sensitivity:.5,band_1_amount:1,band_2_amount:1,band_3_amount:1,band_4_amount:1,global_bypass:0},{displayName:"Dialogue Isolate",plainPurpose:"Separates speech from competing noise and reverberation.",riskLevel:"high",asrSafe:false,chainOrder:6,recommendFor:[],excludes:["rx12-voice-denoise-factory-adaptive-v1"],measuredRealTimeFactor:.194,
    // Version 2.0.0: 4096 frames of measured, uncompensated processing latency -- 85.3ms.
    //
    // Whole-file correlation returned exactly 4096 at every search width tried (+/-8192,
    // +/-24000, +/-48000), coarse and refined, with Voice De-noise in the same run returning
    // 0 as a control. 4096 is an FFT block. This is a real shift, not a correlation failure.
    //
    // It is invisible to frame parity, which compares counts: the derivative is the same
    // length, with the content 85ms late inside it. Left uncompensated it would move every
    // Deepgram word timestamp by that amount. The offset is constant, so it is compensable.
    version:"2.0.0", renderChunkSeconds:10, measuredLatencyFrames:4096,
    caution:"Source separation can remove quiet words or consonants. Introduces 85ms of processing latency, which Depo-Pro compensates and records. Review the result before transcription."}),
  "rx12-repair-assistant-voice-light-v1": identity("rx12-repair-assistant-voice-light-v1","Repair Assistant","Light voice cleanup with 20% de-noise and de-reverb.",{global_bypass:0,source_mode:0,de_clip_bypass:1,de_clip_threshold_db:1,de_clip_output_gain:1,de_clip_limiter:1,clean_up_bypass:0,de_click_bypass:0,de_hum_bypass:0,de_noise_amount:.2,de_reverb_amount:.2,de_squeak_amount:0,de_pick_bypass:1,de_ess_bypass:1,de_ess_cutoff_hz:.2361111044883728,de_ess_shaping:.5,de_ess_threshold_db:.800000011920929,de_ess_speed:0,tone_bypass:0,tone_amount:.5,tone_mode:0,tone_lo_cut:0,tone_hi_cut:0},{displayName:"Repair Assistant",plainPurpose:"Applies a light general-purpose voice cleanup selected by RX.",riskLevel:"moderate",asrSafe:false,chainOrder:null,recommendFor:[],excludes:Object.keys({}),measuredRealTimeFactor:.190,
    // Version 2.0.0: 8159 frames of measured, uncompensated processing latency -- 170.0ms.
    //
    // I predicted this one was an artifact. The value sat 33 frames inside the +/-8192 search
    // boundary, which is the classic signature of a peak pinned at the edge, so I widened the
    // search to +/-24000 and +/-48000 expecting it to move. It did not: 8159 at every width,
    // with the coarse envelope stage independently landing on 8128 each time. Roughly double
    // Dialogue Isolate's, which fits a composite chain summing its internal stages.
    // measuredRealTimeFactor here is FIXTURE-MEASURED and does not predict full-deposition
    // runtime. On an 83-minute recording 0.190 predicts about 16 minutes; an actual run exceeded
    // the 30-minute limit and did not finish, so the true figure is at least double and unknown
    // above that. Not re-qualified -- recorded so nobody selects this module on a real
    // deposition expecting 16 minutes.
    version:"2.0.0", renderChunkSeconds:10, measuredLatencyFrames:8159,
    realTimeFactorScope:"fixture-only",
    caution:"This combined treatment is review-only and must run by itself. Introduces 170ms of processing latency, which Depo-Pro compensates and records. The speed estimate is fixture-measured: a full-length deposition exceeded the 30-minute processing limit without finishing."}),
});

export const AUDIO_TOOL_PROFILES=Object.freeze({
  "low-frequency-rolloff-v2":Object.freeze({id:"low-frequency-rolloff-v2",version:"2.0.0",engine:"ffmpeg",displayName:"High-pass filter",plainPurpose:"Reduces low-frequency rumble below the main speech range.",riskLevel:"low",asrSafe:true,chainOrder:3,recommendFor:["lowFrequencyEnergy"],excludes:[],caution:null}),
  ...RX_PROFILES,
});

// measuredRealTimeFactor crosses to the browser deliberately: an operator choosing Dialogue
// Isolate or Repair Assistant is committing to roughly 70 minutes of render on a six-hour
// deposition, and until this was exposed the figure existed only inside qualification records.
// Absent means not measured, which the UI must say rather than treating as fast.
export function publicAudioTools(){return Object.values(AUDIO_TOOL_PROFILES).map(({id,version,engine,displayName,plainPurpose,riskLevel,asrSafe,chainOrder,recommendFor,excludes,caution,measuredRealTimeFactor})=>({id,version,engine,displayName,plainPurpose,riskLevel,asrSafe,chainOrder,recommendFor,excludes,caution,measuredRealTimeFactor:measuredRealTimeFactor??null}))}

export function resolveAudioToolChain(profileIds){const ids=[...new Set(profileIds||[])];if(!ids.length)throw new Error("Select at least one audio tool.");const profiles=ids.map(id=>{const profile=AUDIO_TOOL_PROFILES[id];if(!profile)throw new Error(`Unsupported audio tool: ${id}`);return profile});if(profiles.some(profile=>profile.chainOrder===null)&&profiles.length>1)throw new Error("Repair Assistant must run by itself.");for(const profile of profiles)for(const excluded of profile.excludes||[])if(ids.includes(excluded))throw new Error(`${profile.displayName} cannot be combined with ${AUDIO_TOOL_PROFILES[excluded]?.displayName||excluded}.`);return profiles.sort((a,b)=>(a.chainOrder??999)-(b.chainOrder??999))}

export function getRxProfile(profileId) { const profile=RX_PROFILES[profileId]; if(!profile) throw new Error(`Unsupported RX processing profile: ${profileId}`); return profile; }
