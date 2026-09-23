from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QDir, QLockFile, QStandardPaths, QUrl
from PySide6.QtGui import QAction, QIcon
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtWidgets import QApplication, QMenu, QSystemTrayIcon

from backend import ElyneaBridge


APP_NAME = "Elynea Desktop"
ORG_NAME = "JS-Innov.IA"


def resource_root() -> Path:
    frozen_root = getattr(sys, "_MEIPASS", None)
    return Path(frozen_root) if frozen_root else Path(__file__).resolve().parent


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName(ORG_NAME)
    app.setQuitOnLastWindowClosed(False)

    lock_path = Path(QStandardPaths.writableLocation(QStandardPaths.TempLocation)) / "elynea-desktop-qml.lock"
    lock = QLockFile(str(lock_path))
    lock.setStaleLockTime(0)
    if not lock.tryLock(100):
        return 0

    root = resource_root()
    backend = ElyneaBridge(root)

    engine = QQmlApplicationEngine()
    engine.rootContext().setContextProperty("elyneaBridge", backend)
    engine.rootContext().setContextProperty(
        "assetsBaseUrl",
        QUrl.fromLocalFile(QDir.cleanPath(str(root / "resources"))).toString(),
    )
    engine.rootContext().setContextProperty("startMinimized", "--minimized" in sys.argv)
    engine.load(QUrl.fromLocalFile(str(root / "qml" / "Main.qml")))

    if not engine.rootObjects():
        backend.shutdown()
        return 2

    root_window = engine.rootObjects()[0]

    tray = None
    if QSystemTrayIcon.isSystemTrayAvailable():
        avatar = root / "resources" / "elynea.webp"
        tray = QSystemTrayIcon(QIcon(str(avatar)), app)
        tray.setToolTip("Elynea — Companion JS-Innov.IA")

        menu = QMenu()
        show_action = QAction("Afficher Elynea", menu)
        show_action.triggered.connect(backend.requestShow)
        menu.addAction(show_action)

        cockpit_action = QAction("Ouvrir le Cockpit", menu)
        cockpit_action.triggered.connect(backend.openCockpit)
        menu.addAction(cockpit_action)

        menu.addSeparator()

        quit_action = QAction("Quitter Elynea", menu)
        quit_action.triggered.connect(backend.requestQuit)
        menu.addAction(quit_action)

        tray.setContextMenu(menu)
        tray.activated.connect(
            lambda reason: backend.requestShow()
            if reason in (
                QSystemTrayIcon.ActivationReason.Trigger,
                QSystemTrayIcon.ActivationReason.DoubleClick,
            )
            else None
        )
        tray.show()

    backend.quitRequested.connect(app.quit)
    app.aboutToQuit.connect(backend.shutdown)

    exit_code = app.exec()
    lock.unlock()
    _ = root_window, tray
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
