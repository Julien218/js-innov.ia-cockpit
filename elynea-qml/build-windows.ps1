$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $Root
Set-Location $Root

if (-not (Test-Path ".venv")) {
    py -3.12 -m venv .venv
}

$Python = Join-Path $Root ".venv\Scripts\python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install -r requirements.txt

$Icon = Join-Path $Repo "electron\icon.ico"
$LocalAgent = Join-Path $Repo "local-agent"

& $Python -m PyInstaller --noconfirm --clean --windowed --name "ElyneaDesktop" --icon $Icon --add-data "qml;qml" --add-data "resources;resources" --add-data "$LocalAgent;local-agent" --hidden-import PySide6.QtTextToSpeech main.py

Write-Host "Elynea Desktop QML générée dans $Root\dist\ElyneaDesktop" -ForegroundColor Green
