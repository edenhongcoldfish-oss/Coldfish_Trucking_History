# Manager PC: copies new backup files from the NAS backup folder to this PC.
# Task Scheduler runs this with no window (install once with install-backup.bat).
param(
  [string]$Source = $env:TRUCKING_BACKUP_SOURCE,   # e.g. \\NAS\trucking-backup
  [string]$Dest = "$env:USERPROFILE\Documents\Trip Log Backups",
  [int]$KeepDays = 60
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$log = Join-Path $Dest 'backup-log.txt'
function Log($m) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $m) -Encoding UTF8 }

try {
  if (-not $Source) { $cfg = Join-Path $PSScriptRoot 'source.txt'; if (Test-Path $cfg) { $Source = (Get-Content $cfg -Raw).Trim() } }
  if (-not $Source) { throw 'NAS backup folder is not configured. Run install-backup.bat again.' }
  if (-not (Test-Path $Source)) { throw "Cannot reach the NAS backup folder: $Source (check office network / VPN)" }

  $copied = 0
  Get-ChildItem -Path $Source -Filter 'trucking-*.dump' | ForEach-Object {
    $target = Join-Path $Dest $_.Name
    if (Test-Path $target) { return }
    $shaFile = "$($_.FullName).sha256"
    Copy-Item $_.FullName "$target.part" -Force
    if (Test-Path $shaFile) {
      $expected = (Get-Content $shaFile -Raw).Trim().ToLower()
      $actual = (Get-FileHash "$target.part" -Algorithm SHA256).Hash.ToLower()
      if ($expected -ne $actual) { Remove-Item "$target.part" -Force; Log "Checksum mismatch (damaged during copy): $($_.Name)"; return }
      Copy-Item $shaFile "$target.sha256" -Force
    }
    Move-Item "$target.part" $target -Force
    $copied++
  }
  # Remove old copies (always keep at least the 7 most recent)
  $all = Get-ChildItem -Path $Dest -Filter 'trucking-*.dump' | Sort-Object Name -Descending
  $all | Select-Object -Skip 7 | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | ForEach-Object {
    Remove-Item $_.FullName, "$($_.FullName).sha256" -Force -ErrorAction SilentlyContinue
  }
  $latest = $all | Select-Object -First 1
  Log ("OK: {0} new file(s), latest {1}" -f $copied, $(if ($latest) { $latest.Name } else { 'none' }))
  # Warn if nothing new for 3+ days (NAS backup may have stopped)
  if ($latest -and $latest.LastWriteTime -lt (Get-Date).AddDays(-3)) { Log 'WARNING: no new backup in the last 3 days. Check the NAS backup.' }
} catch {
  Log ("FAILED: " + $_.Exception.Message)
  exit 1
}
