# Run once: saves the NAS path and registers a task that runs daily, at sign-in,
# and as soon as the PC is back on if a run was missed. No window ever appears.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$installDir = Join-Path $env:LOCALAPPDATA 'TruckingBackup'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item (Join-Path $here 'pull-backup.ps1'), (Join-Path $here 'run-hidden.vbs') $installDir -Force

Write-Host 'Trip Log automatic backup setup' -ForegroundColor Green
$src = Read-Host 'NAS backup folder path (e.g. \\NAS\trucking-backup)'
if (-not $src.StartsWith('\\')) { throw 'Please enter it as \\NAS-name\folder.' }
Set-Content -Path (Join-Path $installDir 'source.txt') -Value $src -Encoding UTF8

$server = ($src.TrimStart('\') -split '\\')[0]
$ans = Read-Host 'Save the NAS read-only backup account on this PC? (answer N if already connected) [Y/N]'
if ($ans -match '^[Yy]') {
  $user = Read-Host 'NAS account name (read-only recommended)'
  $pw = Read-Host 'Password' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
  cmdkey /add:$server /user:$user /pass:$plain | Out-Null   # stored in Windows Credential Manager
  $plain = $null
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$installDir\run-hidden.vbs`""
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At '09:30'),
  (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME")
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RunOnlyIfNetworkAvailable -Hidden
Register-ScheduledTask -TaskName 'TruckingBackup' -Action $action -Trigger $triggers -Settings $settings `
  -Description 'Copies Trip Log DB backups from the NAS to this PC (no window)' -Force | Out-Null

Write-Host 'Running once now to check...'
Start-ScheduledTask -TaskName 'TruckingBackup'
Start-Sleep -Seconds 8
$dest = "$env:USERPROFILE\Documents\Trip Log Backups"
if (Test-Path "$dest\backup-log.txt") { Get-Content "$dest\backup-log.txt" -Tail 3 }
Write-Host "Done. Backups will collect in '$dest'. Nothing else to do." -ForegroundColor Green
