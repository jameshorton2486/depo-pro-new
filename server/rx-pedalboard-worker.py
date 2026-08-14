from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pedalboard
from pedalboard import HighpassFilter, Pedalboard, load_plugin
from pedalboard.io import AudioFile

PARAMETER_TOLERANCE = 1e-6
OUTPUT_BIT_DEPTH = 16
EXPECTED_MANUFACTURER = "iZotope"
EXPECTED_MAJOR_VERSION = "12"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render one derivative through an allow-listed RX VST3 plug-in.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--plugin", action="append", default=[])
    parser.add_argument("--profile", required=True)
    parser.add_argument("--result", required=True)
    return parser.parse_args()


def identity(plugin: object, attribute: str) -> str:
    value = getattr(plugin, attribute, "")
    return str(value or "").strip()


def numeric_raw(parameter: object, name: str) -> float:
    value = float(parameter.raw_value)
    if not math.isfinite(value):
        raise RuntimeError(f"RX parameter is not finite after configuration: {name}")
    return value


def configure_parameters(parameters: dict, requested_parameters: dict) -> dict[str, float]:
    applied_parameters: dict[str, float] = {}
    for name, requested in requested_parameters.items():
        if name not in parameters:
            raise RuntimeError(f"RX parameter is unavailable: {name}")
        requested_value = float(requested)
        if not math.isfinite(requested_value):
            raise RuntimeError(f"RX parameter is not finite: {name}")
        parameters[name].raw_value = requested_value
        applied_value = numeric_raw(parameters[name], name)
        if not math.isclose(applied_value, requested_value, rel_tol=PARAMETER_TOLERANCE, abs_tol=PARAMETER_TOLERANCE):
            raise RuntimeError(
                f"RX parameter was clamped or quantized: {name} requested={requested_value} applied={applied_value}"
            )
        applied_parameters[name] = applied_value
    return applied_parameters


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve(strict=True)
    output_path = Path(args.output).resolve()
    result_path = Path(args.result).resolve()
    profiles_value = json.loads(Path(args.profile).read_text(encoding="utf-8"))
    profiles = profiles_value if isinstance(profiles_value, list) else [profiles_value]

    if output_path == input_path:
        raise RuntimeError("RX output must never overwrite the input.")
    if output_path.exists() or result_path.exists():
        raise RuntimeError("RX temporary output or result already exists.")

    rx_paths = iter([Path(value).resolve(strict=True) for value in args.plugin])
    plugins, module_results = [], []
    for profile in profiles:
        profile_id, profile_version = str(profile.get("id") or ""), str(profile.get("version") or "")
        if profile.get("engine") == "ffmpeg" and profile_id == "low-frequency-rolloff-v2":
            plugins.append(HighpassFilter(cutoff_frequency_hz=70.0));module_results.append({"profileId":profile_id,"profileVersion":profile_version,"plugin":"Pedalboard HighpassFilter","manufacturer":"Spotify","pluginVersion":pedalboard.version.__version__,"requestedRawParameters":{"cutoff_frequency_hz":70.0},"appliedRawParameters":{"cutoff_frequency_hz":70.0},"effectiveRawParameters":{"cutoff_frequency_hz":70.0},"effectiveDisplayValues":{"cutoff_frequency_hz":"70 Hz"}});continue
        try: plugin_path = next(rx_paths)
        except StopIteration: raise RuntimeError("RX plug-in path is missing for the requested chain.")
        plugin = load_plugin(str(plugin_path));manufacturer, plugin_name, plugin_version = identity(plugin,"manufacturer_name"),identity(plugin,"name"),identity(plugin,"version")
        expected_plugin, requested_parameters = str(profile.get("expectedPlugin") or ""), profile.get("rawParameters")
        if not profile_id or not profile_version or not expected_plugin or not isinstance(requested_parameters,dict): raise RuntimeError("RX profile identity or parameter map is missing.")
        if not plugin.is_effect or plugin.is_instrument or manufacturer != EXPECTED_MANUFACTURER or plugin_name != expected_plugin or plugin_version.split(".",1)[0] != EXPECTED_MAJOR_VERSION: raise RuntimeError(f"Unexpected RX plug-in loaded: {plugin_name or '<missing>'}")
        applied=configure_parameters(plugin.parameters,requested_parameters);effective={name:numeric_raw(parameter,name) for name,parameter in plugin.parameters.items()};display={name:str(parameter.string_value) for name,parameter in plugin.parameters.items()}
        plugins.append(plugin);module_results.append({"profileId":profile_id,"profileVersion":profile_version,"plugin":plugin_name,"manufacturer":manufacturer,"pluginVersion":plugin_version,"requestedRawParameters":requested_parameters,"appliedRawParameters":applied,"effectiveRawParameters":effective,"effectiveDisplayValues":display})
    board=Pedalboard(plugins)

    frames_processed = 0
    try:
        with AudioFile(str(input_path)) as source:
            sample_rate = int(source.samplerate)
            channels = int(source.num_channels)
            source_frames = int(source.frames)
            chunk_frames = sample_rate * 10
            first_block = True
            with AudioFile(str(output_path), "w", sample_rate, channels, bit_depth=OUTPUT_BIT_DEPTH) as destination:
                while source.tell() < source_frames:
                    input_audio = source.read(min(chunk_frames, source_frames - source.tell()))
                    input_frames = int(input_audio.shape[1])
                    rendered = board.process(input_audio, sample_rate, reset=first_block)
                    first_block = False
                    if rendered.shape[0] != channels or not np.isfinite(rendered).all():
                        raise RuntimeError("RX returned invalid audio samples.")
                    output_frames = int(rendered.shape[1])
                    if output_frames != input_frames:
                        raise RuntimeError(
                            f"RX changed block length: input={input_frames} output={output_frames}"
                        )
                    destination.write(rendered)
                    frames_processed += output_frames

        if frames_processed != source_frames:
            raise RuntimeError(
                f"RX changed total frame count: source={source_frames} output={frames_processed}"
            )
        if frames_processed <= 0 or not output_path.exists() or output_path.stat().st_size <= 0:
            raise RuntimeError("RX did not produce a readable derivative.")

        result = {
            "worker": "spotify-pedalboard",
            "workerVersion": pedalboard.version.__version__,
            "modules": module_results,
            "plugin": module_results[0]["plugin"],
            "manufacturer": module_results[0]["manufacturer"],
            "pluginVersion": module_results[0]["pluginVersion"],
            "profileId": module_results[0]["profileId"],
            "profileVersion": module_results[0]["profileVersion"],
            "sampleRate": sample_rate,
            "channels": channels,
            "sourceFrames": source_frames,
            "framesProcessed": frames_processed,
            "outputEncoding": {"container": "wav", "sampleFormat": "pcm_s16le", "bitDepth": OUTPUT_BIT_DEPTH},
            "requestedRawParameters": module_results[0]["requestedRawParameters"],
            "appliedRawParameters": module_results[0]["appliedRawParameters"],
            "effectiveRawParameters": module_results[0]["effectiveRawParameters"],
            "effectiveDisplayValues": module_results[0]["effectiveDisplayValues"],
        }
        result_path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    except BaseException:
        output_path.unlink(missing_ok=True)
        result_path.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    main()
