import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
QML_ROOT = ROOT / "elynea-qml"


class ElyneaQmlContractTest(unittest.TestCase):
    def read(self, relative):
        return (QML_ROOT / relative).read_text(encoding="utf-8")

    def test_window_is_transparent_frameless_and_always_on_top(self):
        qml = self.read("qml/Main.qml")
        self.assertIn('color: "transparent"', qml)
        self.assertIn("Qt.FramelessWindowHint", qml)
        self.assertIn("Qt.WindowStaysOnTopHint", qml)
        self.assertIn("Qt.Tool", qml)

    def test_local_agent_and_whisper_are_reused(self):
        backend = self.read("backend.py")
        self.assertIn("127.0.0.1", backend)
        self.assertIn("/api/agent/chat", backend)
        self.assertIn("/api/music-motion/production/assets", backend)
        self.assertIn("/api/music-motion/production/jobs", backend)
        self.assertIn("LOCAL_AGENT_TOKEN", backend)

    def test_wake_word_and_windows_autostart_exist(self):
        backend = self.read("backend.py")
        self.assertIn("WAKE_WORDS", backend)
        self.assertIn("setWakeEnabled", backend)
        self.assertIn('ELYNEA_WAKE_DEFAULT", "1"', backend)
        self.assertIn("ElyneaDesktop", backend)
        self.assertIn("CurrentVersion", backend)
        self.assertIn("Run", backend)

    def test_canonical_avatar_is_packaged(self):
        avatar = QML_ROOT / "resources" / "elynea.webp"
        self.assertTrue(avatar.exists())
        self.assertGreater(avatar.stat().st_size, 1000)

    def test_no_feather_branding_is_added(self):
        content = self.read("qml/Main.qml") + self.read("backend.py")
        self.assertNotIn("plume", content.lower())
        self.assertNotIn("feather", content.lower())

    def test_companion_is_detached_from_web_ui(self):
        main = self.read("main.py")
        self.assertIn("QSystemTrayIcon", main)
        self.assertIn("QLockFile", main)
        self.assertIn("QQmlApplicationEngine", main)


if __name__ == "__main__":
    unittest.main()
