#!/usr/bin/env python3
"""Universal local music intelligence for Elynea Music Motion Studio.

The program emits exactly one JSON document on stdout. It is intentionally
local-first and degrades gracefully when optional AI modules are unavailable.
Legacy fields from the v2 analyzer are preserved for Cockpit compatibility.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path


def safe_float(value, default=None):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def clamp(value, lo=0.0, hi=1.0):
    try:
        return max(lo, min(hi, float(value)))
    except (TypeError, ValueError):
        return lo


def module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


def local_capabilities() -> dict:
    return {
        "numpy": module_available("numpy"),
        "scipy": module_available("scipy"),
        "librosa": module_available("librosa"),
        "faster_whisper": module_available("faster_whisper"),
        "demucs": module_available("demucs"),
        "torch": module_available("torch"),
        "pypdf": module_available("pypdf"),
        "ffmpeg": True,
        "modes": ["balanced"],
    }


def transcribe(audio_path: Path) -> dict:
    started = time.time()
    model_name = os.getenv("MUSIC_MOTION_WHISPER_MODEL", "small")
    device = os.getenv("MUSIC_MOTION_WHISPER_DEVICE", "cuda")
    compute_type = os.getenv("MUSIC_MOTION_WHISPER_COMPUTE_TYPE", "int8")
    language = os.getenv("MUSIC_MOTION_WHISPER_LANGUAGE", "")
    result = {
        "ok": False,
        "engine": "faster-whisper",
        "model": model_name,
        "language": language or "auto",
        "transcript": "",
        "segments": [],
        "words": [],
        "audio_path": audio_path.name,
        "warnings": [],
    }
    try:
        from faster_whisper import WhisperModel
    except Exception as error:
        result["warnings"].append("faster-whisper indisponible: " + str(error))
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
            all_words = []
            transcript_parts = []
            for segment in segments:
                words = []
                for word in getattr(segment, "words", None) or []:
                    item = {
                        "word": str(getattr(word, "word", "") or "").strip(),
                        "start": safe_float(getattr(word, "start", None), 0.0),
                        "end": safe_float(getattr(word, "end", None), 0.0),
                        "probability": safe_float(getattr(word, "probability", None), None),
                    }
                    words.append(item)
                    if item["word"]:
                        all_words.append(item)
                text = str(getattr(segment, "text", "") or "").strip()
                if text:
                    transcript_parts.append(text)
                normalized_segments.append({
                    "id": int(getattr(segment, "id", len(normalized_segments))),
                    "start": safe_float(getattr(segment, "start", None), 0.0),
                    "end": safe_float(getattr(segment, "end", None), 0.0),
                    "text": text,
                    "words": words,
                })
            result.update({
                "ok": True,
                "device": attempt_device,
                "compute_type": attempt_compute,
                "fallback_used": attempt_device != device,
                "transcript": " ".join(transcript_parts).strip(),
                "segments": normalized_segments,
                "words": all_words,
                "detected_language": getattr(info, "language", None),
                "language_probability": safe_float(getattr(info, "language_probability", None), None),
                "duration_seconds": safe_float(getattr(info, "duration", None), None),
            })
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
    return {
        "duration_seconds": duration,
        "sample_rate": int(stream.get("sample_rate", 0)),
        "channels": int(stream.get("channels", 0)),
        "codec": str(stream.get("codec_name", "")),
        "bit_rate": int(safe_float(stream.get("bit_rate"), safe_float(data.get("format", {}).get("bit_rate"), 0)) or 0),
        "bytes": Path(audio_path).stat().st_size,
    }


def _event_records(envelope, frame_times, kind, source, min_gap=0.15):
    import numpy as np
    from scipy.signal import find_peaks
    maximum = float(np.max(envelope)) if len(envelope) else 0.0
    if maximum <= 1e-9:
        return [], []
    norm = envelope / maximum
    frame_rate = 1.0 / max(1e-9, float(frame_times[1] - frame_times[0])) if len(frame_times) > 1 else 43.0
    idx, props = find_peaks(norm, distance=max(1, int(min_gap * frame_rate)), prominence=0.10)
    raw_times = [round(float(frame_times[i]), 4) for i in idx]
    records = []
    prominences = props.get("prominences", np.ones(len(idx)))
    for n, i in enumerate(idx):
        strength = clamp(norm[i])
        prominence = clamp(prominences[n])
        records.append({
            "time": round(float(frame_times[i]), 4),
            "type": kind,
            "strength": round(strength, 4),
            "confidence": round(0.55 + 0.4 * prominence, 4),
            "source": source,
        })
    return raw_times, records


def acoustic_summary(audio_path: Path) -> dict:
    """Analyze the complete decoded file and return legacy + universal fields.

    Frequency-band attacks are deliberately described as energy attacks, not as
    isolated instruments. Meter/downbeat labels are heuristic unless a dedicated
    beat-tracking backend is added later.
    """
    started = time.time()
    result = {
        "available": False,
        "schema_version": 3,
        "bpm": None,
        "warnings": [],
        "coverage": {"complete": False},
        "capabilities": local_capabilities(),
    }
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
        result["coverage"] = {
            "complete": complete,
            "source_seconds": meta["duration_seconds"],
            "decoded_seconds": round(duration, 6),
            "processed_seconds": round(duration, 6),
            "samples_decoded": len(y),
            "analysis_sample_rate": sr,
            "range": [0, round(duration, 6)],
            "decoder": "ffmpeg-xerror",
        }
        result["source"] = meta
        if not complete:
            result["warnings"].append("Durée décodée différente de la durée source : analyse non validée.")

        rms = librosa.feature.rms(y=y, frame_length=n_fft, hop_length=hop, center=True)[0]
        onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        stft = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop, center=True))
        times = librosa.frames_to_time(np.arange(stft.shape[1]), sr=sr, hop_length=hop)
        common = min(len(rms), len(onset), stft.shape[1], len(times))
        rms, onset, stft, times = rms[:common], onset[:common], stft[:, :common], times[:common]
        frequencies = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        low_mask = (frequencies >= 20) & (frequencies <= 120)
        bass_mask = (frequencies >= 60) & (frequencies <= 250)
        low = (stft[low_mask] ** 2).mean(axis=0)
        bass = (stft[bass_mask] ** 2).mean(axis=0)
        chroma = librosa.feature.chroma_stft(S=stft, sr=sr)
        centroid = librosa.feature.spectral_centroid(S=stft, sr=sr)[0]
        rolloff = librosa.feature.spectral_rolloff(S=stft, sr=sr, roll_percent=0.85)[0]
        zcr = librosa.feature.zero_crossing_rate(y, frame_length=n_fft, hop_length=hop)[0][:common]

        if float(rms.max()) > 1e-5 and float(onset.max()) > 1e-7:
            tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, trim=True)
            bpm = float(np.asarray(tempo).reshape(-1)[0])
            beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
            beat_conf = clamp((len(beat_times) * 60.0 / max(duration * max(bpm, 1), 1)) * 0.8 + 0.2)
        else:
            bpm, beat_frames, beat_times, beat_conf = 0.0, np.array([], dtype=int), np.array([]), 0.0
            result["warnings"].append("Signal silencieux ou sans pulsation fiable ; aucun BPM imposé.")

        onset_times, onset_records = _event_records(onset, times, "onset", "spectral-flux")
        low_delta = np.maximum(0, np.diff(np.log1p(low), prepend=np.log1p(low[:1])))
        bass_delta = np.maximum(0, np.diff(np.log1p(bass), prepend=np.log1p(bass[:1])))
        low_events, low_records = _event_records(low_delta, times, "low_band_attack", "20-120hz")
        bass_events, bass_records = _event_records(bass_delta, times, "bass_band_attack", "60-250hz")

        local_tempo = []
        if bpm > 0 and duration >= 6:
            win_sec, step_sec = 10.0, 5.0
            for start in np.arange(0, max(0.001, duration - 3), step_sec):
                end = min(duration, start + win_sec)
                a, b = int(start * sr / hop), min(len(onset), int(end * sr / hop))
                if b - a < 8 or float(np.max(onset[a:b])) <= 1e-7:
                    continue
                estimate = librosa.feature.tempo(onset_envelope=onset[a:b], sr=sr, hop_length=hop, aggregate=np.median)
                value = safe_float(np.asarray(estimate).reshape(-1)[0], None)
                if value:
                    local_tempo.append({"t": round((start + end) / 2, 3), "bpm": round(value, 2)})
        tempo_values = [p["bpm"] for p in local_tempo]
        variability = (float(np.std(tempo_values)) / max(1.0, float(np.mean(tempo_values)))) if tempo_values else 0.0
        tempo_mode = "unknown" if not bpm else ("variable" if variability > 0.055 else "stable")

        block = max(1, int(0.5 * sr / hop))
        descriptors = []
        for i in range(0, len(rms), block):
            c = chroma[:, i:i + block].mean(axis=1)
            c = c / max(1e-9, np.linalg.norm(c))
            descriptors.append(np.r_[c, np.log(max(1e-7, float(rms[i:i + block].mean())))])
        features = np.array(descriptors)
        novelty = np.zeros(len(features))
        for i in range(2, len(features) - 2):
            a, b = features[i-2:i].mean(axis=0), features[i:i+2].mean(axis=0)
            novelty[i] = np.linalg.norm(a[:12] - b[:12]) + min(2, abs(a[-1] - b[-1])) * 0.35
        sec_idx, _ = find_peaks(novelty, distance=16, prominence=0.22)
        bounds = [0.0] + sorted(float(i * block * hop / sr) for i in sec_idx if 6 <= i * block * hop / sr <= duration - 6) + [duration]
        sections = []
        for i, (begin, finish) in enumerate(zip(bounds, bounds[1:])):
            a, b = int(begin * sr / hop), max(int(begin * sr / hop) + 1, int(finish * sr / hop))
            section_rms = rms[a:min(b, len(rms))]
            sections.append({
                "id": f"section-{i+1}", "type": "section", "label": f"Section {i+1} · à qualifier",
                "start": round(begin, 3), "end": round(finish, 3), "source": "acoustic-novelty-proposal",
                "energy_relative": round(float(section_rms.mean()) / max(1e-9, float(rms.max())), 4),
                "confidence": 0.65,
            })

        major = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
        minor = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
        average_chroma = chroma.mean(axis=1)
        tonal = None
        if float(np.std(average_chroma)) > 1e-8:
            candidates = sorted([
                (float(np.corrcoef(average_chroma, np.roll(template, shift))[0,1]), shift, mode)
                for mode, template in [("major", major), ("minor", minor)] for shift in range(12)
            ], reverse=True)
            score, shift, mode = candidates[0]
            tonal = {
                "candidate": ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][shift] + " " + mode,
                "correlation": round(score, 3), "margin": round(score - candidates[1][0], 3),
                "status": "estimated-not-validated",
            }

        silence_threshold = max(1e-7, float(np.percentile(rms, 12)) * 1.35)
        silent = rms <= silence_threshold
        silences = []
        s0 = None
        for i, flag in enumerate(silent):
            if flag and s0 is None:
                s0 = i
            if (not flag or i == len(silent) - 1) and s0 is not None:
                e = i if not flag else i + 1
                start, end = float(times[s0]), float(times[min(e - 1, len(times)-1)])
                if end - start >= 0.35:
                    silences.append({"start": round(start,3), "end": round(end,3), "duration": round(end-start,3)})
                s0 = None

        stride = max(1, int(np.ceil(len(rms) / 3000)))
        curves = []
        cmax = max(1.0, float(np.max(centroid)))
        rmax = max(1.0, float(np.max(rolloff)))
        for i in range(0, len(rms), stride):
            curves.append({
                "t": round(float(times[i]), 4), "rms": round(float(rms[i]), 6), "onset": round(float(onset[i]), 6),
                "low_energy": round(float(low[i]), 5), "bass_energy": round(float(bass[i]), 5),
                "brightness": round(float(centroid[i] / cmax), 5), "rolloff": round(float(rolloff[i] / rmax), 5),
            })
        buckets = min(1800, max(1, int(duration * 10)))
        waveform = []
        for i in range(buckets):
            chunk = y[int(i * len(y) / buckets):int((i + 1) * len(y) / buckets)]
            if len(chunk):
                waveform.append({"t": round(i * duration / buckets,4), "min": round(float(chunk.min()),5), "max": round(float(chunk.max()),5)})

        peaks = np.argsort(rms)[-min(len(rms), 200):][::-1]
        selected = []
        for i in peaks:
            t = float(times[i])
            if all(abs(t - old) > 2 for old in selected):
                selected.append(t)
            if len(selected) == 15:
                break
        db = 20 * np.log10(np.maximum(rms, 1e-9))

        combined = onset_records + low_records + bass_records
        max_rms = max(1e-9, float(rms.max()))
        for t in selected:
            idx = min(len(rms)-1, int(round(t * sr / hop)))
            combined.append({"time": round(t,4), "type": "energy_peak", "strength": round(float(rms[idx]/max_rms),4),
                             "confidence": 0.9, "source": "rms"})
        for section in sections[1:]:
            combined.append({"time": section["start"], "type": "section_boundary", "strength": 0.8,
                             "confidence": section["confidence"], "source": section["source"]})
        combined.sort(key=lambda e: (e["time"], e["type"]))
        for event in combined:
            base = event["strength"] * event["confidence"]
            boost = 0.12 if event["type"] in ("energy_peak", "section_boundary") else 0.0
            event["edit_importance"] = round(clamp(base + boost), 4)
        edit_candidates = sorted((e for e in combined if e["edit_importance"] >= 0.55),
                                 key=lambda e: e["edit_importance"], reverse=True)[:80]
        edit_candidates.sort(key=lambda e: e["time"])

        beat_list = [round(float(t),4) for t in beat_times if t <= duration]
        downbeats = beat_list[::4] if len(beat_list) >= 8 else []
        vocal_likelihood = clamp((float(np.mean(zcr)) * 5.0) + (float(np.mean(centroid)) / max(sr / 2, 1)) * 1.5)
        rhythmic_density = clamp(len(onset_times) / max(duration * 3.0, 1.0))
        dynamic_norm = clamp((float(np.percentile(db,95)-np.percentile(db,5))) / 35.0)
        dominant_driver = "rhythm"
        if beat_conf < 0.45:
            dominant_driver = "phrasing+dynamics"
        elif rhythmic_density < 0.18:
            dominant_driver = "dynamics+structure"
        music_profile = {
            "tempo_mode": tempo_mode, "global_bpm": round(bpm,2) if bpm > 0 else None,
            "beat_confidence": round(beat_conf,4), "rhythmic_density": round(rhythmic_density,4),
            "dynamic_range_normalized": round(dynamic_norm,4),
            "vocal_likelihood_acoustic_only": round(vocal_likelihood,4),
            "dominant_edit_driver": dominant_driver,
            "note": "Le profil guide le réalisateur IA ; il ne déclenche aucun effet automatiquement.",
        }

        result.update({
            "available": True, "method": "universal-local-full-file-v3", "duration_seconds": round(duration,6),
            "bpm": round(bpm,2) if bpm > 0 else None, "beat_times": beat_list, "beat_count": len(beat_list),
            "onset_times": onset_times,
            "band_events": {"20_120_hz": low_events, "60_250_hz": bass_events,
                            "interpretation": "overlapping-band-energy-attacks-not-isolated-instruments"},
            "tempo": {"global_bpm": round(bpm,2) if bpm > 0 else None, "mode": tempo_mode,
                      "confidence": round(beat_conf,4), "local_curve": local_tempo, "variability": round(variability,4)},
            "beat_grid": {"beats": beat_list, "downbeats_estimated": downbeats, "meter_assumption": 4 if downbeats else None,
                          "status": "heuristic-estimate"},
            "spectral": {"centroid_hz_mean": round(float(np.mean(centroid)),2),
                         "rolloff_hz_mean": round(float(np.mean(rolloff)),2),
                         "zero_crossing_rate_mean": round(float(np.mean(zcr)),6)},
            "silences": silences, "curves": curves, "waveform": waveform, "sections": sections, "tonality": tonal,
            "energy_rms": round(float(rms.mean()),6), "energy_peak": round(float(rms.max()),6),
            "rms_range_db_p95_p05": round(float(np.percentile(db,95)-np.percentile(db,5)),2),
            "rms_peak_times": sorted(round(t,4) for t in selected), "onset_mean": round(float(onset.mean()),6),
            "events": combined[:1200], "edit_candidates": edit_candidates, "music_profile": music_profile,
        })
        result["warnings"].append(
            "BPM, tonalité, downbeats et frontières sont des estimations ; les attaques graves ne prouvent pas la présence d’un kick ou d’une basse isolée."
        )
    except Exception as error:
        result["warnings"].append("Analyse acoustique intégrale indisponible : " + str(error)[:800])
        result["coverage"]["complete"] = False
    result["runtime_seconds"] = round(time.time() - started, 3)
    return result


def merge_timeline(acoustic: dict, transcription: dict) -> dict:
    timeline = [dict(e) for e in acoustic.get("edit_candidates", [])]
    words = transcription.get("words") or [w for s in transcription.get("segments", []) for w in s.get("words", [])]
    for word in words:
        start = safe_float(word.get("start"), None)
        if start is None:
            continue
        probability = safe_float(word.get("probability"), 0.65)
        text = str(word.get("word", "")).strip()
        if not text:
            continue
        timeline.append({
            "time": round(start,4), "type": "vocal_word", "word": text,
            "end": round(safe_float(word.get("end"), start),4), "strength": 0.78,
            "confidence": round(clamp(probability if probability is not None else 0.65),4),
            "edit_importance": round(clamp(0.55 + 0.35 * (probability or 0.5)),4),
            "source": "faster-whisper-word-timestamp",
        })
    timeline.sort(key=lambda e: (e["time"], 0 if e["type"] == "vocal_word" else 1))
    out = []
    for event in timeline:
        if event["type"] == "vocal_word":
            out.append(event)
            continue
        if out and out[-1].get("type") != "vocal_word" and abs(event["time"] - out[-1]["time"]) < 0.06:
            if event.get("edit_importance",0) > out[-1].get("edit_importance",0):
                out[-1] = event
        else:
            out.append(event)
    return {
        "schema_version": 1, "events": out[:2000], "event_count": min(len(out), 2000),
        "sync_policy": {"short_vocal_gesture_ms": 80, "cut_frames": 2, "continuous_motion_ms": 150,
                        "priority": ["vocal_onset", "musical_impact", "master_motion", "theoretical_timecode"]},
    }


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
    transcription = ({"ok": False, "skipped": True, "reason": "instrumental-requested", "segments": [], "words": [],
                      "transcript": "", "warnings": []} if skip else transcribe(audio_path))
    transcription["acoustic"] = acoustic
    transcription["timeline_map"] = merge_timeline(acoustic, transcription)
    transcription["music_profile"] = acoustic.get("music_profile", {})
    transcription["local_capabilities"] = local_capabilities()
    transcription["schema_version"] = 3
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
