from __future__ import annotations

import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from PySide6.QtCore import QObject, Property, QTimer, Signal, Slot
from PySide6.QtMultimedia import QAudioFormat, QAudioSource, QMediaDevices

try:
    from PySide6.QtTextToSpeech import QTextToSpeech
except Exception:
    QTextToSpeech = None


COCKPIT_URL = os.environ.get("ELYNEA_COCKPIT_URL", "https://cockpit.jsinnovia.com")
LOCAL_PORTS = (8788, 8787)
CHAT_SYSTEM_PROMPT = (
    "Tu es Elynea, le Companion local permanent de JS-Innov.IA. "
    "Tu es la même identité que dans le Cockpit. Utilise uniquement les capacités réellement disponibles, "
    "ne prétends jamais avoir exécuté une action sans preuve, et indique clairement lorsqu'une opération "
    "doit être poursuivie dans le Cockpit. Réponds en français, de façon concise et opérationnelle."
)
WAKE_WORDS = ("elynea", "elina", "elyna", "elena", "helena")


def _json_request(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    body: bytes | None = None,
    content_type: str = "application/json",
    timeout: float = 8.0,
) -> dict[str, Any]:
    token = os.environ.get("LOCAL_AGENT_TOKEN", "").strip()
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = body
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        content_type = "application/json"
    if data is not None:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        parsed = json.loads(raw.decode("utf-8")) if raw else {}
        if not isinstance(parsed, dict):
            raise RuntimeError("Réponse locale invalide.")
        return parsed


