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

function Get-AgentHealth([int]$Port) {
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
  } catch {
    return $null
  }
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

function Get-PortProcess([int]$Port) {
  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
}

function Test-JsInnovAgentProcess($Process) {
  if (-not $Process) { return $false }
  $line = [string]$Process.CommandLine
  return ($Process.Name -match '^node(?:\.exe)?$') -and ($line -match 'server\.js') -and ($line -match '(?i)JS-Innov|Js-Innov|local-agent|AI-Factory')
}

function Stop-StaleAgentOnPort([int]$Port) {
  $process = Get-PortProcess $Port
  if (-not $process) { return $true }
  if (-not (Test-JsInnovAgentProcess $process)) { return $false }
  Write-Host "Arrêt de l’ancien agent JS-Innov.IA PID $($process.ProcessId) sur $Port : $($process.CommandLine)" -ForegroundColor Yellow
  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  Start-Sleep -Milliseconds 700
  return -not [bool](Get-PortProcess $Port)
}

Write-Host 'JS-Innov.IA — réparation Elynea Music Motion local' -ForegroundColor Yellow
Write-Host 'Les services Avatar Factory 8791/8792/8793 ne sont jamais modifiés par ce script.' -ForegroundColor DarkGray
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $Server)) { throw "server.js introuvable dans $AgentDir" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js est requis.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm est requis.' }

$serverSource = Get-Content -Raw -Path $Server
$versionMatch = [regex]::Match($serverSource, "const\s+VERSION\s*=\s*'([^']+)'", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$ExpectedVersion = if ($versionMatch.Success) { $versionMatch.Groups[1].Value } else { 'inconnue' }
Write-Host "Version locale attendue dans ce dossier : $ExpectedVersion" -ForegroundColor DarkGray

Write-Step 'Inventaire 8787 / 8788'
foreach ($port in 8787, 8788) {
  $process = Get-PortProcess $port
  $health = Get-AgentHealth $port
  $caps = Get-Capabilities $port
  if (-not $process) {
    Write-Host "$port : libre" -ForegroundColor DarkGray
    continue
  }
  $version = if ($health -and $health.agent -and $health.agent.version) { $health.agent.version } else { 'non identifiée' }
  $contract = if ($caps) { if ($caps.unauthorized) { 'v2 protégé par jeton' } else { "Music Motion v$($caps.version)" } } else { 'pas de contrat Music Motion v2' }
  Write-Host "$port : PID $($process.ProcessId) · $($process.Name) · version $version · $contract" -ForegroundColor Yellow
  Write-Host "       $($process.CommandLine)" -ForegroundColor DarkGray
}

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

# 8788 est prioritaire dans le Cockpit. S'il contient un ancien agent JS-Innov.IA,
# on le remplace. Un ancien 8787 est laissé tranquille lorsque 8788 est disponible.
$caps8788 = Get-Capabilities 8788
$health8788 = Get-AgentHealth 8788
$health8788Version = if ($health8788 -and $health8788.agent) { [string]$health8788.agent.version } else { '' }
$current8788IsReady = $caps8788 -and -not $caps8788.unauthorized -and [int]$caps8788.version -ge 2 -and $health8788Version -eq $ExpectedVersion -and $caps8788.analysis -and $caps8788.render
if (-not $current8788IsReady -and (Get-PortProcess 8788)) {
  if (-not (Stop-StaleAgentOnPort 8788)) {
    throw 'Le port 8788 est occupé par un programme qui n’est pas identifié comme agent JS-Innov.IA. Il ne sera pas arrêté automatiquement.'
  }
}

if ($current8788IsReady) {
  Write-Host "`n✅ L’agent actuel $ExpectedVersion répond déjà correctement sur 127.0.0.1:8788." -ForegroundColor Green
  Write-Host "Analyse: $($caps8788.analysis) | Transcription: $($caps8788.transcription) | Rendu: $($caps8788.render) | ComfyUI: $($caps8788.comfy) | Ollama: $($caps8788.ollama)" -ForegroundColor Green
  exit 0
}

$TargetPort = 8788
if (Get-PortProcess 8788) { throw 'Le port 8788 reste occupé après nettoyage.' }

Write-Step "Démarrage de l’agent actuel sur le port $TargetPort"
$Node = (Get-Command node).Source
$oldPort = $env:LOCAL_AGENT_PORT
$oldPython = $env:MUSIC_MOTION_PYTHON
try {
  $env:LOCAL_AGENT_PORT = [string]$TargetPort
  if ($PythonForMotion) { $env:MUSIC_MOTION_PYTHON = $PythonForMotion }
  Start-Process -FilePath $Node -ArgumentList @("`"$Server`"") -WorkingDirectory $AgentDir -WindowStyle Hidden
} finally {
  $env:LOCAL_AGENT_PORT = $oldPort
  $env:MUSIC_MOTION_PYTHON = $oldPython
}

$startupLines = @(
  '@echo off',
  "set LOCAL_AGENT_PORT=$TargetPort"
)
if ($PythonForMotion) { $startupLines += "set MUSIC_MOTION_PYTHON=$PythonForMotion" }
$startupLines += ('start "JS-Innov.IA AI Factory" /min "{0}" "{1}" >> "{2}" 2>&1' -f $Node, $Server, $Log)
Set-Content -Path $StartupCmd -Value ($startupLines -join "`r`n") -Encoding ASCII

$ready = $null
$health = $null
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  $ready = Get-Capabilities $TargetPort
  $health = Get-AgentHealth $TargetPort
  if ($ready -and $health) { break }
}

if (-not $ready -or -not $health) {
  throw "L’agent a été lancé mais Music Motion v2 ne répond pas sur $TargetPort. Consultez $Log"
}
if ($ready.unauthorized) {
  Write-Host "Agent joignable sur 127.0.0.1:$TargetPort, mais le Cockpit doit utiliser le jeton LOCAL_AGENT_TOKEN." -ForegroundColor Yellow
  exit 0
}
if ([int]$ready.version -lt 2) { throw "Contrat Music Motion trop ancien : version $($ready.version)." }
if ($health.agent.version -ne $ExpectedVersion) { throw "Mauvaise version active : $($health.agent.version), attendue : $ExpectedVersion." }

Write-Host "`n✅ Elynea Music Motion v2 opérationnel sur http://127.0.0.1:$TargetPort" -ForegroundColor Green
Write-Host "Agent local: $($health.agent.version) | Analyse: $($ready.analysis) | Transcription: $($ready.transcription) | Rendu: $($ready.render) | ComfyUI: $($ready.comfy) | Ollama: $($ready.ollama)" -ForegroundColor Green
if (-not $ready.transcription) { Write-Host 'Whisper n’est pas encore disponible pour la transcription. Le reste de l’analyse peut fonctionner.' -ForegroundColor Yellow }
if (-not $ready.comfy) { Write-Host 'ComfyUI n’est pas joignable sur 8188. L’analyse et le montage FFmpeg restent séparés de la génération ComfyUI.' -ForegroundColor Yellow }
Write-Host 'Rechargez maintenant le Cockpit (Ctrl+F5).' -ForegroundColor Cyan
