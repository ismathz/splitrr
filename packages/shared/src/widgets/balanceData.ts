import type { Database } from "bun:sqlite";
import { allocateCentsEqual } from "../allocateCents";
import { applyChargesProportionally } from "../billShares";
import { compactJsonUnderBudget, truncateUtf8 } from "./size";
import type { BalanceChatData, BalanceLineData } from "./types";

type UserRow = {
  id: number;
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

function displayName(row: UserRow): string {
  const full = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  if (full) return full;
  if (row.username?.trim()) return row.username.trim();
  return row.telegram_user_id;
}

function nameKeysForUser(row: UserRow): string[] {
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

function shortLabel(title: string, place: string | null): string {
  const base = place?.trim() ? `${title} · ${place}` : title;
  return truncateUtf8(base, 40);
}

/**
 * Build personal balance chat_data for a Telegram user across open bills.
 * Prefers pending settlements; falls back to unpaid honor-system shares
 * (viewer owes bill creator / creator is owed by unpaid members).
 */
export function buildBalanceChatData(
  db: Database,
  telegramUserId: number,
  opts: { botUsername: string; miniAppShortName: string; revision?: number },
): BalanceChatData {
  const user = db
    .query(
      `SELECT id, telegram_user_id, username, first_name, last_name
       FROM users WHERE telegram_user_id = ?1`,
    )
    .get(String(telegramUserId)) as UserRow | null;

  const owe: BalanceLineData[] = [];
  const owed: BalanceLineData[] = [];
  const seen = new Set<string>();

  const pushLine = (
    bucket: BalanceLineData[],
    line: BalanceLineData,
  ) => {
    const key = `${line.b}:${line.n}:${bucket === owe ? "owe" : "owed"}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (line.a <= 0) return;
    bucket.push({
      ...line,
      n: truncateUtf8(line.n, 24),
      l: line.l ? truncateUtf8(line.l, 40) : undefined,
    });
  };

  if (user) {
    const settlementRows = db
      .query(
        `SELECT s.amount_cents AS amountCents,
                s.payer_user_id AS payerUserId,
                s.payee_user_id AS payeeUserId,
                bs.id AS billId,
                bs.title AS title,
                bs.place AS place,
                bs.currency AS currency,
                g.telegram_chat_id AS chatId,
                COALESCE(NULLIF(trim(payer.first_name), ''), NULLIF(trim(payer.username), ''), payer.telegram_user_id) AS payerName,
                COALESCE(NULLIF(trim(payee.first_name), ''), NULLIF(trim(payee.username), ''), payee.telegram_user_id) AS payeeName
         FROM settlements s
         JOIN bill_sessions bs ON bs.id = s.bill_session_id
         JOIN groups g ON g.id = bs.group_id
         JOIN users payer ON payer.id = s.payer_user_id
         JOIN users payee ON payee.id = s.payee_user_id
         WHERE s.status != 'paid'
           AND bs.status != 'completed'
           AND (s.payer_user_id = ?1 OR s.payee_user_id = ?1)
         ORDER BY s.created_at DESC
         LIMIT 20`,
      )
      .all(user.id) as Array<{
      amountCents: number;
      payerUserId: number;
      payeeUserId: number;
      billId: string;
      title: string;
      place: string | null;
      currency: string;
      chatId: string;
      payerName: string;
      payeeName: string;
    }>;

    for (const row of settlementRows) {
      const label = shortLabel(row.title, row.place);
      if (row.payerUserId === user.id) {
        pushLine(owe, {
          n: row.payeeName,
          a: row.amountCents,
          c: row.currency,
          b: row.billId,
          g: row.chatId,
          l: label,
        });
      } else {
        pushLine(owed, {
          n: row.payerName,
          a: row.amountCents,
          c: row.currency,
          b: row.billId,
          g: row.chatId,
          l: label,
        });
      }
    }
  }

  // Honor-system fallback when settlements are empty / sparse.
  const keys = user ? nameKeysForUser(user) : [];
  if (keys.length === 0 && !user) {
    // Unknown user — empty card.
  } else {
    const openBills = db
      .query(
        `SELECT bs.id AS billId,
                bs.title AS title,
                bs.place AS place,
                bs.currency AS currency,
                bs.created_by_user_id AS createdByUserId,
                g.telegram_chat_id AS chatId,
                g.id AS groupId
         FROM bill_sessions bs
         JOIN groups g ON g.id = bs.group_id
         WHERE bs.status IN ('pending', 'active', 'draft')
         ORDER BY bs.updated_at DESC
         LIMIT 40`,
      )
      .all() as Array<{
      billId: string;
      title: string;
      place: string | null;
      currency: string;
      createdByUserId: number | null;
      chatId: string;
      groupId: number;
    }>;

    for (const bill of openBills) {
      const members = db
        .query(
          `SELECT member_name FROM bill_session_members
           WHERE bill_session_id = ?1 ORDER BY created_at ASC`,
        )
        .all(bill.billId) as Array<{ member_name: string }>;

      const memberNames = members.map((m) => m.member_name.trim()).filter(Boolean);
      if (memberNames.length === 0) continue;

      const viewerName = memberNames.find((n) =>
        keys.includes(n.toLowerCase()),
      );
      // Also match via group roster tg id when member name differs.
      let matchedName = viewerName ?? null;
      if (!matchedName && user) {
        const roster = db
          .query(
            `SELECT COALESCE(NULLIF(trim(u.first_name), ''), NULLIF(trim(u.username), ''), u.telegram_user_id) AS name
             FROM group_members gm
             JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = ?1 AND u.id = ?2`,
          )
          .get(bill.groupId, user.id) as { name: string } | null;
        if (roster?.name) {
          const hit = memberNames.find(
            (n) => n.toLowerCase() === roster.name.toLowerCase(),
          );
          matchedName = hit ?? null;
        }
      }
      if (!matchedName) continue;

      const paidRows = db
        .query(
          `SELECT member_name, paid FROM bill_member_payment_status
           WHERE bill_session_id = ?1`,
        )
        .all(bill.billId) as Array<{ member_name: string; paid: number }>;
      const paid = new Map(
        paidRows.map((r) => [r.member_name.trim().toLowerCase(), r.paid === 1]),
      );

      const itemRows = db
        .query(
          `SELECT i.total_price_cents AS total,
                  COALESCE(NULLIF(trim(u.first_name), ''), NULLIF(trim(u.username), ''), u.telegram_user_id) AS assignee
           FROM bill_items i
           LEFT JOIN item_assignments a ON a.bill_item_id = i.id
           LEFT JOIN users u ON u.id = a.user_id
           WHERE i.bill_session_id = ?1`,
        )
        .all(bill.billId) as Array<{ total: number; assignee: string | null }>;

      const shares = new Map<string, number>();
      const byItem = new Map<string, { total: number; assignees: string[] }>();
      // Re-query with item id for proper split.
      const detailed = db
        .query(
          `SELECT i.id AS itemId, i.total_price_cents AS total,
                  COALESCE(NULLIF(trim(u.first_name), ''), NULLIF(trim(u.username), ''), u.telegram_user_id) AS assignee
           FROM bill_items i
           LEFT JOIN item_assignments a ON a.bill_item_id = i.id
           LEFT JOIN users u ON u.id = a.user_id
           WHERE i.bill_session_id = ?1`,
        )
        .all(bill.billId) as Array<{
        itemId: string;
        total: number;
        assignee: string | null;
      }>;
      for (const row of detailed) {
        let entry = byItem.get(row.itemId);
        if (!entry) {
          entry = { total: row.total, assignees: [] };
          byItem.set(row.itemId, entry);
        }
        if (row.assignee?.trim()) entry.assignees.push(row.assignee.trim());
      }
      for (const entry of byItem.values()) {
        if (entry.assignees.length === 0) continue;
        const parts = allocateCentsEqual(entry.total, entry.assignees);
        for (const [name, share] of parts) {
          shares.set(name, (shares.get(name) ?? 0) + share);
        }
      }
      // Equal-split leftover for members with no item assignments.
      if (shares.size === 0 && memberNames.length > 0) {
        const total = itemRows.reduce((s, r) => s + (r.total || 0), 0);
        // Deduplicate item totals (left join inflates).
        const uniqTotal =
          [...byItem.values()].reduce((s, e) => s + e.total, 0) || total;
        const equal = allocateCentsEqual(uniqTotal, memberNames);
        for (const [name, each] of equal) shares.set(name, each);
      }

      const chargeRows = db
        .query(
          `SELECT amount_cents AS amountCents FROM charges WHERE bill_session_id = ?1`,
        )
        .all(bill.billId) as Array<{ amountCents: number }>;
      const chargesTotal = chargeRows.reduce(
        (s, r) => s + (r.amountCents || 0),
        0,
      );
      if (chargesTotal !== 0) {
        const withCharges = applyChargesProportionally(shares, chargesTotal);
        shares.clear();
        for (const [name, amt] of withCharges) shares.set(name, amt);
      }

      const viewerShare = shares.get(matchedName) ?? 0;
      const viewerPaid = paid.get(matchedName.toLowerCase()) === true;

      let creatorName: string | null = null;
      if (bill.createdByUserId != null) {
        const creator = db
          .query(
            `SELECT id, telegram_user_id, username, first_name, last_name
             FROM users WHERE id = ?1`,
          )
          .get(bill.createdByUserId) as UserRow | null;
        if (creator) {
          const dn = displayName(creator);
          creatorName =
            memberNames.find((n) => n.toLowerCase() === dn.toLowerCase()) ??
            memberNames.find((n) =>
              nameKeysForUser(creator).includes(n.toLowerCase()),
            ) ??
            dn;
        }
      }
      if (!creatorName) creatorName = memberNames[0]!;

      const label = shortLabel(bill.title, bill.place);
      const isCreator =
        creatorName.toLowerCase() === matchedName.toLowerCase() ||
        (user != null && bill.createdByUserId === user.id);

      if (isCreator) {
        for (const name of memberNames) {
          if (name.toLowerCase() === matchedName.toLowerCase()) continue;
          if (paid.get(name.toLowerCase()) === true) continue;
          const amt = shares.get(name) ?? 0;
          if (amt <= 0) continue;
          // Skip if a settlement line already covers this bill+person.
          pushLine(owed, {
            n: name,
            a: amt,
            c: bill.currency,
            b: bill.billId,
            g: bill.chatId,
            l: label,
          });
        }
      } else if (!viewerPaid && viewerShare > 0) {
        pushLine(owe, {
          n: creatorName,
          a: viewerShare,
          c: bill.currency,
          b: bill.billId,
          g: bill.chatId,
          l: label,
        });
      }
    }
  }

  return {
    r: opts.revision ?? Date.now(),
    owe: owe.slice(0, 8),
    owed: owed.slice(0, 8),
    bot: opts.botUsername.replace(/^@/, ""),
    app: opts.miniAppShortName,
  };
}

export function serializeBalanceChatData(data: BalanceChatData): string {
  return compactJsonUnderBudget(data);
}
