#!/bin/sh
# Runs continuously on the NAS and backs up the whole DB every day at BACKUP_AT.
# Output: /backups/trucking-YYYYMMDD-HHMM.dump  (+ a matching .sha256 checksum)
# Backups older than BACKUP_KEEP_DAYS are deleted. Manager PCs copy from this folder automatically.
set -eu
KEEP="${BACKUP_KEEP_DAYS:-30}"
AT="${BACKUP_AT:-02:00}"

run_backup() {
  ts=$(date +%Y%m%d-%H%M)
  tmp="/backups/.trucking-$ts.dump.part"
  out="/backups/trucking-$ts.dump"
  if pg_dump --format=custom --compress=9 --file="$tmp"; then
    # Verify the file is restorable by reading its table of contents
    pg_restore --list "$tmp" > /dev/null
    mv "$tmp" "$out"
    sha256sum "$out" | awk '{print $1}' > "$out.sha256"
    echo "$(date '+%F %T') Backup done: $out ($(du -h "$out" | cut -f1))"
    find /backups -maxdepth 1 -name 'trucking-*.dump*' -mtime +"$KEEP" -print -delete
  else
    rm -f "$tmp"
    echo "$(date '+%F %T') Backup FAILED" >&2
  fi
}

echo "Automatic backup started: daily at $AT, keeping ${KEEP} days"
[ "${BACKUP_NOW:-false}" = "true" ] && run_backup
while true; do
  now=$(date +%s)
  target=$(date -d "$(date +%F) $AT" +%s 2>/dev/null || date -D '%Y-%m-%d %H:%M' -d "$(date +%F) $AT" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  run_backup
done
