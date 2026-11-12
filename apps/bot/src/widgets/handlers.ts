import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  ADDED_WIDGET_HTML,
  BALANCE_REFRESH_REQUEST,
  BALANCE_WIDGET_HTML,
  answerWidgetQuery,
  buildAddedChatData,
  buildBalanceChatData,
  editMessageWidgetData,
  formatAddedCaption,
  formatBalanceCaption,
  parseMarkPaidRequest,
  serializeAddedChatData,
  serializeBalanceChatData,
  sendWidgetOrText,
} from "@splitbot/shared";

export type WidgetQueryUpdate = {
  id: string;
  from: { id: number; first_name?: string; username?: string };
  chat?: { id: number; type: string };
  message_id?: number;
  data: string;
};

function nextStatusFromChecklist(
  db: Database,
  billId: string,
  currentStatus: string,
): "draft" | "pending" | "completed" {
  const membersFromSession = db
    .query(
      `SELECT member_name FROM bill_session_members WHERE bill_session_id = ?1`,
    )
    .all(billId) as Array<{ member_name: string }>;
  const names = membersFromSession
    .map((m) => m.member_name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    return currentStatus === "completed" ? "completed" : "pending";
  }
  const paymentRows = db
    .query(
      `SELECT member_name, paid FROM bill_member_payment_status
       WHERE bill_session_id = ?1`,
    )
    .all(billId) as Array<{ member_name: string; paid: number }>;
  const paidByLower = new Map<string, boolean>();
  for (const row of paymentRows) {
    paidByLower.set(row.member_name.trim().toLowerCase(), row.paid === 1);
  }
  const allPaid = names.every(
    (name) => paidByLower.get(name.toLowerCase()) === true,
  );
  return allPaid ? "completed" : "pending";
}

export async function sendBalanceWidget(input: {
  db: Database;
  botToken: string;
  chatId: number;
  telegramUserId: number;
  botUsername: string;
  miniAppShortName: string;
}): Promise<{ mode: "widget" | "text"; error?: string }> {
  const data = buildBalanceChatData(input.db, input.telegramUserId, {
    botUsername: input.botUsername,
    miniAppShortName: input.miniAppShortName,
  });
  const chatData = serializeBalanceChatData(data);
  return sendWidgetOrText(input.botToken, {
    chatId: input.chatId,
    html: BALANCE_WIDGET_HTML,
    textFallback: formatBalanceCaption(data),
    chatData,
    allowQueries: true,
  });
}

export async function sendAddedWidget(input: {
  db: Database;
  botToken: string;
  chatId: number;
  billId: string;
  memberName: string;
  botUsername: string;
  miniAppShortName: string;
}): Promise<{ mode: "widget" | "text"; messageId?: number; error?: string }> {
  const data = buildAddedChatData(input.db, {
    billId: input.billId,
    memberName: input.memberName,
    botUsername: input.botUsername,
    miniAppShortName: input.miniAppShortName,
  });
  if (!data) return { mode: "text", error: "bill_not_found" };
  const chatData = serializeAddedChatData(data);
  return sendWidgetOrText(input.botToken, {
    chatId: input.chatId,
    html: ADDED_WIDGET_HTML,
    textFallback: formatAddedCaption(data),
    chatData,
    allowQueries: true,
  });
}

function resolveMemberNameForUser(
  db: Database,
  billId: string,
  telegramUserId: number,
): string | null {
  const user = db
    .query(
      `SELECT first_name, username, telegram_user_id
       FROM users WHERE telegram_user_id = ?1`,
    )
    .get(String(telegramUserId)) as {
    first_name: string | null;
    username: string | null;
    telegram_user_id: string;
  } | null;
  if (!user) return null;

  const keys = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = v?.trim().toLowerCase() ?? "";
    if (t) keys.add(t);
  };
  add(user.first_name);
  add(user.username);
  if (user.username) add(`@${user.username.replace(/^@/, "")}`);
  const full = `${user.first_name ?? ""}`.trim();
  add(full);

  const members = db
    .query(
      `SELECT member_name FROM bill_session_members WHERE bill_session_id = ?1`,
    )
    .all(billId) as Array<{ member_name: string }>;
  for (const row of members) {
    if (keys.has(row.member_name.trim().toLowerCase())) {
      return row.member_name;
    }
  }
  return null;
}