def _normalized_text(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.lower().strip()


def _wake_command(transcript: str) -> tuple[bool, str]:
    normalized = _normalized_text(transcript)
    for wake in WAKE_WORDS:
        match = re.search(rf"\b{re.escape(wake)}\b(.*)$", normalized)
        if match:
            raw_tail = match.group(1).strip(" ,;:.-!?")
            if not raw_tail:
                return True, ""
            original = re.split(
                r"\b(?:elynea|él[y]?nea|elina|elyna|elena|helena)\b",
                transcript,
                maxsplit=1,
                flags=re.I,
            )
            return True, (original[1] if len(original) > 1 else raw_tail).strip(" ,;:.-!?")
    return False, ""


class ElyneaBridge(QObject):
    stateChanged = Signal()
    endpointChanged = Signal()
    detailChanged = Signal()
    autostartChanged = Signal()
    wakeChanged = Signal()
    listeningChanged = Signal()
    voiceOutputChanged = Signal()

    messageAdded = Signal(str, str)
    transcriptReady = Signal(str)
    wakeDetected = Signal()
    showRequested = Signal()
    hideRequested = Signal()
    quitRequested = Signal()

    _healthFinished = Signal(dict)
    _chatFinished = Signal(dict)
    _voiceFinished = Signal(dict)

    def __init__(self, resource_root: Path, parent: QObject | None = None):
        super().__init__(parent)
        self.resource_root = Path(resource_root)
        self._executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="elynea-qml")
        self._state = "checking"
        self._detail = "Connexion à Elynea locale…"
        self._endpoint = ""
        self._history: list[dict[str, str]] = []
        self._busy = False
        self._wake_enabled = False
        self._voice_output_enabled = True
        self._agent_spawn_attempted = False
        self._capture_kind = ""
        self._audio_source: QAudioSource | None = None
        self._audio_io = None
        self._audio_format: QAudioFormat | None = None
        self._audio_buffer = bytearray()

        self._voice_timer = QTimer(self)
        self._voice_timer.setSingleShot(True)
        self._voice_timer.timeout.connect(self._finish_timed_capture)

        self._healthFinished.connect(self._apply_health)
        self._chatFinished.connect(self._apply_chat)
        self._voiceFinished.connect(self._apply_voice)

        self._health_timer = QTimer(self)
        self._health_timer.setInterval(15_000)
        self._health_timer.timeout.connect(self.refreshHealth)
        self._health_timer.start()

        self._tts = None
        if QTextToSpeech is not None:
            try:
                self._tts = QTextToSpeech(self)
                self._tts.setRate(-0.06)
                self._tts.setPitch(0.0)
                self._tts.setVolume(0.9)
                self._tts.stateChanged.connect(self._on_tts_state)
            except Exception:
                self._tts = None

        QTimer.singleShot(120, self.refreshHealth)

    @Property(str, notify=stateChanged)
    def state(self) -> str:
        return self._state

    @Property(str, notify=detailChanged)
    def detail(self) -> str:
        return self._detail

    @Property(str, notify=endpointChanged)
    def endpoint(self) -> str:
        return self._endpoint

    @Property(bool, notify=autostartChanged)
    def autostartEnabled(self) -> bool:
        return self._autostart_enabled()

    @Property(bool, notify=wakeChanged)
    def wakeEnabled(self) -> bool:
        return self._wake_enabled

    @Property(bool, notify=listeningChanged)
    def listening(self) -> bool:
        return self._audio_source is not None

    @Property(bool, notify=voiceOutputChanged)
    def voiceOutputEnabled(self) -> bool:
        return self._voice_output_enabled

    def _set_state(self, state: str, detail: str | None = None) -> None:
        if state != self._state:
            self._state = state
            self.stateChanged.emit()
        if detail is not None and detail != self._detail:
            self._detail = detail
            self.detailChanged.emit()

    def _set_endpoint(self, endpoint: str) -> None:
        if endpoint != self._endpoint:
            self._endpoint = endpoint
            self.endpointChanged.emit()

    def _discover_endpoint(self, timeout: float = 2.0) -> tuple[str, dict[str, Any]]:
        last_error: Exception | None = None
        for port in LOCAL_PORTS:
            base = f"http://127.0.0.1:{port}"
            try:
                health = _json_request(f"{base}/health", timeout=timeout)
                if health.get("ok"):
                    return base, health
            except Exception as error:
                last_error = error

        if not self._agent_spawn_attempted:
            self._agent_spawn_attempted = True
            self._try_launch_local_agent()
            if last_error:
                time.sleep(1.1)
            for port in LOCAL_PORTS:
                base = f"http://127.0.0.1:{port}"
                try:
                    health = _json_request(f"{base}/health", timeout=timeout)
                    if health.get("ok"):
                        return base, health
                except Exception as error:
                    last_error = error

        raise RuntimeError(str(last_error or "Agent local Elynea indisponible."))

    def _candidate_agent_dirs(self) -> list[Path]:
        candidates = [
            self.resource_root / "local-agent",
            Path(__file__).resolve().parents[1] / "local-agent",
        ]
        override = os.environ.get("ELYNEA_LOCAL_AGENT_DIR")
        if override:
            candidates.insert(0, Path(override))
        unique: list[Path] = []
        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved not in unique:
                unique.append(resolved)
        return unique

    def _try_launch_local_agent(self) -> None:
        node = shutil.which("node")
        if not node:
            return
        for directory in self._candidate_agent_dirs():
            server = directory / "server.js"
            if not server.exists():
                continue
            env = dict(os.environ)
            env.setdefault("LOCAL_AGENT_PORT", "8788")
            flags = 0
            if sys.platform == "win32":
                flags = (
                    getattr(subprocess, "CREATE_NO_WINDOW", 0)
                    | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                    | getattr(subprocess, "DETACHED_PROCESS", 0)
                )
            try:
                subprocess.Popen(
                    [node, str(server)],
                    cwd=str(directory),
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=flags,
                    close_fds=sys.platform != "win32",
                )
                return
            except Exception:
                continue

    @Slot()
    def refreshHealth(self) -> None:
        def work() -> dict[str, Any]:
            try:
                endpoint, health = self._discover_endpoint()
                services = health.get("services") or {}
                ollama = services.get("ollama") or {}
                return {
                    "ok": True,
                    "endpoint": endpoint,
                    "model_online": bool(ollama.get("online")),
                    "agent_version": (health.get("agent") or {}).get("version"),
                }
            except Exception as error:
                return {"ok": False, "error": str(error)}

        self._executor.submit(lambda: self._healthFinished.emit(work()))

    @Slot(dict)
    def _apply_health(self, result: dict[str, Any]) -> None:
        if result.get("ok"):
            self._set_endpoint(str(result.get("endpoint") or ""))
            if self._state in {"checking", "offline", "error"}:
                self._set_state("ready", "Elynea locale est disponible.")
        else:
            self._set_endpoint("")
            if not self.listening and not self._busy:
                self._set_state("offline", "Agent local hors ligne. Le Cockpit reste accessible.")

    @Slot(str)
    def sendMessage(self, text: str) -> None:
        message = str(text or "").strip()
        if not message or self._busy:
            return

        self._busy = True
        self._cancel_capture()
        self._history.append({"role": "user", "content": message})
        self._history = self._history[-24:]
        self.messageAdded.emit("user", message)
        self._set_state("thinking", "Elynea réfléchit…")
        history = list(self._history)

        def work() -> dict[str, Any]:
            try:
                endpoint, _ = self._discover_endpoint(timeout=3.0)
                result = _json_request(
                    f"{endpoint}/api/agent/chat",
                    method="POST",
                    payload={
                        "message": message,
                        "history": history[-20:],
                        "system_prompt": CHAT_SYSTEM_PROMPT,
                        "context": {"source": "elynea-qml-desktop", "desktop_companion": True},
                    },
                    timeout=95,
                )
                reply = str(
                    result.get("response")
                    or result.get("message")
                    or result.get("reply")
                    or ""
                ).strip()
                if not reply:
                    reply = "Elynea locale n’a produit aucune réponse exploitable."
                return {"ok": True, "reply": reply, "endpoint": endpoint}
            except Exception as error:
                return {"ok": False, "error": str(error)}

        self._executor.submit(lambda: self._chatFinished.emit(work()))

    @Slot(dict)
    def _apply_chat(self, result: dict[str, Any]) -> None:
        self._busy = False
        if result.get("ok"):
            reply = str(result.get("reply") or "")
            self._set_endpoint(str(result.get("endpoint") or self._endpoint))
            self._history.append({"role": "assistant", "content": reply})
            self._history = self._history[-24:]
            self.messageAdded.emit("assistant", reply)
            if self._voice_output_enabled and self._tts is not None:
                self._set_state("speaking", "Elynea répond…")
                try:
                    self._tts.say(reply[:1000])
                    return
                except Exception:
                    pass
            self._set_state("ready", "En ligne")
        else:
            error = str(result.get("error") or "Agent local indisponible.")
            self.messageAdded.emit("assistant", f"⚠️ {error}")
            self._set_state("offline", "Agent local indisponible.")
        self._resume_wake_later()

    @Slot(object)
    def _on_tts_state(self, state: object) -> None:
        if self._tts is None:
            return
        ready_state = getattr(getattr(QTextToSpeech, "State", object), "Ready", None)
        if ready_state is not None and state == ready_state and not self._busy:
            self._set_state("ready", "En ligne")
            self._resume_wake_later()

    def _audio_format_descriptor(self, fmt: QAudioFormat) -> tuple[int, int, int, int]:
        sample_format = fmt.sampleFormat()
        sample_enum = QAudioFormat.SampleFormat
        if sample_format == sample_enum.UInt8:
            return 1, 8, fmt.channelCount(), fmt.sampleRate()
        if sample_format == sample_enum.Int16:
            return 1, 16, fmt.channelCount(), fmt.sampleRate()
        if sample_format == sample_enum.Int32:
            return 1, 32, fmt.channelCount(), fmt.sampleRate()
        if sample_format == sample_enum.Float:
            return 3, 32, fmt.channelCount(), fmt.sampleRate()
        raise RuntimeError("Format microphone non pris en charge.")

    def _start_capture(self, kind: str, *, duration_ms: int | None = None) -> None:
        if self._audio_source is not None or self._busy:
            return

        device = QMediaDevices.defaultAudioInput()
        if device.isNull():
            self._set_state("error", "Aucun microphone Windows disponible.")
            return

        fmt = QAudioFormat()
        fmt.setSampleRate(16_000)
        fmt.setChannelCount(1)
        fmt.setSampleFormat(QAudioFormat.SampleFormat.Int16)
        if not device.isFormatSupported(fmt):
            fmt = device.preferredFormat()

        try:
            self._audio_format_descriptor(fmt)
            source = QAudioSource(device, fmt, self)
            io_device = source.start()
            if io_device is None:
                raise RuntimeError("Le microphone n’a pas pu démarrer.")
            self._audio_source = source
            self._audio_io = io_device
            self._audio_format = fmt
            self._audio_buffer = bytearray()
            self._capture_kind = kind
            io_device.readyRead.connect(self._read_audio)
            self.listeningChanged.emit()

            if kind == "wake":
                self._set_state("wake", "À l’écoute de « Elynea »…")
            else:
                self._set_state("listening", "Je t’écoute…")

            if duration_ms:
                self._voice_timer.start(duration_ms)
        except Exception as error:
            self._cancel_capture()
            self._set_state("error", f"Microphone : {error}")

    @Slot()
    def _read_audio(self) -> None:
        if self._audio_io is None:
            return
        try:
            self._audio_buffer.extend(bytes(self._audio_io.readAll()))
        except Exception:
            pass

    def _wav_from_capture(self) -> bytes:
        if self._audio_format is None:
            return b""
        format_tag, bits, channels, sample_rate = self._audio_format_descriptor(self._audio_format)
        raw = bytes(self._audio_buffer)
        block_align = max(1, channels * bits // 8)
        byte_rate = sample_rate * block_align
        return (
            b"RIFF"
            + struct.pack("<I", 36 + len(raw))
            + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, format_tag, channels, sample_rate, byte_rate, block_align, bits)
            + b"data"
            + struct.pack("<I", len(raw))
            + raw
        )

    def _stop_capture(self) -> tuple[str, bytes]:
        kind = self._capture_kind
        self._voice_timer.stop()
        self._read_audio()
        wav = self._wav_from_capture()

        source = self._audio_source
        self._audio_source = None
        self._audio_io = None
        self._audio_format = None
        self._capture_kind = ""
        self._audio_buffer = bytearray()

        if source is not None:
            try:
                source.stop()
                source.deleteLater()
            except Exception:
                pass

        self.listeningChanged.emit()
        return kind, wav

    def _cancel_capture(self) -> None:
        if self._audio_source is not None:
            self._stop_capture()

    @Slot()
    def startListening(self) -> None:
        if not self._busy:
            self._start_capture("manual")

    @Slot()
    def stopListening(self) -> None:
        if self._audio_source is None:
            return

        kind, wav = self._stop_capture()
        if not wav or len(wav) < 1024:
            self._set_state("ready", "Aucune parole détectée.")
            self._resume_wake_later()
            return

        self._transcribe(
            wav,
            wake_check=(kind == "wake"),
            command_capture=(kind == "command"),
        )

    @Slot()
    def toggleListening(self) -> None:
        if self.listening:
            self.stopListening()
        else:
            if self._wake_enabled:
                self._wake_enabled = False
                self.wakeChanged.emit()
            self.startListening()

    @Slot()
    def _finish_timed_capture(self) -> None:
        self.stopListening()

    def _transcribe(self, wav: bytes, *, wake_check: bool, command_capture: bool = False) -> None:
        self._set_state("transcribing", "Whisper local transcrit…")

        def work() -> dict[str, Any]:
            try:
                endpoint, _ = self._discover_endpoint(timeout=3.0)
                asset_name = f"elynea-qml-voice-{int(time.time() * 1000)}.wav"
                asset = _json_request(
                    f"{endpoint}/api/music-motion/production/assets?name={urllib.parse.quote(asset_name)}",
                    method="POST",
                    body=wav,
                    content_type="audio/wav",
                    timeout=30,
                )
                asset_id = asset.get("id")
                if not asset_id:
                    raise RuntimeError("Whisper local : audio non importé.")

                job = _json_request(
                    f"{endpoint}/api/music-motion/production/jobs",
                    method="POST",
                    payload={"type": "analyze", "audio_id": asset_id, "instrumental": False},
                    timeout=30,
                )
                job_id = job.get("id")
                if not job_id:
                    raise RuntimeError("Whisper local : job absent.")

                deadline = time.time() + 120
                while time.time() < deadline:
                    status = str(job.get("status") or "")
                    if status == "completed":
                        transcript = str(
                            ((job.get("result") or {}).get("transcription") or {}).get("transcript") or ""
                        ).strip()
                        if not transcript:
                            raise RuntimeError("Whisper local n’a détecté aucune parole.")
                        return {
                            "ok": True,
                            "transcript": transcript,
                            "wake_check": wake_check,
                            "command_capture": command_capture,
                            "endpoint": endpoint,
                        }
                    if status in {"failed", "cancelled"}:
                        raise RuntimeError(str(job.get("error") or f"Transcription {status}."))

                    time.sleep(0.45)
                    job = _json_request(
                        f"{endpoint}/api/music-motion/production/jobs/{urllib.parse.quote(str(job_id))}",
                        timeout=15,
                    )

                raise RuntimeError("Whisper local : délai dépassé.")
            except Exception as error:
                return {
                    "ok": False,
                    "error": str(error),
                    "wake_check": wake_check,
                    "command_capture": command_capture,
                }

        self._executor.submit(lambda: self._voiceFinished.emit(work()))

    @Slot(dict)
    def _apply_voice(self, result: dict[str, Any]) -> None:
        if not result.get("ok"):
            if result.get("wake_check") and self._wake_enabled:
                self._set_state("wake", "À l’écoute de « Elynea »…")
                QTimer.singleShot(700, self._begin_wake_if_possible)
                return
            self._set_state("error", str(result.get("error") or "Transcription impossible."))
            self._resume_wake_later()
            return

        transcript = str(result.get("transcript") or "").strip()
        self.transcriptReady.emit(transcript)
        self._set_endpoint(str(result.get("endpoint") or self._endpoint))

        if result.get("wake_check"):
            detected, command = _wake_command(transcript)
            if not detected:
                self._set_state("wake", "À l’écoute de « Elynea »…")
                QTimer.singleShot(450, self._begin_wake_if_possible)
                return

            self.wakeDetected.emit()
            if command:
                self.sendMessage(command)
                return

            self._set_state("listening", "Oui Julien ?")
            QTimer.singleShot(250, lambda: self._start_capture("command", duration_ms=7000))
            return

        if transcript:
            self.sendMessage(transcript)
        else:
            self._set_state("ready", "En ligne")
            self._resume_wake_later()

    @Slot(bool)
    def setWakeEnabled(self, enabled: bool) -> None:
        enabled = bool(enabled)
        if enabled == self._wake_enabled:
            return

        self._wake_enabled = enabled
        self.wakeChanged.emit()

        if enabled:
            self._set_state("wake", "À l’écoute de « Elynea »…")
            QTimer.singleShot(120, self._begin_wake_if_possible)
        elif self._capture_kind == "wake":
            self._cancel_capture()
            self._set_state("ready", "Appel vocal désactivé.")

    def _begin_wake_if_possible(self) -> None:
        if (
            self._wake_enabled
            and not self._busy
            and self._audio_source is None
            and self._state not in {"speaking", "thinking", "transcribing"}
        ):
            self._start_capture("wake", duration_ms=4500)

    def _resume_wake_later(self) -> None:
        if self._wake_enabled and not self._busy:
            QTimer.singleShot(850, self._begin_wake_if_possible)

    @Slot(bool)
    def setVoiceOutputEnabled(self, enabled: bool) -> None:
        enabled = bool(enabled)
        if enabled == self._voice_output_enabled:
            return

        self._voice_output_enabled = enabled
        self.voiceOutputChanged.emit()

        if not enabled and self._tts is not None:
            try:
                self._tts.stop()
            except Exception:
                pass
            self._set_state("ready", "Voix désactivée.")
            self._resume_wake_later()

    @Slot()
    def openCockpit(self) -> None:
        webbrowser.open(COCKPIT_URL)

    def _autostart_command(self) -> str:
        if getattr(sys, "frozen", False):
            parts = [sys.executable, "--minimized"]
        else:
            parts = [sys.executable, str(Path(sys.argv[0]).resolve()), "--minimized"]
        return subprocess.list2cmdline(parts)

    def _autostart_enabled(self) -> bool:
        if sys.platform != "win32":
            return False
        try:
            import winreg
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_READ,
            ) as key:
                value, _ = winreg.QueryValueEx(key, "ElyneaDesktop")
            return bool(value)
        except Exception:
            return False

    @Slot(bool)
    def setAutostartEnabled(self, enabled: bool) -> None:
        if sys.platform != "win32":
            self.messageAdded.emit("assistant", "Le démarrage automatique est géré uniquement sur Windows.")
            return
        try:
            import winreg
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_SET_VALUE,
            ) as key:
                if enabled:
                    winreg.SetValueEx(key, "ElyneaDesktop", 0, winreg.REG_SZ, self._autostart_command())
                else:
                    try:
                        winreg.DeleteValue(key, "ElyneaDesktop")
                    except FileNotFoundError:
                        pass
            self.autostartChanged.emit()
        except Exception as error:
            self.messageAdded.emit("assistant", f"⚠️ Démarrage Windows : {error}")

    @Slot()
    def requestShow(self) -> None:
        self.showRequested.emit()

    @Slot()
    def requestHide(self) -> None:
        self.hideRequested.emit()

    @Slot()
    def requestQuit(self) -> None:
        self.quitRequested.emit()

    def shutdown(self) -> None:
        self._wake_enabled = False
        self._voice_timer.stop()
        self._cancel_capture()
        try:
            if self._tts is not None:
                self._tts.stop()
        except Exception:
            pass
        self._executor.shutdown(wait=False, cancel_futures=True)
