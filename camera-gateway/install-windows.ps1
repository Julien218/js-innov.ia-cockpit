[CmdletBinding()]
param(
  [string]$CockpitUrl = 'https://olivier-signage-cockpit-production.up.railway.app',
  [string]$CameraKey = 'camera-1',
  [switch]$EnableRecording
)

$ErrorActionPreference = 'Stop'
$taskName = 'Pixelium Camera Gateway'
$installRoot = Join-Path $env:LOCALAPPDATA 'PixeliumCameraGateway'
$appRoot = Join-Path $installRoot 'app'

function Assert-Command([string]$Name, [string]$Help) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name est manquant. $Help"
  }
}

Assert-Command 'node' 'Installez Node.js 20 ou une version plus récente.'
Assert-Command 'ffmpeg' 'Installez FFmpeg et ajoutez-le au PATH Windows.'

$nodeVersion = (& node --version).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 20) { throw 'Node.js 20 ou une version plus récente est requis.' }

$gatewayToken = Read-Host 'Jeton de passerelle affiché dans le cockpit' -AsSecureString
$rtspUrl = Read-Host 'URL RTSP complète de la caméra' -AsSecureString
if ($gatewayToken.Length -eq 0 -or $rtspUrl.Length -eq 0) { throw "Le jeton et l’URL RTSP sont obligatoires." }

New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'gateway.mjs') -Destination $appRoot -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'run-windows.ps1') -Destination $appRoot -Force

$settings = [ordered]@{
  cockpitUrl = $CockpitUrl.TrimEnd('/')
  cameraKey = $CameraKey
  recordingEnabled = [bool]$EnableRecording
  snapshotIntervalSeconds = 60
  heartbeatIntervalSeconds = 30
  recordingDurationSeconds = 60
  recordingIntervalSeconds = 300
}
$secrets = [ordered]@{
  gatewayToken = ConvertFrom-SecureString $gatewayToken
  rtspUrl = ConvertFrom-SecureString $rtspUrl
}

$settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'settings.json') -Encoding UTF8
$secrets | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'secrets.json') -Encoding UTF8

$secretPath = Join-Path $installRoot 'secrets.json'
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $secretPath -AclObject $acl

$shell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $shell) { $shell = (Get-Command powershell.exe).Source }
$runner = Join-Path $appRoot 'run-windows.ps1'
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$action = New-ScheduledTaskAction -Execute $shell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$settingsTask = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settingsTask -Description 'Passerelle locale sécurisée Pixelium' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host 'Passerelle Pixelium installée et démarrée.' -ForegroundColor Green
Write-Host "Dossier local : $installRoot"
Write-Host "Contrôle visuel normal : 1 capture toutes les 60 secondes."
Write-Host "L’analyse rapide des annonces ne s’active que sur demande depuis SIGNELYA."
Write-Host "Vérifiez le statut En ligne dans le cockpit dans moins d’une minute."
