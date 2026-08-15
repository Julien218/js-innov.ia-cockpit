$ErrorActionPreference = 'Stop'
$installRoot = Split-Path $PSScriptRoot -Parent
$settingsPath = Join-Path $installRoot 'settings.json'
$secretsPath = Join-Path $installRoot 'secrets.json'
$logPath = Join-Path $installRoot 'gateway.log'

function Unprotect-Secret([string]$EncryptedValue) {
  $secure = ConvertTo-SecureString $EncryptedValue
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if (-not (Test-Path -LiteralPath $settingsPath) -or -not (Test-Path -LiteralPath $secretsPath)) {
  throw 'Configuration Pixelium introuvable. Relancez install-windows.ps1.'
}

$settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
$secrets = Get-Content -Raw -LiteralPath $secretsPath | ConvertFrom-Json
$token = Unprotect-Secret $secrets.gatewayToken
$rtsp = Unprotect-Secret $secrets.rtspUrl

$env:COCKPIT_URL = [string]$settings.cockpitUrl
$env:GATEWAY_TOKEN = $token
$env:CAMERA_CONFIG_JSON = @(@{ key = [string]$settings.cameraKey; rtspUrl = $rtsp }) | ConvertTo-Json -Compress
$env:RECORDING_ENABLED = ([bool]$settings.recordingEnabled).ToString().ToLowerInvariant()
$env:SNAPSHOT_INTERVAL_SECONDS = [string]$settings.snapshotIntervalSeconds
$env:HEARTBEAT_INTERVAL_SECONDS = [string]$settings.heartbeatIntervalSeconds
$env:RECORDING_DURATION_SECONDS = [string]$settings.recordingDurationSeconds
$env:RECORDING_INTERVAL_SECONDS = [string]$settings.recordingIntervalSeconds

try {
  & node (Join-Path $PSScriptRoot 'gateway.mjs') *>> $logPath
} finally {
  Remove-Item Env:GATEWAY_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:CAMERA_CONFIG_JSON -ErrorAction SilentlyContinue
  $token = $null
  $rtsp = $null
}
