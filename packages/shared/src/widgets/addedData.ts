import type { Database } from "bun:sqlite";
import { compactJsonUnderBudget, truncateUtf8 } from "./size";
import type { AddedChatData, AddedItemData } from "./types";

/**
 * Build "you've been added" chat_data for one bill member.
 */
export function buildAddedChatData(
  db: Database,
  input: {
    billId: string;
    memberName: string;
    botUsername: string;
    miniAppShortName: string;
    revision?: number;
  },
): AddedChatData | null {
  const bill = db
    .query(
      `SELECT bs.id AS id,
              bs.title AS title,
              bs.currency AS currency,
              bs.created_by_user_id AS createdByUserId,
              g.telegram_chat_id AS chatId
       FROM bill_sessions bs
       JOIN groups g ON g.id = bs.group_id
       WHERE bs.id = ?1`,
    )
    .get(input.billId) as {
    id: string;
    title: string;
    currency: string;
    createdByUserId: number | null;
    chatId: string;
  } | null;
  if (!bill) return null;

  const detailed = db
    .query(
      `SELECT i.id AS itemId,
              i.name AS name,
              i.total_price_cents AS total,
              COALESCE(NULLIF(trim(u.first_name), ''), NULLIF(trim(u.username), ''), u.telegram_user_id) AS assignee
       FROM bill_items i
       LEFT JOIN item_assignments a ON a.bill_item_id = i.id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE i.bill_session_id = ?1`,
    )
    .all(input.billId) as Array<{
    itemId: string;
    name: string;
    total: number;
    assignee: string | null;
  }>;

  const byItem = new Map<
    string,
    { name: string; total: number; assignees: string[] }
  >();
  for (const row of detailed) {
    let entry = byItem.get(row.itemId);
    if (!entry) {
      entry = { name: row.name, total: row.total, assignees: [] };
      byItem.set(row.itemId, entry);
    }
    if (row.assignee?.trim()) entry.assignees.push(row.assignee.trim());
  }

  const memberKey = input.memberName.trim().toLowerCase();
  const items: AddedItemData[] = [];
  let share = 0;
  for (const entry of byItem.values()) {
    const hit = entry.assignees.some((a) => a.toLowerCase() === memberKey);
    if (!hit) continue;
    const part = Math.floor(entry.total / Math.max(entry.assignees.length, 1));
    share += part;
    items.push({ n: truncateUtf8(entry.name, 28), a: part });
  }

  if (items.length === 0) {
    // Member on roster but no items yet — still notify with equal split of total.
    const memberCountRow = db
      .query(
        `SELECT COUNT(*) AS c FROM bill_session_members WHERE bill_session_id = ?1`,
      )
      .get(input.billId) as { c: number };
    const total = [...byItem.values()].reduce((s, e) => s + e.total, 0);
    const n = Math.max(Number(memberCountRow.c) || 1, 1);
    share = Math.floor(total / n);
  }

  const paidRow = db
    .query(
      `SELECT paid FROM bill_member_payment_status
       WHERE bill_session_id = ?1 AND lower(member_name) = lower(?2)`,
    )
    .get(input.billId, input.memberName) as { paid: number } | null;

  let pay: string | undefined;
  if (bill.createdByUserId != null) {
    const payer = db
      .query(`SELECT payment_details FROM users WHERE id = ?1`)
      .get(bill.createdByUserId) as { payment_details: string | null } | null;
    const details = payer?.payment_details?.trim();
    if (details) pay = truncateUtf8(details, 120);
  }

  return {
    r: input.revision ?? Date.now(),
    t: truncateUtf8(bill.title, 48),
    c: bill.currency,
    s: share,
    paid: paidRow?.paid === 1 ? 1 : 0,
    items: items.slice(0, 6),
    ...(pay ? { pay } : {}),
    bid: bill.id,
    cid: bill.chatId,
    bot: input.botUsername.replace(/^@/, ""),
    app: input.miniAppShortName,
    mn: truncateUtf8(input.memberName, 40),
  };
}

export function serializeAddedChatData(data: AddedChatData): string {
  return compactJsonUnderBudget(data);
}
