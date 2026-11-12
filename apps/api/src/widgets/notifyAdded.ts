import type { Database } from "bun:sqlite";
import {
  buildBotStartDeepLink,
  clearOpenPendingAdded,
  encodeAddedStartPayload,
  upsertPendingAddedNotification,
  type PendingAddedReason,
} from "@splitbot/db";
import {
  ADDED_WIDGET_HTML,
  buildAddedChatData,
  formatAddedCaption,
  serializeAddedChatData,
  sendWidgetOrText,
} from "@splitbot/shared";

type RosterUser = {
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  dm_started_at: string | null;
};

export type NotifyAddedUndeliverable = {
  memberName: string;
  reason: PendingAddedReason;
  startLink: string;
  telegramUserId: string | null;
};

function displayName(row: RosterUser): string {
  const full = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  if (full) return full;
  if (row.username?.trim()) return row.username.trim();
  return row.telegram_user_id;
}

function nameKeys(row: RosterUser): string[] {
  const keys = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = v?.trim().toLowerCase() ?? "";
    if (t) keys.add(t);
  };
  add(displayName(row));
  add(row.first_name);
  add(row.username);
  if (row.username?.trim()) {
    add(`@${row.username.trim().replace(/^@/, "")}`);
  }
  return [...keys];
}

function isNeverStartedError(error: string | undefined): boolean {
  const e = (error ?? "").toLowerCase();
  return (
    e.includes("bot can't initiate") ||
    e.includes("bot was blocked") ||
    e.includes("chat not found") ||
    e.includes("forbidden") ||
    e.includes("user is deactivated") ||
    e.includes("peer_id_invalid")
  );
}

function trackUndeliverable(
  db: Database,
  input: {
    billId: string;
    memberName: string;
    telegramUserId: string | null;
    reason: PendingAddedReason;
    botUsername: string;
    lastError?: string | null;
  },
): NotifyAddedUndeliverable {
  const row = upsertPendingAddedNotification(db, {
    billId: input.billId,
    memberName: input.memberName,
    telegramUserId: input.telegramUserId,
    reason: input.reason,
    lastError: input.lastError,
  });
  console.warn("[widgets] notify added undeliverable", {
    billId: input.billId,
    memberName: input.memberName,
    reason: input.reason,
    telegramUserId: input.telegramUserId,
    error: input.lastError ?? null,
    startPayload: row.start_payload,
  });
  return {
    memberName: input.memberName,
    reason: input.reason,
    telegramUserId: input.telegramUserId,
    startLink: buildBotStartDeepLink(input.botUsername, row.start_payload),
  };
}

/**
 * DM "you've been added" widgets to newly added bill members who have a
 * reachable private chat. Undeliverable recipients (never /start'd, placeholders,
 * send failures) are queued for /start delivery and called out on group share.
 */
