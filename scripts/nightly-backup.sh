#!/usr/bin/env bash
set -euo pipefail

: "${SQLITE_PATH:?SQLITE_PATH is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${BACKUP_PREFIX:=backups/splitbot/prod}"

# Optional S3-compatible settings (R2 / AWS). Prefer explicit BACKUP_* over S3_*.
ENDPOINT="${BACKUP_S3_ENDPOINT:-${S3_ENDPOINT:-}}"
REGION="${BACKUP_S3_REGION:-${S3_REGION:-auto}}"
ACCESS_KEY="${BACKUP_S3_ACCESS_KEY_ID:-${S3_ACCESS_KEY_ID:-}}"
SECRET_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-${S3_SECRET_ACCESS_KEY:-}}"

STAMP="$(date +%Y/%m/%d)"
WORKDIR="${BACKUP_TMPDIR:-/tmp}"
TARGET="${WORKDIR}/splitbot-$(date +%Y%m%d-%H%M%S).sqlite3"
ARCHIVE="${TARGET}.zst"
REMOTE_KEY="${BACKUP_PREFIX%/}/${STAMP}/$(basename "${ARCHIVE}")"

cleanup() {
  rm -f "${TARGET}" "${ARCHIVE}"
}
trap cleanup EXIT

sqlite3 "${SQLITE_PATH}" ".backup '${TARGET}'"
zstd -q "${TARGET}" -o "${ARCHIVE}"

upload_with_aws() {
  local args=(s3 cp "${ARCHIVE}" "s3://${BACKUP_BUCKET}/${REMOTE_KEY}")
  if [[ -n "${ENDPOINT}" ]]; then
    args+=(--endpoint-url "${ENDPOINT}")
  fi
  if [[ -n "${REGION}" ]]; then
    args+=(--region "${REGION}")
  fi
  AWS_ACCESS_KEY_ID="${ACCESS_KEY}" AWS_SECRET_ACCESS_KEY="${SECRET_KEY}" \
    aws "${args[@]}"
}

upload_with_rclone() {
  # Requires rclone remote named "splitbot-backup" pointing at the bucket.
  rclone copyto "${ARCHIVE}" "splitbot-backup:${BACKUP_BUCKET}/${REMOTE_KEY}"
}

if command -v aws >/dev/null 2>&1; then
  if [[ -z "${ACCESS_KEY}" || -z "${SECRET_KEY}" ]]; then
    echo "aws CLI found but ACCESS_KEY/SECRET_KEY missing (set S3_* or BACKUP_S3_*)." >&2
    exit 1
  fi
  upload_with_aws
  echo "Uploaded s3://${BACKUP_BUCKET}/${REMOTE_KEY}"
elif command -v rclone >/dev/null 2>&1; then
  upload_with_rclone
  echo "Uploaded via rclone to ${BACKUP_BUCKET}/${REMOTE_KEY}"
else
  echo "Neither aws nor rclone found; cannot upload ${ARCHIVE}" >&2
  exit 1
fi
