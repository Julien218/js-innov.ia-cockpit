param(
  [switch]$SkipPython
)

$ErrorActionPreference = 'Stop'
$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $env:LOCALAPPDATA 'JS-InnovIA\AI-Factory'
$Log = Join-Path $LogDir 'agent.log'
$Startup = [Environment]::GetFolderPath('Startup')
$StartupCmd = Join-Path $Startup 'JS-InnovIA-AI-Factory.cmd'
$Requirements = Join-Path $AgentDir 'requirements-music-motion.txt'
$Server = Join-Path $AgentDir 'server.js'
$Venv = Join-Path $AgentDir '.venv-music-motion'
$VenvPython = Join-Path $Venv 'Scripts\python.exe'

function Write-Step([string]$Text) {
  Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Get-Capabilities([int]$Port) {
  $headers = @{}
  if ($env:LOCAL_AGENT_TOKEN) { $headers.Authorization = "Bearer $($env:LOCAL_AGENT_TOKEN)" }
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/music-motion/production/capabilities" -Headers $headers -TimeoutSec 4
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
      return [pscustomobject]@{ reachable = $true; unauthorized = $true; version = 2 }
    }
    return $null
  }
}

function Test-PortInUse([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

Write-Host 'JS-Innov.IA — réparation Elynea Music Motion local' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $Server)) { throw "server.js introuvable dans $AgentDir" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js est requis.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm est requis.' }

Write-Step 'Mise à niveau des dépendances Node locales'
Push-Location $AgentDir
try {
  npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'npm install a échoué.' }
} finally {
  Pop-Location
}

$PythonForMotion = $env:MUSIC_MOTION_PYTHON
if (-not $SkipPython) {
  $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if (-not $PythonCommand) { throw 'Python 3.12 est requis pour Music Motion.' }
  Write-Step 'Préparation de Python isolé pour Whisper / BPM / PDF'
  if (-not (Test-Path $VenvPython)) {
    & $PythonCommand.Source -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw 'Création de l’environnement Python Music Motion impossible.' }
  }
  & $VenvPython -m pip install --upgrade pip
  if ($LASTEXITCODE -ne 0) { throw 'Mise à jour de pip impossible.' }
  & $VenvPython -m pip install -r $Requirements
  if ($LASTEXITCODE -ne 0) { throw 'Installation des dépendances Music Motion impossible.' }
  $PythonForMotion = $VenvPython
}

Write-Step 'Détection de l’agent actuellement actif'
foreach ($port in 8788, 8787) {
  $caps = Get-Capabilities $port
  if ($caps -and -not $caps.unauthorized -and [int]$caps.version -ge 2) {
    Write-Host "Music Motion v2 répond déjà sur 127.0.0.1:$port." -ForegroundColor Green
    Write-Host "Analyse: $($caps.analysis) | Transcription: $($caps.transcription) | Rendu: $($caps.render) | ComfyUI: $($caps.comfy)" -ForegroundColor Green
    exit 0
  }
}

$TargetPort = 8787
if (Test-PortInUse 8787) {
  if (Test-PortInUse 8788) { throw 'Les ports 8787 et 8788 sont déjà occupés. Fermez l’ancien agent puis relancez cette réparation.' }
  $TargetPort = 8788
}

Write-Step "Démarrage de l’agent actuel sur le port $TargetPort"
$Node = (Get-Command node).Source
$oldPort = $env:LOCAL_AGENT_PORT
$oldPython = $env:MUSIC_MOTION_PYTHON
try {
  $env:LOCAL_AGENT_PORT = [string]$TargetPort
  if ($PythonForMotion) { $env:MUSIC_MOTION_PYTHON = $PythonForMotion }
  Start-Process -FilePath $Node -ArgumentList @($Server) -WorkingDirectory $AgentDir -WindowStyle Hidden
} finally {
  $env:LOCAL_AGENT_PORT = $oldPort
  $env:MUSIC_MOTION_PYTHON = $oldPython
}

$escapedNode = $Node.Replace('"','')
$escapedServer = $Server.Replace('"','')
$escapedLog = $Log.Replace('"','')
$startupLines = @(
  '@echo off',
  "set LOCAL_AGENT_PORT=$TargetPort"
)
if ($PythonForMotion) { $startupLines += "set MUSIC_MOTION_PYTHON=$PythonForMotion" }
$startupLines += "start \"JS-Innov.IA AI Factory\" /min \"$escapedNode\" \"$escapedServer\" >> \"$escapedLog\" 2>&1"
Set-Content -Path $StartupCmd -Value ($startupLines -join "`r`n") -Encoding ASCII

$ready = $null
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  $ready = Get-Capabilities $TargetPort
  if ($ready) { break }
}

if (-not $ready) {
  throw "L’agent a été lancé mais Music Motion v2 ne répond pas sur $TargetPort. Consultez $Log"
}
if ($ready.unauthorized) {
  Write-Host "Agent joignable sur 127.0.0.1:$TargetPort, mais le Cockpit doit utiliser le jeton LOCAL_AGENT_TOKEN." -ForegroundColor Yellow
  exit 0
}
if ([int]$ready.version -lt 2) { throw "Contrat Music Motion trop ancien : version $($ready.version)." }

Write-Host "`n✅ Agent Music Motion v2 opérationnel sur http://127.0.0.1:$TargetPort" -ForegroundColor Green
Write-Host "Analyse: $($ready.analysis) | Transcription: $($ready.transcription) | Rendu: $($ready.render) | ComfyUI: $($ready.comfy) | Ollama: $($ready.ollama)" -ForegroundColor Green
Write-Host 'Rechargez maintenant le Cockpit (Ctrl+F5).' -ForegroundColor Cyan
