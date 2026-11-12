import type { Database } from "bun:sqlite";

export type JoinerIdentity = {
  /** Internal users.id of the real Telegram user. */
  userId: number;
  telegramUserId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName: string;
};

export type PlaceholderClaimResult = {
  claimedMemberNames: string[];
  billsTouched: string[];
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function displayNameForJoiner(joiner: JoinerIdentity): string {
  const t = joiner.displayName.trim();
  if (t) return t;
  const first = joiner.firstName?.trim() ?? "";
  const last = joiner.lastName?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const username = joiner.username?.trim();
  if (username) return username;
  return joiner.telegramUserId;
}

/** Keys that can match a placeholder member_name / placeholder_username. */
export function joinerMatchKeys(joiner: JoinerIdentity): Set<string> {
  const keys = new Set<string>();
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const key = normalizeKey(raw);
    if (key) keys.add(key);
  };
  push(joiner.username);
  push(joiner.firstName);
  push(joiner.displayName);
  push(`${joiner.firstName ?? ""} ${joiner.lastName ?? ""}`);
  push(joiner.lastName);
  return keys;
}

/**
 * Parse a typed add-members value into display name + optional @username.
 * `@alice` → username placeholder; plain `Alice` → name-only placeholder.
 */
export function parsePlaceholderInput(raw: string): {
  memberName: string;
  placeholderUsername: string | null;
  isUsernamePlaceholder: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      memberName: "",
      placeholderUsername: null,
      isUsernamePlaceholder: false,
    };
  }
  if (trimmed.startsWith("@")) {
    const username = trimmed.slice(1).trim().replace(/^@/, "");
    if (!username) {
      return {
        memberName: "",
        placeholderUsername: null,
        isUsernamePlaceholder: false,
      };
    }
    return {
      memberName: `@${username}`,
      placeholderUsername: username.toLowerCase(),
      isUsernamePlaceholder: true,
    };
  }
  // Bare telegram-looking handle without @ still treated as name unless it
  // looks like a single token username the creator intends — keep as name.
  return {
    memberName: trimmed,
    placeholderUsername: null,
    isUsernamePlaceholder: false,
  };
}

function syntheticKeysForMember(input: {
  memberName: string;
  placeholderUsername: string | null;
}): string[] {
  const keys = new Set<string>();
  const nameKey = normalizeKey(input.memberName);
  if (nameKey) {
    keys.add(`name:${nameKey}`);
    keys.add(`name:${input.memberName.trim().toLowerCase()}`);
  }
  if (input.placeholderUsername) {
    keys.add(`name:@${input.placeholderUsername}`);
    keys.add(`name:${input.placeholderUsername}`);
  }
  return [...keys];
}

function transferAssignments(
  db: Database,
  fromUserId: number,
  toUserId: number,
): void {
  if (fromUserId === toUserId) return;

  const rows = db
    .query(
      `SELECT id, bill_item_id, weight
       FROM item_assignments
       WHERE user_id = ?1`,
    )
    .all(fromUserId) as Array<{
    id: string;
    bill_item_id: string;
    weight: number;
  }>;

  for (const row of rows) {
    const existing = db
      .query(
        `SELECT id, weight FROM item_assignments
         WHERE bill_item_id = ?1 AND user_id = ?2`,
      )
      .get(row.bill_item_id, toUserId) as
      | { id: string; weight: number }
      | null;

    if (existing) {
      db.query(
        `UPDATE item_assignments SET weight = ?2 WHERE id = ?1`,
      ).run(existing.id, Number(existing.weight) + Number(row.weight));
      db.query(`DELETE FROM item_assignments WHERE id = ?1`).run(row.id);
    } else {
      db.query(`UPDATE item_assignments SET user_id = ?2 WHERE id = ?1`).run(
        row.id,
        toUserId,
      );
    }
  }
}

function transferSettlements(
  db: Database,
  fromUserId: number,
  toUserId: number,
): void {
  if (fromUserId === toUserId) return;
  db.query(
    `UPDATE settlements SET payer_user_id = ?2 WHERE payer_user_id = ?1`,
  ).run(fromUserId, toUserId);
  db.query(
    `UPDATE settlements SET payee_user_id = ?2 WHERE payee_user_id = ?1`,
  ).run(fromUserId, toUserId);
}

