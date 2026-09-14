$ErrorActionPreference = 'Stop'
$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repair = Join-Path $AgentDir 'repair-music-motion-windows.ps1'

Write-Host 'JS-Innov.IA — installation / réparation de l’agent local Elynea' -ForegroundColor Cyan
if (-not (Test-Path $Repair)) { throw 'Le réparateur Music Motion v2 est absent. Mettez d’abord le dépôt js-innov.ia-cockpit à jour.' }

& $Repair
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
