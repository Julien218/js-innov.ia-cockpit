$ErrorActionPreference = 'Stop'
$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host 'JS-Innov.IA AI Factory Local - installation' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js est requis.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm est requis.' }
Push-Location $AgentDir
try { npm install --omit=dev } finally { Pop-Location }
$Startup = [Environment]::GetFolderPath('Startup')
$Cmd = Join-Path $Startup 'JS-InnovIA-AI-Factory.cmd'
$Node = (Get-Command node).Source
$Server = Join-Path $AgentDir 'server.js'
$LogDir = Join-Path $env:LOCALAPPDATA 'JS-InnovIA\AI-Factory'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'agent.log'
$line = "@echo off`r`nstart `"JS-Innov.IA AI Factory`" /min `"$Node`" `"$Server`" >> `"$Log`" 2>&1`r`n"
Set-Content -Path $Cmd -Value $line -Encoding ASCII
Start-Process -FilePath $Node -ArgumentList @($Server) -WorkingDirectory $AgentDir -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  Write-Host "AI Factory locale installée. Version $($health.agent.version). Ollama online: $($health.services.ollama.online)" -ForegroundColor Green
} catch { throw 'Installation terminée mais /health ne répond pas. Consultez le log local.' }
