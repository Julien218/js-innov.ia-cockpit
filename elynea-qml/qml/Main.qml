import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

Window {
    id: root

    property bool expanded: false
    property real dragStartX: 0
    property real dragStartY: 0
    property color gold: "#E6C65A"
    property color goldSoft: "#FFF0A8"
    property color night: "#081321"
    property color textSoft: "#BFCDE0"

    width: expanded ? 390 : 136
    height: expanded ? 650 : 136
    minimumWidth: 120
    minimumHeight: 120
    visible: !startMinimized
    color: "transparent"
    title: "Elynea — JS-Innov.IA"
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool

    function dockBottomRight() {
        if (!screen)
            return
        x = screen.availableGeometry.x + screen.availableGeometry.width - width - 24
        y = screen.availableGeometry.y + screen.availableGeometry.height - height - 28
    }

    Component.onCompleted: dockBottomRight()

    Connections {
        target: elyneaBridge

        function onMessageAdded(role, text) {
            chatModel.append({"role": role, "text": text})
            messages.positionViewAtEnd()
        }

        function onTranscriptReady(text) {
            if (text && !elyneaBridge.wakeEnabled)
                prompt.text = text
        }

        function onWakeDetected() {
            root.visible = true
            root.expanded = true
            root.requestActivate()
            root.dockBottomRight()
        }

        function onShowRequested() {
            root.visible = true
            root.expanded = true
            root.requestActivate()
            root.dockBottomRight()
        }

        function onHideRequested() {
            root.visible = false
        }
    }

    ListModel {
        id: chatModel
        Component.onCompleted: append({
            "role": "assistant",
            "text": "Bonjour Julien. Elynea est prête sur ton PC."
        })
    }

    Behavior on width {
        NumberAnimation { duration: 190; easing.type: Easing.OutCubic }
    }

    Behavior on height {
        NumberAnimation { duration: 190; easing.type: Easing.OutCubic }
    }

    Rectangle {
        id: shell
        anchors.fill: parent
        radius: root.expanded ? 26 : width / 2
        color: root.expanded ? "#F0081321" : "#DD0A1728"
        border.width: 1
        border.color: root.gold
        clip: true

        Rectangle {
            anchors.fill: parent
            anchors.margins: 2
            radius: Math.max(0, parent.radius - 2)
            color: "transparent"
            border.width: 1
            border.color: "#35FFFFFF"
        }

        Rectangle {
            id: auraOuter
            visible: !root.expanded
            anchors.centerIn: parent
            width: 124
            height: 124
            radius: width / 2
            color: "transparent"
            border.width: 1
            border.color: elyneaBridge.state === "listening" || elyneaBridge.state === "wake"
                ? "#7D67E8F9"
                : "#6AE6C65A"
            opacity: 0.75

            SequentialAnimation on scale {
                running: !root.expanded
                loops: Animation.Infinite
                NumberAnimation {
                    from: 0.94
                    to: 1.04
                    duration: elyneaBridge.state === "thinking" ? 520 : 1200
                    easing.type: Easing.InOutSine
                }
                NumberAnimation {
                    from: 1.04
                    to: 0.94
                    duration: elyneaBridge.state === "thinking" ? 520 : 1200
                    easing.type: Easing.InOutSine
                }
            }
        }

        Rectangle {
            id: avatarFrame
            width: root.expanded ? 82 : 102
            height: width
            radius: width / 2
            x: root.expanded ? 18 : (root.width - width) / 2
            y: root.expanded ? 17 : (root.height - height) / 2
            color: "#101E31"
            border.width: 2
            border.color: root.gold
            clip: true

            Image {
                anchors.fill: parent
                anchors.margins: 2
                source: assetsBaseUrl + "/elynea.webp"
                fillMode: Image.PreserveAspectCrop
                smooth: true
                mipmap: true
            }

            Rectangle {
                width: 14
                height: 14
                radius: 7
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 8
                color: elyneaBridge.state === "offline" || elyneaBridge.state === "error"
                    ? "#EF4444"
                    : elyneaBridge.state === "thinking" || elyneaBridge.state === "transcribing"
                        ? "#F59E0B"
                        : elyneaBridge.state === "listening" || elyneaBridge.state === "wake"
                            ? "#22D3EE"
                            : "#22C55E"
                border.width: 2
                border.color: "#0A1626"
            }
        }

        ColumnLayout {
            visible: root.expanded
            anchors.fill: parent
            anchors.margins: 16
            spacing: 10

            Item {
                Layout.fillWidth: true
                Layout.preferredHeight: 88

                RowLayout {
                    anchors.left: avatarFrame.right
                    anchors.leftMargin: 14
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 8

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2

                        Text {
                            text: "Elynea"
                            color: "#FFFFFF"
                            font.pixelSize: 21
                            font.bold: true
                        }

                        Text {
                            text: "Companion JS-Innov.IA"
                            color: root.goldSoft
                            font.pixelSize: 11
                        }

                        Text {
                            Layout.fillWidth: true
                            text: elyneaBridge.detail
                            color: root.textSoft
                            font.pixelSize: 10
                            elide: Text.ElideRight
                        }
                    }

                    ToolButton {
                        text: "—"
                        onClicked: {
                            root.expanded = false
                            root.dockBottomRight()
                        }
                        contentItem: Text {
                            text: parent.text
                            color: "#DDE8F5"
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                            font.pixelSize: 16
                        }
                        background: Rectangle {
                            color: "#183048"
                            radius: 9
                            border.color: "#34516C"
                        }
                    }

                    ToolButton {
                        text: "×"
                        onClicked: root.visible = false
                        contentItem: Text {
                            text: parent.text
                            color: "#DDE8F5"
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                            font.pixelSize: 17
                        }
                        background: Rectangle {
                            color: "#183048"
                            radius: 9
                            border.color: "#34516C"
                        }
                    }
                }
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: 17
                color: "#AA101D2C"
                border.width: 1
                border.color: "#45E6C65A"

                ListView {
                    id: messages
                    anchors.fill: parent
                    anchors.margins: 11
                    model: chatModel
                    spacing: 8
                    clip: true

                    delegate: Item {
                        id: messageDelegate
                        required property string role
                        required property string text
                        width: messages.width
                        height: bubble.implicitHeight

                        Rectangle {
                            id: bubble
                            implicitWidth: Math.min(messages.width * 0.86, messageText.implicitWidth + 26)
                            implicitHeight: messageText.implicitHeight + 20
                            anchors.right: messageDelegate.role === "user" ? parent.right : undefined
                            anchors.left: messageDelegate.role === "user" ? undefined : parent.left
                            radius: 13
                            color: messageDelegate.role === "user" ? "#34E6C65A" : "#80192A3D"
                            border.width: 1
                            border.color: messageDelegate.role === "user" ? "#70E6C65A" : "#304A647C"

                            Text {
                                id: messageText
                                width: Math.min(messages.width * 0.80, Math.max(120, implicitWidth))
                                anchors.margins: 10
                                anchors.centerIn: parent
                                text: messageDelegate.text
                                color: "#F4F7FB"
                                font.pixelSize: 12
                                wrapMode: Text.Wrap
                            }
                        }
                    }

                    ScrollBar.vertical: ScrollBar { }
                }
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 42
                radius: 14
                color: "#CC0D1928"
                border.width: 1
                border.color: prompt.activeFocus ? root.gold : "#35516A"

                TextInput {
                    id: prompt
                    anchors.fill: parent
                    anchors.leftMargin: 13
                    anchors.rightMargin: 13
                    color: "#FFFFFF"
                    selectionColor: root.gold
                    selectedTextColor: "#081321"
                    font.pixelSize: 12
                    verticalAlignment: TextInput.AlignVCenter
                    clip: true

                    Text {
                        visible: !prompt.text && !prompt.activeFocus
                        text: "Demande quelque chose à Elynea…"
                        color: "#71869C"
                        anchors.verticalCenter: parent.verticalCenter
                        font.pixelSize: 12
                    }

                    Keys.onReturnPressed: {
                        if (prompt.text.trim().length > 0) {
                            elyneaBridge.sendMessage(prompt.text)
                            prompt.text = ""
                        }
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 7

                Button {
                    Layout.fillWidth: true
                    text: elyneaBridge.listening ? "Arrêter" : "Micro"
                    onClicked: elyneaBridge.toggleListening()

                    background: Rectangle {
                        radius: 11
                        color: elyneaBridge.listening ? "#9E0E7490" : "#C4183048"
                        border.width: 1
                        border.color: elyneaBridge.listening ? "#67E8F9" : "#47627A"
                    }

                    contentItem: Text {
                        text: parent.text
                        color: "#FFFFFF"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.pixelSize: 11
                        font.bold: true
                    }
                }

                Button {
                    Layout.fillWidth: true
                    text: elyneaBridge.wakeEnabled ? "Appel ON" : "Appel OFF"
                    onClicked: elyneaBridge.setWakeEnabled(!elyneaBridge.wakeEnabled)

                    background: Rectangle {
                        radius: 11
                        color: elyneaBridge.wakeEnabled ? "#4232C9DD" : "#C4183048"
                        border.width: 1
                        border.color: elyneaBridge.wakeEnabled ? "#67E8F9" : "#47627A"
                    }

                    contentItem: Text {
                        text: parent.text
                        color: "#FFFFFF"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.pixelSize: 11
                        font.bold: true
                    }
                }

                Button {
                    Layout.fillWidth: true
                    text: "Envoyer"
                    enabled: prompt.text.trim().length > 0
                    onClicked: {
                        elyneaBridge.sendMessage(prompt.text)
                        prompt.text = ""
                    }

                    background: Rectangle {
                        radius: 11
                        color: parent.enabled ? root.gold : "#594C2A"
                        border.width: 1
                        border.color: parent.enabled ? root.goldSoft : "#6B5D35"
                    }

                    contentItem: Text {
                        text: parent.text
                        color: "#07111F"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.pixelSize: 11
                        font.bold: true
                        opacity: parent.enabled ? 1 : 0.55
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 7

                CheckBox {
                    id: autostart
                    text: "Windows"
                    checked: elyneaBridge.autostartEnabled
                    onClicked: elyneaBridge.setAutostartEnabled(checked)

                    contentItem: Text {
                        text: autostart.text
                        color: "#BFCDE0"
                        font.pixelSize: 10
                        leftPadding: autostart.indicator.width + autostart.spacing
                        verticalAlignment: Text.AlignVCenter
                    }
                }

                CheckBox {
                    id: voiceOut
                    text: "Voix"
                    checked: elyneaBridge.voiceOutputEnabled
                    onClicked: elyneaBridge.setVoiceOutputEnabled(checked)

                    contentItem: Text {
                        text: voiceOut.text
                        color: "#BFCDE0"
                        font.pixelSize: 10
                        leftPadding: voiceOut.indicator.width + voiceOut.spacing
                        verticalAlignment: Text.AlignVCenter
                    }
                }

                Item { Layout.fillWidth: true }

                Button {
                    text: "Cockpit"
                    onClicked: elyneaBridge.openCockpit()

                    background: Rectangle {
                        radius: 10
                        color: "#182B42"
                        border.width: 1
                        border.color: root.gold
                    }

                    contentItem: Text {
                        text: parent.text
                        color: root.goldSoft
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.pixelSize: 10
                        font.bold: true
                    }
                }
            }
        }

        TapHandler {
            enabled: !root.expanded
            onTapped: {
                root.expanded = true
                root.visible = true
                root.requestActivate()
                root.dockBottomRight()
            }
        }

        DragHandler {
            id: dragArea
            target: null

            onActiveChanged: {
                if (active) {
                    root.dragStartX = root.x
                    root.dragStartY = root.y
                }
            }

            onTranslationChanged: {
                if (active) {
                    root.x = root.dragStartX + translation.x
                    root.y = root.dragStartY + translation.y
                }
            }
        }
    }
}