/**
 * When a real Telegram user taps Join, match open-bill placeholders by
 * @username or display name and move synthetic name:* shares onto them.
 */
export function claimPlaceholdersForJoiner(
  db: Database,
  groupId: number,
  joiner: JoinerIdentity,
): PlaceholderClaimResult {
  const matchKeys = joinerMatchKeys(joiner);
  if (matchKeys.size === 0) {
    return { claimedMemberNames: [], billsTouched: [] };
  }

  const realDisplay = displayNameForJoiner(joiner);
  const claimedMemberNames: string[] = [];
  const billsTouched = new Set<string>();

  const placeholders = db
    .query(
      `SELECT m.id AS id,
              m.bill_session_id AS bill_session_id,
              m.member_name AS member_name,
              m.is_placeholder AS is_placeholder,
              m.placeholder_username AS placeholder_username
       FROM bill_session_members m
       JOIN bill_sessions bs ON bs.id = m.bill_session_id
       WHERE bs.group_id = ?1
         AND bs.status IN ('draft', 'pending', 'active')
         AND (
           m.is_placeholder = 1
           OR m.placeholder_username IS NOT NULL
           OR m.member_name LIKE '@%'
         )`,
    )
    .all(groupId) as Array<{
    id: string;
    bill_session_id: string;
    member_name: string;
    is_placeholder: number;
    placeholder_username: string | null;
  }>;

  for (const row of placeholders) {
    const usernameKey = row.placeholder_username
      ? normalizeKey(row.placeholder_username)
      : null;
    const nameKey = normalizeKey(row.member_name);
    const matches =
      (usernameKey != null && matchKeys.has(usernameKey)) ||
      matchKeys.has(nameKey);
    if (!matches) continue;

    // Prefer keeping an existing real member row with the joiner's display name.
    const conflict = db
      .query(
        `SELECT id FROM bill_session_members
         WHERE bill_session_id = ?1
           AND LOWER(TRIM(member_name)) = LOWER(TRIM(?2))
           AND id != ?3`,
      )
      .get(row.bill_session_id, realDisplay, row.id) as { id: string } | null;

    const targetMemberName = conflict ? row.member_name : realDisplay;

    for (const synKey of syntheticKeysForMember({
      memberName: row.member_name,
      placeholderUsername: row.placeholder_username,
    })) {
      const syn = db
        .query(`SELECT id FROM users WHERE telegram_user_id = ?1`)
        .get(synKey) as { id: number } | null;
      if (!syn) continue;
      transferAssignments(db, syn.id, joiner.userId);
      transferSettlements(db, syn.id, joiner.userId);
      db.query(
        `DELETE FROM group_members
         WHERE group_id = ?1 AND user_id = ?2`,
      ).run(groupId, syn.id);
    }

    // Payment status rows are keyed by member_name — rename when we adopt real name.
    if (targetMemberName !== row.member_name) {
      const paidConflict = db
        .query(
          `SELECT id FROM bill_member_payment_status
           WHERE bill_session_id = ?1 AND member_name = ?2`,
        )
        .get(row.bill_session_id, targetMemberName) as { id: string } | null;
      if (paidConflict) {
        db.query(
          `DELETE FROM bill_member_payment_status
           WHERE bill_session_id = ?1 AND member_name = ?2`,
        ).run(row.bill_session_id, row.member_name);
      } else {
        db.query(
          `UPDATE bill_member_payment_status
           SET member_name = ?3, updated_at = datetime('now')
           WHERE bill_session_id = ?1 AND member_name = ?2`,
        ).run(row.bill_session_id, row.member_name, targetMemberName);
      }
    }

    if (conflict) {
      db.query(`DELETE FROM bill_session_members WHERE id = ?1`).run(row.id);
    } else {
      db.query(
        `UPDATE bill_session_members
         SET member_name = ?2,
             is_placeholder = 0,
             placeholder_username = NULL
         WHERE id = ?1`,
      ).run(row.id, targetMemberName);
    }

    claimedMemberNames.push(row.member_name);
    billsTouched.add(row.bill_session_id);
  }

  return {
    claimedMemberNames,
    billsTouched: [...billsTouched],
  };
}
