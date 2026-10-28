#!/usr/bin/env bash
# Monthly restore drill: download a backup archive and open it read-only with sqlite3.
set -euo pipefail

: "${BACKUP_ARCHIVE:?Set BACKUP_ARCHIVE to a local .sqlite3 or .sqlite3.zst file}"
RESTORE_DIR="${RESTORE_DIR:-/tmp/splitbot-restore-drill}"
mkdir -p "${RESTORE_DIR}"

SRC="${BACKUP_ARCHIVE}"
DB_PATH="${RESTORE_DIR}/restored.sqlite3"

if [[ "${SRC}" == *.zst ]]; then
  zstd -d -q -f "${SRC}" -o "${DB_PATH}"
else
  cp "${SRC}" "${DB_PATH}"
fi

echo "Restored DB at ${DB_PATH}"
sqlite3 "${DB_PATH}" "PRAGMA integrity_check; SELECT COUNT(*) AS bill_sessions FROM bill_sessions;"
echo "Restore drill OK"
