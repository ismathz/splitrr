import type { Database } from "bun:sqlite";
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

/**
 * DM "you've been added" widgets to newly added bill members who have started
 * the bot (dm_started_at). Gracefully falls back to plain text if sendWidget fails.
 */
export async function notifyNewlyAddedMembers(input: {
  db: Database;
  botToken: string | undefined;
  billId: string;
  previousMembers: string[];
  nextMembers: string[];
  botUsername: string;
  miniAppShortName: string;
}): Promise<{ sent: number; skipped: number }> {
  const token = input.botToken?.trim();
  if (!token) return { sent: 0, skipped: 0 };

  const prev = new Set(
    input.previousMembers.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  const added = input.nextMembers
    .map((n) => n.trim())
    .filter((n) => n && !prev.has(n.toLowerCase()));
  if (added.length === 0) return { sent: 0, skipped: 0 };

  const session = input.db
    .query(`SELECT group_id FROM bill_sessions WHERE id = ?1`)
    .get(input.billId) as { group_id: number } | null;
  if (!session) return { sent: 0, skipped: added.length };

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

  const byKey = new Map<string, RosterUser>();
  for (const row of roster) {
    if (row.telegram_user_id.startsWith("name:")) continue;
    if (row.telegram_user_id.startsWith("web-")) continue;
    if (!row.dm_started_at) continue;
    const tgId = Number(row.telegram_user_id);
    if (!Number.isFinite(tgId) || tgId <= 0) continue;
    for (const key of nameKeys(row)) {
      if (!byKey.has(key)) byKey.set(key, row);
    }
  }

  let sent = 0;
  let skipped = 0;
  for (const memberName of added) {
    const match = byKey.get(memberName.toLowerCase());
    if (!match) {
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
      if (result.messageId != null) sent += 1;
      else skipped += 1;
    } catch (err) {
      console.warn("[widgets] notify added failed", memberName, err);
      skipped += 1;
    }
  }
  return { sent, skipped };
}
