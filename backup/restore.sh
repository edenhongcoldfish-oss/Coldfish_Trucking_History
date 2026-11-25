#!/bin/sh
# Restore: run on the NAS from the folder that holds docker-compose.yml
#   sh backup/restore.sh /volume1/trucking-backup/trucking-20261121-0200.dump
# Rolls the DB back to the backup. The current state is saved first, just in case.
set -eu
f="${1:?Give the path of the .dump file to restore}"
[ -f "$f" ] || { echo "File not found: $f"; exit 1; }
if [ -f "$f.sha256" ]; then
  [ "$(sha256sum "$f" | awk '{print $1}')" = "$(cat "$f.sha256")" ] || { echo "Checksum does not match. The file may be damaged."; exit 1; }
fi
echo "1) Saving the current state as a safety copy..."
docker compose exec -T db pg_dump -U trucking -d trucking --format=custom > "before-restore-$(date +%Y%m%d-%H%M).dump"
echo "2) Stopping the app..."
docker compose stop app
echo "3) Restoring..."
docker compose exec -T db pg_restore -U trucking -d trucking --clean --if-exists --no-owner < "$f"
echo "4) Starting the app..."
docker compose start app
echo "Restore complete: $f"
