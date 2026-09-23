import os
import sys
import time
import json
import urllib.request

WAKE_WORD = os.getenv("ELYNEA_WAKE_WORD", "elynea").strip().lower()
AGENT_PORTS = [8788, 8787]


def health_port():
    for port in AGENT_PORTS:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1.0) as response:
                if response.status == 200:
                    return port
        except Exception:
            pass
    return None


def main():
    # Stable launcher/health companion for the desktop runtime. Actual audio capture
    # stays in Electron where microphone permission and Whisper IPC are controlled.
    # This process is intentionally dependency-light and never opens a second mic.
    last = None
    while True:
        port = health_port()
        state = {"wake_word": WAKE_WORD, "agent_port": port, "ready": port is not None}
        if state != last:
            print(json.dumps(state), flush=True)
            last = state
        time.sleep(5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
