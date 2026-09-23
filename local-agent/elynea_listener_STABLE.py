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
    # Runtime health companion only. Actual audio capture stays in Electron where\n    # microphone permission and Whisper IPC are controlled. This process does NOT\n    # implement wake-word detection and must never advertise that capability.
    last = None
    while True:
        port = health_port()
        state = {"wake_word": WAKE_WORD, "wake_word_available": False, "wake_word_status": "not_implemented", "agent_port": port, "ready": port is not None}
        if state != last:
            print(json.dumps(state), flush=True)
            last = state
        time.sleep(5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
