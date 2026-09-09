$ErrorActionPreference = 'Stop'
$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $PythonCommand) { throw 'Python est requis pour Whisper local. Installez Python 3.10+ puis relancez.' }

$Requirements = Join-Path $AgentDir 'requirements-music-motion.txt'
Write-Host 'Installation des dépendances Whisper/BPM pour Music Motion Studio...' -ForegroundColor Cyan
& $PythonCommand.Source -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Mise à jour de pip impossible.' }
& $PythonCommand.Source -m pip install -r $Requirements
if ($LASTEXITCODE -ne 0) { throw 'Installation des dépendances Music Motion impossible.' }

Write-Host 'Dépendances Music Motion installées.' -ForegroundColor Green
Write-Host 'Le modèle Whisper sera téléchargé au premier lancement et conservé dans le cache local.' -ForegroundColor Yellow