export async function notifyNewlyAddedMembers(input: {
  db: Database;
  botToken: string | undefined;
  billId: string;
  previousMembers: string[];
  nextMembers: string[];
  botUsername: string;
  miniAppShortName: string;
}): Promise<{
  sent: number;
  skipped: number;
  undeliverable: NotifyAddedUndeliverable[];
}> {
  const token = input.botToken?.trim();
  if (!token) return { sent: 0, skipped: 0, undeliverable: [] };

  const prev = new Set(
    input.previousMembers.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  const added = input.nextMembers
    .map((n) => n.trim())
    .filter((n) => n && !prev.has(n.toLowerCase()));
  if (added.length === 0) return { sent: 0, skipped: 0, undeliverable: [] };

  const session = input.db
    .query(`SELECT group_id FROM bill_sessions WHERE id = ?1`)
    .get(input.billId) as { group_id: number } | null;
  if (!session) {
    return { sent: 0, skipped: added.length, undeliverable: [] };
  }

  const roster = input.db
    .query(
      `SELECT u.telegram_user_id AS telegram_user_id,
              u.username AS username,
              u.first_name AS first_name,
              u.last_name AS last_name,
              u.dm_started_at AS dm_started_at
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?1`,
    )
    .all(session.group_id) as RosterUser[];

  const memberMeta = input.db
    .query(
      `SELECT member_name, is_placeholder, placeholder_username
       FROM bill_session_members
       WHERE bill_session_id = ?1`,
    )
    .all(input.billId) as Array<{
    member_name: string;
    is_placeholder: number | null;
    placeholder_username: string | null;
  }>;
  const placeholderByName = new Map<
    string,
    { isPlaceholder: boolean; username: string | null }
  >();
  for (const row of memberMeta) {
    placeholderByName.set(row.member_name.trim().toLowerCase(), {
      isPlaceholder:
        row.is_placeholder === 1 ||
        Boolean(row.placeholder_username?.trim()) ||
        row.member_name.trim().startsWith("@"),
      username: row.placeholder_username?.trim() || null,
    });
  }

  // Include all real Telegram users (even without dm_started_at) so we attempt
  // delivery and can distinguish 403 never-started from name mismatches.
  const byKey = new Map<string, RosterUser>();
  for (const row of roster) {
    if (row.telegram_user_id.startsWith("name:")) continue;
    if (row.telegram_user_id.startsWith("web-")) continue;
    const tgId = Number(row.telegram_user_id);
    if (!Number.isFinite(tgId) || tgId <= 0) continue;
    for (const key of nameKeys(row)) {
      if (!byKey.has(key)) byKey.set(key, row);
    }
  }

  let sent = 0;
  let skipped = 0;
  const undeliverable: NotifyAddedUndeliverable[] = [];
  const startPayload = encodeAddedStartPayload(input.billId);

  for (const memberName of added) {
    const match = byKey.get(memberName.toLowerCase());
    const placeholderMeta = placeholderByName.get(memberName.toLowerCase());

    if (!match) {
      const reason: PendingAddedReason =
        placeholderMeta?.isPlaceholder || memberName.trim().startsWith("@")
          ? "placeholder"
          : "no_telegram_id";
      undeliverable.push(
        trackUndeliverable(input.db, {
          billId: input.billId,
          memberName,
          telegramUserId: null,
          reason,
          botUsername: input.botUsername,
          lastError: reason,
        }),
      );
      skipped += 1;
      continue;
    }

    const tgId = Number(match.telegram_user_id);
    const data = buildAddedChatData(input.db, {
      billId: input.billId,
      memberName,
      botUsername: input.botUsername,
      miniAppShortName: input.miniAppShortName,
    });
    if (!data) {
      undeliverable.push(
        trackUndeliverable(input.db, {
          billId: input.billId,
          memberName,
          telegramUserId: match.telegram_user_id,
          reason: "send_failed",
          botUsername: input.botUsername,
          lastError: "added_chat_data_null",
        }),
      );
      skipped += 1;
      continue;
    }

    try {
      const result = await sendWidgetOrText(token, {
        chatId: tgId,
        html: ADDED_WIDGET_HTML,
        textFallback: formatAddedCaption(data),
        chatData: serializeAddedChatData(data),
        allowQueries: true,
      });
      if (result.messageId != null) {
        sent += 1;
        clearOpenPendingAdded(input.db, input.billId, memberName);
        // Successful private delivery implies a reachable DM chat.
        input.db
          .query(
            `UPDATE users
             SET dm_started_at = COALESCE(dm_started_at, datetime('now'))
             WHERE telegram_user_id = ?1`,
          )
          .run(match.telegram_user_id);
        console.info("[widgets] notify added sent", {
          billId: input.billId,
          memberName,
          telegramUserId: match.telegram_user_id,
          mode: result.mode,
          messageId: result.messageId,
        });
        continue;
      }

      const err = result.error ?? "send_failed";
      const reason: PendingAddedReason = isNeverStartedError(err)
        ? "never_started"
        : "send_failed";
      undeliverable.push(
        trackUndeliverable(input.db, {
          billId: input.billId,
          memberName,
          telegramUserId: match.telegram_user_id,
          reason,
          botUsername: input.botUsername,
          lastError: err,
        }),
      );
      skipped += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[widgets] notify added failed", {
        billId: input.billId,
        memberName,
        telegramUserId: match.telegram_user_id,
        error: message,
        startPayload,
      });
      undeliverable.push(
        trackUndeliverable(input.db, {
          billId: input.billId,
          memberName,
          telegramUserId: match.telegram_user_id,
          reason: isNeverStartedError(message) ? "never_started" : "send_failed",
          botUsername: input.botUsername,
          lastError: message,
        }),
      );
      skipped += 1;
    }
  }

  return { sent, skipped, undeliverable };
}
