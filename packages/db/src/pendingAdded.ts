import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export type PendingAddedReason =
  | "never_started"
  | "placeholder"
  | "no_telegram_id"
  | "send_failed";

export type PendingAddedRow = {
  id: string;
  bill_session_id: string;
  member_name: string;
  telegram_user_id: string | null;
  reason: PendingAddedReason;
  start_payload: string;
  created_at: string;
  delivered_at: string | null;
  last_error: string | null;
};

/** Encode bill id into a Telegram /start payload (≤64 chars, [A-Za-z0-9_-]). */
export function encodeAddedStartPayload(billId: string): string {
  const hex = billId.replace(/-/g, "").toLowerCase();
  if (/^[0-9a-f]{32}$/.test(hex)) {
    return `n${hex}`;
  }
  const safe = billId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  return `x${safe || "bill"}`.slice(0, 64);
}

/** Decode /start payload produced by encodeAddedStartPayload. */
export function parseAddedStartPayload(
  payload: string,
): { billId: string } | null {
  const p = payload.trim();
  if (/^n[0-9a-f]{32}$/i.test(p)) {
    const h = p.slice(1).toLowerCase();
    return {
      billId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
    };
  }
  if (p.startsWith("x") && p.length > 1) {
    return { billId: p.slice(1) };
  }
  return null;
}

export function buildBotStartDeepLink(
  botUsername: string,
  startPayload: string,
): string {
  const user = botUsername.replace(/^@/, "").trim();
  return `https://t.me/${user}?start=${startPayload}`;
}

export function upsertPendingAddedNotification(
  db: Database,
  input: {
    billId: string;
    memberName: string;
    telegramUserId?: string | null;
    reason: PendingAddedReason;
    lastError?: string | null;
  },
): PendingAddedRow {
  const startPayload = encodeAddedStartPayload(input.billId);
  db.query(
    `DELETE FROM pending_added_notifications
     WHERE bill_session_id = ?1
       AND lower(member_name) = lower(?2)
       AND delivered_at IS NULL`,
  ).run(input.billId, input.memberName);

  const id = randomUUID();
  db.query(
    `INSERT INTO pending_added_notifications (
       id, bill_session_id, member_name, telegram_user_id, reason,
       start_payload, last_error
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).run(
    id,
    input.billId,
    input.memberName,
    input.telegramUserId?.trim() || null,
    input.reason,
    startPayload,
    input.lastError?.slice(0, 500) ?? null,
  );

  return db
    .query(`SELECT * FROM pending_added_notifications WHERE id = ?1`)
    .get(id) as PendingAddedRow;
}

export function markPendingAddedDelivered(db: Database, id: string): void {
  db.query(
    `UPDATE pending_added_notifications
     SET delivered_at = datetime('now'), last_error = NULL
     WHERE id = ?1`,
  ).run(id);
}

export function clearOpenPendingAdded(
  db: Database,
  billId: string,
  memberName: string,
): void {
  db.query(
    `DELETE FROM pending_added_notifications
     WHERE bill_session_id = ?1
       AND lower(member_name) = lower(?2)
       AND delivered_at IS NULL`,
  ).run(billId, memberName);
}

export function listUndeliveredPendingForBill(
  db: Database,
  billId: string,
): PendingAddedRow[] {
  return db
    .query(
      `SELECT * FROM pending_added_notifications
       WHERE bill_session_id = ?1 AND delivered_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all(billId) as PendingAddedRow[];
}

function nameKeysForUser(input: {
  firstName?: string | null;
  username?: string | null;
  displayName?: string | null;
}): string[] {
  const keys = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = v?.trim().toLowerCase() ?? "";
    if (t) keys.add(t);
  };
  add(input.displayName);
  add(input.firstName);
  add(input.username);
  if (input.username?.trim()) {
    add(`@${input.username.trim().replace(/^@/, "")}`);
  }
  return [...keys];
}

/**
 * Undelivered pending rows for a user who just /start'd — by Telegram id,
 * username/display name match, or optional bill hint from the start payload.
 */
export function listPendingAddedForUser(
  db: Database,
  input: {
    telegramUserId: number | string;
    username?: string | null;
    firstName?: string | null;
    billIdHint?: string | null;
  },
): PendingAddedRow[] {
  const tgId = String(input.telegramUserId);
  const byId = db
    .query(
      `SELECT * FROM pending_added_notifications
       WHERE delivered_at IS NULL AND telegram_user_id = ?1
       ORDER BY created_at ASC`,
    )
    .all(tgId) as PendingAddedRow[];

  const keys = nameKeysForUser({
    firstName: input.firstName,
    username: input.username,
    displayName: `${input.firstName ?? ""}`.trim() || null,
  });
  const byName: PendingAddedRow[] = [];
  if (keys.length > 0) {
    const open = db
      .query(
        `SELECT * FROM pending_added_notifications
         WHERE delivered_at IS NULL
         ORDER BY created_at ASC`,
      )
      .all() as PendingAddedRow[];
    for (const row of open) {
      const memberKey = row.member_name.trim().toLowerCase();
      if (keys.includes(memberKey)) byName.push(row);
    }
  }

  let byBill: PendingAddedRow[] = [];
  if (input.billIdHint?.trim()) {
    byBill = listUndeliveredPendingForBill(db, input.billIdHint.trim()).filter(
      (row) =>
        row.telegram_user_id == null ||
        row.telegram_user_id === tgId ||
        keys.includes(row.member_name.trim().toLowerCase()),
    );
  }

  const seen = new Set<string>();
  const out: PendingAddedRow[] = [];
  for (const row of [...byId, ...byName, ...byBill]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
