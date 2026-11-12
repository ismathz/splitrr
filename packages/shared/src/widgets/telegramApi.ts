export type SendWidgetParams = {
  chatId: number | string;
  html: string;
  /**
   * Plain-text body for sendMessage when sendWidget fails.
   * Never sent as a widget caption — Telegram renders captions under the
   * widget on capable clients, which duplicates the card UI.
   */
  textFallback: string;
  chatData?: string;
  publicData?: string;
  allowQueries?: boolean;
  width?: number;
  height?: number;
};

export type SendWidgetResult =
  | { ok: true; messageId: number }
  | { ok: false; error: string; status?: number };

async function telegramApi(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  status: number;
  result?: unknown;
  description?: string;
}> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: { ok?: boolean; result?: unknown; description?: string } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, status: res.status, description: "bad_json" };
  }
  return {
    ok: Boolean(res.ok && json.ok),
    status: res.status,
    result: json.result,
    description: json.description,
  };
}

export async function sendWidget(
  botToken: string,
  params: Omit<SendWidgetParams, "textFallback"> & { textFallback?: string },
): Promise<SendWidgetResult> {
  // caption is optional in Bot API sendWidget; omit it so widget-capable
  // clients show only the HTML card (no duplicate title under the widget).
  const body: Record<string, unknown> = {
    chat_id: params.chatId,
    html: params.html,
    allow_queries: params.allowQueries ?? true,
  };
  if (params.chatData != null) body.chat_data = params.chatData;
  if (params.publicData != null) body.public_data = params.publicData;
  if (params.width != null) body.width = params.width;
  if (params.height != null) body.height = params.height;

  const res = await telegramApi(botToken, "sendWidget", body);
  if (!res.ok) {
    return {
      ok: false,
      error: res.description ?? `sendWidget_failed_${res.status}`,
      status: res.status,
    };
  }
  const messageId = (res.result as { message_id?: number } | undefined)
    ?.message_id;
  if (typeof messageId !== "number") {
    return { ok: false, error: "sendWidget_missing_message_id" };
  }
  return { ok: true, messageId };
}

export async function answerWidgetQuery(
  botToken: string,
  widgetQueryId: string,
  data?: string,
): Promise<boolean> {
  const body: Record<string, unknown> = { widget_query_id: widgetQueryId };
  if (data != null) body.data = data;
  const res = await telegramApi(botToken, "answerWidgetQuery", body);
  return res.ok;
}

export async function editMessageWidgetData(
  botToken: string,
  params: {
    chatId: number | string;
    messageId: number;
    chatData?: string;
    publicData?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = {
    chat_id: params.chatId,
    message_id: params.messageId,
  };
  if (params.chatData != null) body.chat_data = params.chatData;
  if (params.publicData != null) body.public_data = params.publicData;
  const res = await telegramApi(botToken, "editMessageWidgetData", body);
  if (res.ok) return { ok: true };
  const desc = res.description ?? "";
  if (desc.toLowerCase().includes("message is not modified")) {
    return { ok: true };
  }
  return { ok: false, error: desc || `edit_failed_${res.status}` };
}

/**
 * Prefer widget with no caption; fall back to plain text when sendWidget fails.
 * Non-widget clients that still receive a successful sendWidget see unsupported
 * media (no caption). Full text is only sent when the API rejects the widget.
 */
export async function sendWidgetOrText(
  botToken: string,
  params: SendWidgetParams,
): Promise<{ mode: "widget" | "text"; messageId?: number; error?: string }> {
  const widget = await sendWidget(botToken, params);
  if (widget.ok) {
    return { mode: "widget", messageId: widget.messageId };
  }
  console.warn("[widgets] sendWidget failed, falling back to text", widget.error);
  const textRes = await telegramApi(botToken, "sendMessage", {
    chat_id: params.chatId,
    text: params.textFallback.slice(0, 4096),
    disable_web_page_preview: true,
  });
  if (!textRes.ok) {
    return {
      mode: "text",
      error: textRes.description ?? widget.error,
    };
  }
  const messageId = (textRes.result as { message_id?: number } | undefined)
    ?.message_id;
  return { mode: "text", messageId, error: widget.error };
}
