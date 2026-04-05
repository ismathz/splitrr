#!/usr/bin/env bash
set -euo pipefail

: "${SQLITE_PATH:?SQLITE_PATH is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${BACKUP_PREFIX:=backups/splitbot/prod}"

STAMP="$(date +%Y/%m/%d)"
TARGET="/tmp/splitbot-$(date +%Y%m%d-%H%M%S).sqlite3"
ARCHIVE="${TARGET}.zst"

sqlite3 "${SQLITE_PATH}" ".backup '${TARGET}'"
zstd -q "${TARGET}" -o "${ARCHIVE}"

# Replace with your S3 client command (aws s3 cp, rclone, mc, etc.)
echo "Upload ${ARCHIVE} to s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${STAMP}/"
