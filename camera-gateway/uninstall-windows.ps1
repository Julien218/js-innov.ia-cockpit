[CmdletBinding()]
param([switch]$KeepConfiguration)

$ErrorActionPreference = 'Stop'
$taskName = 'Pixelium Camera Gateway'
$installRoot = Join-Path $env:LOCALAPPDATA 'PixeliumCameraGateway'

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

if (-not $KeepConfiguration -and (Test-Path -LiteralPath $installRoot)) {
  Remove-Item -LiteralPath $installRoot -Recurse -Force
}

Write-Host 'Passerelle Pixelium retirée.' -ForegroundColor Green