function markMemberPaid(
  db: Database,
  billId: string,
  memberName: string,
): { ok: true } | { ok: false; error: string } {
  const exists = db
    .query(`SELECT id, status FROM bill_sessions WHERE id = ?1`)
    .get(billId) as { id: string; status: string } | null;
  if (!exists) return { ok: false, error: "bill_not_found" };

  db.query(
    `INSERT INTO bill_member_payment_status (id, bill_session_id, member_name, paid)
     VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(bill_session_id, member_name) DO UPDATE SET
       paid = 1,
       updated_at = datetime('now')`,
  ).run(randomUUID(), billId, memberName);

  const next = nextStatusFromChecklist(db, billId, exists.status);
  db.query(
    `UPDATE bill_sessions SET status = ?2, updated_at = datetime('now') WHERE id = ?1`,
  ).run(billId, next);

  return { ok: true };
}

/**
 * Handle widget_query within 15s: answer, then edit chat_data when needed.
 */
export async function handleWidgetQuery(input: {
  db: Database;
  botToken: string;
  query: WidgetQueryUpdate;
  botUsername: string;
  miniAppShortName: string;
}): Promise<void> {
  const { query, db, botToken } = input;
  const data = (query.data ?? "").trim();
  const chatId = query.chat?.id;
  const messageId = query.message_id;

  try {
    if (data === BALANCE_REFRESH_REQUEST) {
      const balance = buildBalanceChatData(db, query.from.id, {
        botUsername: input.botUsername,
        miniAppShortName: input.miniAppShortName,
      });
      const chatData = serializeBalanceChatData(balance);
      await answerWidgetQuery(botToken, query.id, chatData);
      if (chatId != null && messageId != null) {
        await editMessageWidgetData(botToken, {
          chatId,
          messageId,
          chatData,
        });
      }
      return;
    }

    const billId = parseMarkPaidRequest(data);
    if (billId) {
      if (chatId == null || messageId == null) {
        await answerWidgetQuery(
          botToken,
          query.id,
          JSON.stringify({ ok: 0, e: "no_message" }),
        );
        return;
      }

      const memberName = resolveMemberNameForUser(db, billId, query.from.id);
      if (!memberName) {
        await answerWidgetQuery(
          botToken,
          query.id,
          JSON.stringify({ ok: 0, e: "not_member" }),
        );
        return;
      }

      const marked = markMemberPaid(db, billId, memberName);
      if (!marked.ok) {
        await answerWidgetQuery(
          botToken,
          query.id,
          JSON.stringify({ ok: 0, e: marked.error }),
        );
        return;
      }

      const added = buildAddedChatData(db, {
        billId,
        memberName,
        botUsername: input.botUsername,
        miniAppShortName: input.miniAppShortName,
      });
      const chatData = added
        ? serializeAddedChatData({ ...added, paid: 1 })
        : null;

      await answerWidgetQuery(
        botToken,
        query.id,
        JSON.stringify({ ok: 1, paid: 1 }),
      );
      if (chatData) {
        await editMessageWidgetData(botToken, {
          chatId,
          messageId,
          chatData,
        });
      }
      return;
    }

    await answerWidgetQuery(
      botToken,
      query.id,
      JSON.stringify({ ok: 0, e: "unknown" }),
    );
  } catch (err) {
    console.warn("[widgets] widget_query failed", err);
    try {
      await answerWidgetQuery(
        botToken,
        query.id,
        JSON.stringify({ ok: 0, e: "error" }),
      );
    } catch {
      // ignore
    }
  }
}

/** Mark that this Telegram user has started a private chat with the bot. */
export function markDmStarted(
  db: Database,
  from: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  },
): void {
  db.query(
    `INSERT INTO users (telegram_user_id, username, first_name, last_name, dm_started_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'))
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       username = COALESCE(excluded.username, users.username),
       first_name = COALESCE(excluded.first_name, users.first_name),
       last_name = COALESCE(excluded.last_name, users.last_name),
       dm_started_at = COALESCE(users.dm_started_at, datetime('now'))`,
  ).run(
    String(from.id),
    from.username ?? null,
    from.first_name ?? null,
    from.last_name ?? null,
  );
}
