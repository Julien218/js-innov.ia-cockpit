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
import hashlib
import subprocess
import math
from pathlib import Path


def safe_float(value, default=None):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
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
                local_files_only=True,
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


def probe_audio(audio_path: Path) -> dict:
    """Read the original file, not a browser-supplied duration."""
    completed = subprocess.run(
        [os.getenv("FFPROBE_PATH", "ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(audio_path)],
        check=True, capture_output=True, timeout=30,
    )
    data = json.loads(completed.stdout)
    stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not stream:
        raise ValueError("Aucune piste audio décodable.")
    duration = safe_float(stream.get("duration"), safe_float(data.get("format", {}).get("duration"), 0))
    if not duration or duration <= 0 or duration > 1800:
        raise ValueError("Durée audio invalide ou supérieure à 30 minutes.")
    return {"duration_seconds": duration, "sample_rate": int(stream.get("sample_rate", 0)),
            "channels": int(stream.get("channels", 0)), "codec": str(stream.get("codec_name", "")),
            "bytes": Path(audio_path).stat().st_size}


def acoustic_summary(audio_path: Path) -> dict:
    """Decode every sample. Process spectral windows in chunks to bound memory.

    Attacks in overlapping frequency bands are not identified as kick drums or
    isolated bass instruments. Section labels and tonal estimates need review.
    """
    started = time.time()
    result = {"available": False, "bpm": None, "warnings": [], "coverage": {"complete": False}}
    try:
        import numpy as np
        import librosa
        from scipy.signal import find_peaks

        meta = probe_audio(audio_path)
        sr, hop, n_fft = 22050, 512, 2048
        decoded = subprocess.run(
            [os.getenv("FFMPEG_PATH", "ffmpeg"), "-v", "error", "-xerror", "-i", str(audio_path),
             "-map", "0:a:0", "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1"],
            check=True, capture_output=True, timeout=300,
        )
        y = np.frombuffer(decoded.stdout, dtype="<f4")
        if not len(y) or not np.isfinite(y).all():
            raise ValueError("Audio vide ou échantillons non finis.")
        duration = len(y) / sr
        tolerance = max(0.25, meta["duration_seconds"] * 0.005)
        complete = abs(duration - meta["duration_seconds"]) <= tolerance
        result["coverage"] = {"complete": complete, "source_seconds": meta["duration_seconds"],
                              "decoded_seconds": round(duration, 6), "processed_seconds": round(duration, 6),
                              "samples_decoded": len(y), "analysis_sample_rate": sr,
                              "range": [0, round(duration, 6)], "decoder": "ffmpeg-xerror"}
        result["source"] = meta
        if not complete:
            result["warnings"].append("Durée décodée différente de la durée source : analyse non validée.")
        padded = np.pad(y, (n_fft // 2, n_fft // 2), mode="constant")
        frames = 1 + len(y) // hop
        rms_parts, flux_parts, low_parts, bass_parts, chroma_parts = [], [], [], [], []
        frequencies = np.fft.rfftfreq(n_fft, 1 / sr)
        low_mask = (frequencies >= 20) & (frequencies <= 120)
        bass_mask = (frequencies >= 60) & (frequencies <= 250)
        chroma_filter = librosa.filters.chroma(sr=sr, n_fft=n_fft)
        previous = None
        for first in range(0, frames, 1024):
            count = min(1024, frames - first)
            chunk = padded[first * hop:(first + count - 1) * hop + n_fft]
            spectrum = np.abs(librosa.stft(chunk, n_fft=n_fft, hop_length=hop, center=False))
            log_spec = np.log1p(spectrum)
            last = previous if previous is not None else log_spec[:, :1]
            flux_parts.append(np.maximum(0, np.diff(np.concatenate([last, log_spec], axis=1), axis=1)).mean(axis=0))
            previous = log_spec[:, -1:]
            rms_parts.append(librosa.feature.rms(y=chunk, frame_length=n_fft, hop_length=hop, center=False)[0])
            low_parts.append((spectrum[low_mask] ** 2).mean(axis=0))
            bass_parts.append((spectrum[bass_mask] ** 2).mean(axis=0))
            chroma_parts.append(chroma_filter @ spectrum)
        rms, onset, low, bass = [np.concatenate(p) for p in (rms_parts, flux_parts, low_parts, bass_parts)]
        chroma = np.concatenate(chroma_parts, axis=1)
        times = np.minimum(np.arange(len(rms)) * hop / sr, duration)
        if float(rms.max()) > 1e-5 and float(onset.max()) > 1e-7:
            tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, trim=True)
            bpm = float(np.asarray(tempo).reshape(-1)[0])
            beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
        else:
            bpm, beat_times = 0.0, np.array([])
            result["warnings"].append("Signal silencieux ou sans pulsation fiable ; aucun BPM imposé.")
        def events(envelope, gap=0.15):
            maximum = float(np.max(envelope))
            if maximum <= 1e-9:
                return []
            normalized = envelope / maximum
            indexes, _ = find_peaks(normalized, distance=max(1, int(gap * sr / hop)), prominence=0.12)
            return [round(float(times[i]), 4) for i in indexes]
        onset_times = events(onset)
        low_events = events(np.maximum(0, np.diff(np.log1p(low), prepend=np.log1p(low[:1]))))
        bass_events = events(np.maximum(0, np.diff(np.log1p(bass), prepend=np.log1p(bass[:1]))))
        # Coarse novelty: a proposed boundary, never an asserted chorus/verse label.
        block = max(1, int(0.5 * sr / hop))
        descriptors = []
        for i in range(0, len(rms), block):
            c = chroma[:, i:i + block].mean(axis=1); c = c / max(1e-9, np.linalg.norm(c))
            descriptors.append(np.r_[c, np.log(max(1e-7, float(rms[i:i + block].mean())))])
        features = np.array(descriptors)
        novelty = np.zeros(len(features))
        for i in range(2, len(features) - 2):
            a, b = features[i-2:i].mean(axis=0), features[i:i+2].mean(axis=0)
            novelty[i] = np.linalg.norm(a[:12] - b[:12]) + min(2, abs(a[-1] - b[-1])) * 0.35
        indexes, _ = find_peaks(novelty, distance=16, prominence=0.22)
        bounds = [0.0] + sorted(float(i * block * hop / sr) for i in indexes if 6 <= i * block * hop / sr <= duration - 6) + [duration]
        sections = []
        for i, (begin, finish) in enumerate(zip(bounds, bounds[1:])):
            start_idx, end_idx = int(begin * sr / hop), max(int(begin * sr / hop) + 1, int(finish * sr / hop))
            section_rms = rms[start_idx:end_idx]
            sections.append({"id": f"section-{i+1}", "type": "section", "label": f"Section {i+1} · à qualifier",
                             "start": round(begin, 3), "end": round(finish, 3), "source": "acoustic-novelty-proposal",
                             "energy_relative": round(float(section_rms.mean()) / max(1e-9, float(rms.max())), 4)})
        # A descriptive tonal candidate, not a guaranteed musical key.
        major = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
        minor = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
        average_chroma = chroma.mean(axis=1)
        tonal = None
        if float(np.std(average_chroma)) > 1e-8:
            candidates = sorted([(float(np.corrcoef(average_chroma, np.roll(template, shift))[0,1]), shift, mode)
                                 for mode, template in [("major", major), ("minor", minor)] for shift in range(12)], reverse=True)
            score, shift, mode = candidates[0]
            tonal = {"candidate": ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][shift] + " " + mode,
                     "correlation": round(score, 3), "margin": round(score-candidates[1][0],3), "status": "estimated-not-validated"}
        stride = max(1, int(np.ceil(len(rms) / 3000)))
        curves = [{"t": round(float(times[i]),4), "rms": round(float(rms[i]),6), "onset": round(float(onset[i]),6),
                   "low_energy": round(float(low[i]),5), "bass_energy": round(float(bass[i]),5)} for i in range(0,len(rms),stride)]
        buckets = min(1800, max(1, int(duration * 10)))
        waveform = []
        for i in range(buckets):
            chunk = y[int(i * len(y) / buckets):int((i + 1) * len(y) / buckets)]
            waveform.append({"t": round(i * duration / buckets,4), "min": round(float(chunk.min()),5), "max": round(float(chunk.max()),5)})
        peaks = np.argsort(rms)[-min(len(rms), 100):][::-1]
        selected = []
        for i in peaks:
            if all(abs(float(times[i])-t) > 2 for t in selected): selected.append(float(times[i]))
            if len(selected) == 15: break
        db = 20 * np.log10(np.maximum(rms, 1e-9))
        result.update({"available": True, "method": "full-file-windowed-v2", "duration_seconds": round(duration,6),
                       "bpm": round(bpm,2) if bpm > 0 else None, "beat_times": [round(float(t),4) for t in beat_times if t <= duration],
                       "beat_count": len(beat_times), "onset_times": onset_times,
                       "band_events": {"20_120_hz":low_events,"60_250_hz":bass_events,"interpretation":"overlapping-band-energy-attacks-not-isolated-instruments"},
                       "curves": curves, "waveform": waveform, "sections": sections, "tonality": tonal,
                       "energy_rms": round(float(rms.mean()),6), "energy_peak": round(float(rms.max()),6),
                       "rms_range_db_p95_p05": round(float(np.percentile(db,95)-np.percentile(db,5)),2),
                       "rms_peak_times": sorted(round(t,4) for t in selected), "onset_mean": round(float(onset.mean()),6)})
        result["warnings"].append("BPM, tonalité et frontières sont des estimations ; les attaques graves ne prouvent pas la présence d’un kick ou d’une basse isolée.")
    except Exception as error:
        result["warnings"].append("Analyse acoustique intégrale indisponible : " + str(error)[:800])
        result["coverage"]["complete"] = False
    result["runtime_seconds"] = round(time.time() - started, 3)
    return result


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print(json.dumps({"ok": False, "error_code": "audio_path_required"}))
        return 2
    audio_path = Path(sys.argv[1]).expanduser().resolve()
    if not audio_path.is_file():
        print(json.dumps({"ok": False, "error_code": "audio_not_found"}))
        return 2
    acoustic = acoustic_summary(audio_path)
    skip = len(sys.argv) == 3 and sys.argv[2] == "--instrumental"
    transcription = ({"ok": False, "skipped": True, "reason": "instrumental-requested", "segments": [], "transcript": "", "warnings": []}
                     if skip else transcribe(audio_path))
    transcription["acoustic"] = acoustic
    digest = hashlib.sha256()
    with audio_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    transcription["source_sha256"] = digest.hexdigest()
    transcription["coverage"] = {"full_file_requested": True, "segments_exhausted": transcription.get("ok", False),
                                  "speech_recognition_is_not_lyric_validation": True}
    print(json.dumps(transcription, ensure_ascii=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
