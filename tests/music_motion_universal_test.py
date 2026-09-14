"""Universal Music Intelligence v3 — synthetic audio only, no model download."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location(
    "analyzer", Path(__file__).parents[1] / "local-agent/music_motion_analyzer.py"
)
analyzer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyzer)


class UniversalMusicIntelligenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        sr = 22050
        length = 18.0
        y = np.zeros(int(sr * length), dtype=np.float32)
        for t in np.arange(0.25, length, 0.5):
            i = int(t * sr)
            n = min(int(0.08 * sr), len(y) - i)
            tt = np.arange(n) / sr
            y[i:i+n] += 0.45 * np.sin(2*np.pi*95*tt) * np.exp(-tt*45)
        # Add a brighter second half so novelty/spectral features have evidence.
        t = np.arange(len(y)) / sr
        y[int(9*sr):] += 0.04 * np.sin(2*np.pi*880*t[int(9*sr):])
        cls.file = cls.root / "universal.wav"
        sf.write(cls.file, y, sr)
        cls.result = analyzer.acoustic_summary(cls.file)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_schema_v3_and_complete_coverage(self):
        self.assertTrue(self.result["available"])
        self.assertEqual(self.result["schema_version"], 3)
        self.assertTrue(self.result["coverage"]["complete"])

    def test_universal_tempo_profile_is_machine_readable(self):
        self.assertIn("tempo", self.result)
        self.assertIn("music_profile", self.result)
        self.assertIn(self.result["music_profile"]["dominant_edit_driver"], {
            "rhythm", "phrasing+dynamics", "dynamics+structure"
        })

    def test_edit_events_have_confidence_and_importance(self):
        self.assertTrue(self.result["events"])
        sample = self.result["events"][0]
        self.assertIn("time", sample)
        self.assertIn("confidence", sample)
        self.assertIn("edit_importance", sample)

    def test_spectral_and_silence_layers_exist(self):
        self.assertIn("spectral", self.result)
        self.assertIn("silences", self.result)
        self.assertIn("centroid_hz_mean", self.result["spectral"])

    def test_timeline_can_merge_word_timestamps(self):
        transcription = {
            "segments": [{"words": [{"word": "test", "start": 1.0, "end": 1.2, "probability": 0.9}]}]
        }
        merged = analyzer.merge_timeline(self.result, transcription)
        words = [event for event in merged["events"] if event["type"] == "vocal_word"]
        self.assertEqual(words[0]["word"], "test")
        self.assertIn("sync_policy", merged)


if __name__ == "__main__":
    unittest.main()
