export const DERIVATIVE_KINDS=Object.freeze({FFMPEG_CANDIDATE:"ffmpeg-candidate",RX_ASR:"rx-asr",RX_REVIEW:"rx-review",DEEPGRAM_COMPATIBILITY:"deepgram-compatibility",PLAYBACK_PROXY:"playback-proxy"});
export const ASR_ELIGIBLE_KINDS=Object.freeze(new Set([DERIVATIVE_KINDS.FFMPEG_CANDIDATE,DERIVATIVE_KINDS.RX_ASR,DERIVATIVE_KINDS.DEEPGRAM_COMPATIBILITY]));
export const CANONICAL_ASR_PCM_BITS=16; // Adequate for speech ASR; provenance records the float-to-PCM quantization.
