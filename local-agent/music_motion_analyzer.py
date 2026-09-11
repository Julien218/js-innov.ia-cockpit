#!/usr/bin/env python3
"""Local audio transcription helper for Elynea Music Motion Studio.

The script intentionally emits one JSON document on stdout so the Node local
agent can keep the browser/Cockpit contract small and auditable.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def safe_float(value, default=None):
    try:
        number = float(value)
        return number if number == number else default
    except (TypeError, ValueError):
        return default


def transcribe(audio_path: Path) -> dict:
    started = time.time()
    model_name = os.getenv("MUSIC_MOTION_WHISPER_MODEL", "small")
    device = os.getenv("MUSIC_MOTION_WHISPER_DEVICE", "cuda")
    compute_type = os.getenv("MUSIC_MOTION_WHISPER_COMPUTE_TYPE", "int8")
    language = os.getenv("MUSIC_MOTION_WHISPER_LANGUAGE", "fr")

    result = {
        "ok": False,
        "engine": "faster-whisper",
        "model": model_name,
        "language": language,
        "transcript": "",
        "segments": [],
        "audio_path": audio_path.name,
        "warnings": [],
    }

    try:
        from faster_whisper import WhisperModel
    except Exception as error:
        result["warnings"].append(
            "faster-whisper indisponible: " + str(error)
        )
        result["error_code"] = "faster_whisper_not_installed"
        result["runtime_seconds"] = round(time.time() - started, 3)
        return result

    attempts = [(device, compute_type)]
    if device != "cpu":
        attempts.append(("cpu", "int8"))
    for attempt_device, attempt_compute in attempts:
        try:
            model = WhisperModel(
                model_name,
                device=attempt_device,
                compute_type=attempt_compute,
            )
            segments, info = model.transcribe(
                str(audio_path),
                language=language or None,
                word_timestamps=True,
                vad_filter=True,
                condition_on_previous_text=True,
            )
    
            normalized_segments = []
            transcript_parts = []
            for segment in segments:
                words = []
                for word in getattr(segment, "words", None) or []:
                    words.append(
                        {
                            "word": str(getattr(word, "word", "") or "").strip(),
                            "start": safe_float(getattr(word, "start", None), 0.0),
                            "end": safe_float(getattr(word, "end", None), 0.0),
                            "probability": safe_float(
                                getattr(word, "probability", None), None
                            ),
                        }
                    )
                text = str(getattr(segment, "text", "") or "").strip()
                if text:
                    transcript_parts.append(text)
                normalized_segments.append(
                    {
                        "id": int(getattr(segment, "id", len(normalized_segments))),
                        "start": safe_float(getattr(segment, "start", None), 0.0),
                        "end": safe_float(getattr(segment, "end", None), 0.0),
                        "text": text,
                        "words": words,
                    }
                )
    
            result.update(
                {
                    "ok": True,
                    "device": attempt_device,
                    "compute_type": attempt_compute,
                    "fallback_used": attempt_device != device,
                    "transcript": " ".join(transcript_parts).strip(),
                    "segments": normalized_segments,
                    "detected_language": getattr(info, "language", None),
                    "language_probability": safe_float(
                        getattr(info, "language_probability", None), None
                    ),
                    "duration_seconds": safe_float(
                        getattr(info, "duration", None), None
                    ),
                }
            )
            break
        except Exception as error:
            gpu_error = any(token in str(error).lower() for token in ("cuda", "cublas", "cudnn", "cudart"))
            if attempt_device != "cpu" and gpu_error:
                result["warnings"].append("Accélération GPU indisponible ; nouvelle tentative sur CPU (int8).")
                result["gpu_error"] = str(error)
                continue
            result["warnings"].append("Transcription locale échouée: " + str(error))
            result["error_code"] = "transcription_failed"
            break

    result["runtime_seconds"] = round(time.time() - started, 3)
    return result


def acoustic_summary(audio_path: Path) -> dict:
    """Optional BPM/energy pass; transcription remains independent of librosa."""
    try:
        import librosa

        audio, sample_rate = librosa.load(
            str(audio_path), sr=22050, mono=True
        )
        tempo, beat_frames = librosa.beat.beat_track(
            y=audio, sr=sample_rate, trim=False
        )
        rms = librosa.feature.rms(y=audio)[0]
        onset = librosa.onset.onset_strength(y=audio, sr=sample_rate)
        return {
            "available": True,
            "bpm": round(float(tempo[0] if hasattr(tempo, "__len__") else tempo), 2),
            "beat_count": int(len(beat_frames)),
            "energy_rms": round(float(rms.mean()), 6),
            "energy_peak": round(float(rms.max()), 6),
            "onset_mean": round(float(onset.mean()), 6),
        }
    except Exception as error:
        return {
            "available": False,
            "bpm": None,
            "warnings": ["Analyse BPM/énergie indisponible: " + str(error)],
        }


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "error_code": "audio_path_required"}))
        return 2

    audio_path = Path(sys.argv[1]).expanduser().resolve()
    if not audio_path.is_file():
        print(json.dumps({"ok": False, "error_code": "audio_not_found"}))
        return 2

    transcription = transcribe(audio_path)
    transcription["acoustic"] = acoustic_summary(audio_path)
    print(json.dumps(transcription, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
