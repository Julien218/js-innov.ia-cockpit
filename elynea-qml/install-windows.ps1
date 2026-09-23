param(
    [switch]$NoAutostart
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = Join-Path $Root "dist\ElyneaDesktop"

if (-not (Test-Path $Source)) {
    throw "Build ElyneaDesktop introuvable. Exécute d'abord build-windows.ps1."
}

$Target = Join-Path $env:LOCALAPPDATA "JS-InnovIA\ElyneaDesktop"
New-Item -ItemType Directory -Path $Target -Force | Out-Null
Copy-Item "$Source\*" $Target -Recurse -Force

$Exe = Join-Path $Target "ElyneaDesktop.exe"
if (-not (Test-Path $Exe)) {
    throw "ElyneaDesktop.exe manquant après installation."
}

if (-not $NoAutostart) {
    $RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    Set-ItemProperty -Path $RunKey -Name "ElyneaDesktop" -Value ('"{0}" --minimized' -f $Exe)
}

Start-Process $Exe
Write-Host "Elynea Desktop QML installée dans $Target" -ForegroundColor Green
