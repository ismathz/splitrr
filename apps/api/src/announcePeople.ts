import type { Database } from "bun:sqlite";
import type { AnnouncePerson } from "./announce";

type UserRow = {
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

function displayNameForUser(row: UserRow): string {
  const first = row.first_name?.trim() ?? "";
  const last = row.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const username = row.username?.trim();
  if (username) return username;
  return row.telegram_user_id;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve bill members to Telegram @username / user id for announce tags.
 * Matches session member names and assignee display names against group roster users.
 */
export function resolveAnnouncePeople(
  db: Database,
  billId: string
): AnnouncePerson[] {
  const session = db
    .query("SELECT group_id FROM bill_sessions WHERE id = ?1")
    .get(billId) as { group_id: number } | null;
  if (!session) return [];

  const memberNames: string[] = [];
  const seenNames = new Set<string>();
  const pushName = (raw: string | null | undefined) => {
    const name = raw?.trim() ?? "";
    if (!name) return;
    const key = normalizeKey(name);
    if (seenNames.has(key)) return;
    seenNames.add(key);
    memberNames.push(name);
  };

  const stored = db
    .query(
      `SELECT member_name,
              is_placeholder AS is_placeholder,
              placeholder_username AS placeholder_username
       FROM bill_session_members
       WHERE bill_session_id = ?1
       ORDER BY created_at ASC`
    )
    .all(billId) as Array<{
    member_name: string;
    is_placeholder: number | null;
    placeholder_username: string | null;
  }>;
  const placeholderByName = new Map<
    string,
    { isPlaceholder: boolean; username: string | null }
  >();
  for (const row of stored) {
    pushName(row.member_name);
    const key = normalizeKey(row.member_name);
    const flagged =
      row.is_placeholder === 1 ||
      Boolean(row.placeholder_username?.trim()) ||
      row.member_name.trim().startsWith("@");
    placeholderByName.set(key, {
      isPlaceholder: flagged,
      username: row.placeholder_username?.trim() || null
    });
  }

  const assignees = db
    .query(
      `SELECT COALESCE(NULLIF(trim(u.first_name), ''), NULLIF(trim(u.username), ''), u.telegram_user_id) AS display_name
       FROM bill_items i
       JOIN item_assignments a ON a.bill_item_id = i.id
       JOIN users u ON u.id = a.user_id
       WHERE i.bill_session_id = ?1
       ORDER BY a.created_at ASC`
    )
    .all(billId) as Array<{ display_name: string | null }>;
  for (const row of assignees) pushName(row.display_name);

  const rosterUsers = db
    .query(
      `SELECT u.telegram_user_id AS telegram_user_id,
              u.username AS username,
              u.first_name AS first_name,
              u.last_name AS last_name
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?1`
    )
    .all(session.group_id) as UserRow[];

  const byKey = new Map<string, AnnouncePerson>();
  for (const row of rosterUsers) {
    if (row.telegram_user_id.startsWith("name:")) continue;
    if (row.telegram_user_id.startsWith("web-")) continue;
    const tgUserId = Number(row.telegram_user_id);
    if (!Number.isFinite(tgUserId)) continue;

    const person: AnnouncePerson = {
      displayName: displayNameForUser(row),
      username: row.username?.trim() || null,
      telegramUserId: tgUserId
    };

    const keys = [
      displayNameForUser(row),
      row.first_name?.trim() ?? "",
      row.username?.trim() ?? "",
      row.username ? `@${row.username.trim().replace(/^@/, "")}` : ""
    ];
    for (const keyRaw of keys) {
      const key = normalizeKey(keyRaw);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, person);
    }
  }

  const people: AnnouncePerson[] = [];
  for (const name of memberNames) {
    const key = normalizeKey(name);
    const matched = byKey.get(key);
    const placeholderMeta = placeholderByName.get(key);
    if (matched) {
      people.push({
        displayName: name,
        username: matched.username,
        telegramUserId: matched.telegramUserId,
        isPlaceholder: false
      });
    } else {
      const usernameFromName = name.trim().startsWith("@")
        ? name.trim().replace(/^@/, "")
        : null;
      people.push({
        displayName: name,
        username: placeholderMeta?.username || usernameFromName,
        isPlaceholder: placeholderMeta?.isPlaceholder ?? true
      });
    }
  }
  return people;
}
