/**
 * Telegram rejects InlineKeyboardButton.web_app outside private chats.
 * Groups/supergroups use a `url` deep link (`t.me/.../...?startapp=`).
 */
export function buildOpenMiniAppReplyMarkup(input: {
  chatType: "private" | "group" | "supergroup" | "channel" | string;
  miniUrl: string;
  directUrl: string | null;
  buttonText?: string;
}):
  | {
      inline_keyboard: Array<
        Array<
          | { text: string; web_app: { url: string } }
          | { text: string; url: string }
        >
      >;
    }
  | undefined {
  const text = input.buttonText ?? "Open Splitrr";

  if (input.chatType === "private") {
    return {
      inline_keyboard: [[{ text, web_app: { url: input.miniUrl } }]]
    };
  }

  if (input.directUrl) {
    return {
      inline_keyboard: [[{ text, url: input.directUrl }]]
    };
  }

  return undefined;
}
