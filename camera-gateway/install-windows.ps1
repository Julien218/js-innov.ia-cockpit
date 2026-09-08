[CmdletBinding()]
param(
  [string]$CockpitUrl = 'https://olivier-signage-cockpit-production.up.railway.app',
  [string]$CameraKey = 'camera-1',
  [string]$CameraIp = '',
  [switch]$AutoDiscoverRtsp,
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

function Unprotect-Secret([Security.SecureString]$SecureValue) {
  if (-not $SecureValue) { return '' }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Test-RtspCandidate([string]$Url) {
  try {
    $result = & ffprobe -v error -rtsp_transport tcp -rw_timeout 5000000 -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 $Url 2>$null
    return $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($result | Out-String))
  } catch {
    return $false
  }
}

function Discover-Rtsp([string]$Ip) {
  if (-not $Ip -or $Ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw 'Adresse IP caméra invalide pour la détection RTSP.'
  }

  Write-Host "Détection locale du flux caméra sur $Ip..." -ForegroundColor Cyan
  Write-Host 'Les identifiants caméra restent uniquement dans cette session PowerShell.' -ForegroundColor DarkGray
  $cameraUser = Read-Host 'Utilisateur caméra (laisser vide si aucun)'
  $cameraPasswordSecure = Read-Host 'Mot de passe caméra (laisser vide si aucun)' -AsSecureString
  $cameraPassword = Unprotect-Secret $cameraPasswordSecure

  $userInfo = ''
  if (-not [string]::IsNullOrWhiteSpace($cameraUser)) {
    $encodedUser = [uri]::EscapeDataString($cameraUser)
    $encodedPassword = [uri]::EscapeDataString($cameraPassword)
    $userInfo = "$encodedUser`:$encodedPassword@"
  }

  $candidates = @(
    @{ Port = 554;  Path = '/Onvif/live/1/1' },
    @{ Port = 554;  Path = '/live/main' },
    @{ Port = 554;  Path = '/live/ch00_0' },
    @{ Port = 554;  Path = '/live/ch00_1' },
    @{ Port = 554;  Path = '/ch0.h264' },
    @{ Port = 554;  Path = '/stream' },
    @{ Port = 554;  Path = '/h264' },
    @{ Port = 5544; Path = '/11' }
  )

  try {
    foreach ($candidate in $candidates) {
      $url = "rtsp://$userInfo$Ip`:$($candidate.Port)$($candidate.Path)"
      Write-Host "Test RTSP port $($candidate.Port) · $($candidate.Path)" -ForegroundColor DarkGray
      if (Test-RtspCandidate $url) {
        Write-Host "Flux RTSP détecté : port $($candidate.Port) · $($candidate.Path)" -ForegroundColor Green
        return ConvertTo-SecureString $url -AsPlainText -Force
      }
      $url = $null
    }
  } finally {
    $cameraPassword = $null
    $cameraPasswordSecure = $null
    $userInfo = $null
  }

  Write-Warning 'Aucun des profils RTSP usuels n’a répondu. Le flux RTSP peut devoir être activé dans la caméra ou utiliser un chemin différent.'
  return $null
}

Assert-Command 'node' 'Installez Node.js 20 ou une version plus récente.'
Assert-Command 'ffmpeg' 'Installez FFmpeg et ajoutez-le au PATH Windows.'
if ($AutoDiscoverRtsp) { Assert-Command 'ffprobe' 'FFprobe est requis pour détecter automatiquement le flux RTSP.' }

$nodeVersion = (& node --version).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 20) { throw 'Node.js 20 ou une version plus récente est requis.' }

$gatewayToken = Read-Host 'Jeton de passerelle affiché dans le cockpit' -AsSecureString
if ($gatewayToken.Length -eq 0) { throw 'Le jeton de passerelle est obligatoire.' }

$rtspUrl = $null
if ($AutoDiscoverRtsp) {
  $rtspUrl = Discover-Rtsp $CameraIp
}
if (-not $rtspUrl) {
  $rtspUrl = Read-Host 'URL RTSP complète de la caméra' -AsSecureString
}
if (-not $rtspUrl -or $rtspUrl.Length -eq 0) { throw 'L’URL RTSP est obligatoire.' }

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
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settingsTask -Description 'Passerelle locale sécurisée Signelya / Pixelium' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$gatewayToken = $null
$rtspUrl = $null

Write-Host 'Passerelle Signelya / Pixelium installée et démarrée.' -ForegroundColor Green
Write-Host "Dossier local : $installRoot"
Write-Host "Clé caméra locale : $CameraKey"
Write-Host 'Contrôle visuel normal : 1 capture toutes les 60 secondes.'
Write-Host 'L’analyse rapide des annonces ne s’active que sur demande depuis SIGNELYA.'
Write-Host 'Vérifiez le statut En ligne dans le cockpit dans moins d’une minute.'
