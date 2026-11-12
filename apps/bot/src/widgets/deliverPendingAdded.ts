import type { Database } from "bun:sqlite";
import {
  listPendingAddedForUser,
  markPendingAddedDelivered,
  parseAddedStartPayload,
} from "@splitbot/db";
import { sendAddedWidget } from "./handlers";

/**
 * After /start in private chat, deliver any queued "you've been added" cards
 * for this Telegram user (and optional bill hint from the start payload).
 */
export async function deliverPendingAddedCards(input: {
  db: Database;
  botToken: string;
  chatId: number;
  from: {
    id: number;
    username?: string;
    first_name?: string;
  };
  startPayload?: string | null;
  botUsername: string;
  miniAppShortName: string;
}): Promise<{ delivered: number; failed: number }> {
  const parsed = input.startPayload?.trim()
    ? parseAddedStartPayload(input.startPayload.trim())
    : null;

  const pending = listPendingAddedForUser(input.db, {
    telegramUserId: input.from.id,
    username: input.from.username ?? null,
    firstName: input.from.first_name ?? null,
    billIdHint: parsed?.billId ?? null,
  });

  let delivered = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      // Bind this Telegram user onto the pending row for future lookups.
      if (
        !row.telegram_user_id ||
        row.telegram_user_id !== String(input.from.id)
      ) {
        input.db
          .query(
            `UPDATE pending_added_notifications
             SET telegram_user_id = ?2
             WHERE id = ?1`,
          )
          .run(row.id, String(input.from.id));
      }

      const result = await sendAddedWidget({
        db: input.db,
        botToken: input.botToken,
        chatId: input.chatId,
        billId: row.bill_session_id,
        memberName: row.member_name,
        botUsername: input.botUsername,
        miniAppShortName: input.miniAppShortName,
      });

      if (result.messageId != null) {
        markPendingAddedDelivered(input.db, row.id);
        delivered += 1;
        console.info("[widgets] pending added delivered", {
          pendingId: row.id,
          billId: row.bill_session_id,
          memberName: row.member_name,
          telegramUserId: input.from.id,
          mode: result.mode,
          messageId: result.messageId,
        });
        continue;
      }

      failed += 1;
      const err = result.error ?? "unknown";
      console.warn("[widgets] pending added deliver failed", {
        pendingId: row.id,
        billId: row.bill_session_id,
        memberName: row.member_name,
        telegramUserId: input.from.id,
        error: err,
      });
      input.db
        .query(
          `UPDATE pending_added_notifications
           SET last_error = ?2
           WHERE id = ?1`,
        )
        .run(row.id, err.slice(0, 500));
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[widgets] pending added deliver failed", {
        pendingId: row.id,
        billId: row.bill_session_id,
        memberName: row.member_name,
        telegramUserId: input.from.id,
        error: message,
      });
    }
  }

  return { delivered, failed };
}
