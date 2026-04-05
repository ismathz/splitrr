import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { createDb, BillSessionRepository, GroupRepository } from "@splitbot/db";
import { env } from "./env";
import { StorageService } from "./storage";
import { OpenAiOcrProvider } from "./ocr";
import { allocateCentsByWeight } from "./splitter";

const db = createDb(env.SQLITE_PATH);
const groups = new GroupRepository(db);
const sessions = new BillSessionRepository(db);
const storage = new StorageService({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  keyPrefix: env.S3_KEY_PREFIX
});
const ocr = new OpenAiOcrProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/api/bills", async (c) => {
  const body = await c.req.json<{
    telegramChatId: string;
    groupTitle: string;
    title: string;
    createdByUserId?: number;
  }>();

  const groupId = groups.upsertGroup(body.telegramChatId, body.groupTitle);
  const billId = randomUUID();

  sessions.create({
    id: billId,
    groupId,
    title: body.title,
    status: "uploaded",
    createdByUserId: body.createdByUserId
  });

  return c.json({ billId, groupId });
});

app.post("/api/bills/:billId/receipt", async (c) => {
  const billId = c.req.param("billId");
  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return c.json({ error: "file is required" }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `${billId}/${Date.now()}-${file.name}`;
  const stored = await storage.putObject(key, bytes, file.type || "image/jpeg");
  const signedUrl = await storage.getSignedUrl(stored.key);

  db.query(
    `INSERT INTO receipt_images (id, bill_session_id, storage_key, mime_type, size_bytes, ocr_status)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending')`
  ).run(randomUUID(), billId, stored.key, stored.contentType, stored.sizeBytes);

  sessions.updateStatus(billId, "parsed");
  return c.json({ key: stored.key, signedUrl });
});

app.post("/api/bills/:billId/ocr", async (c) => {
  const billId = c.req.param("billId");
  const body = await c.req.json<{ imageUrl: string }>();
  const parsed = await ocr.parseReceiptFromImageUrl(body.imageUrl);

  for (const item of parsed.items) {
    db.query(
      `INSERT INTO bill_items (id, bill_session_id, name, qty, unit_price_cents, total_price_cents, confidence)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).run(
      randomUUID(),
      billId,
      item.name,
      item.qty,
      item.unitPriceCents,
      item.totalPriceCents,
      item.confidence
    );
  }

  if (parsed.taxCents) {
    db.query(
      `INSERT INTO charges (id, bill_session_id, charge_type, amount_cents) VALUES (?1, ?2, 'tax', ?3)`
    ).run(randomUUID(), billId, parsed.taxCents);
  }

  if (parsed.tipCents) {
    db.query(
      `INSERT INTO charges (id, bill_session_id, charge_type, amount_cents) VALUES (?1, ?2, 'tip', ?3)`
    ).run(randomUUID(), billId, parsed.tipCents);
  }

  sessions.updateStatus(billId, "assigning");
  return c.json(parsed);
});

app.post("/api/bills/:billId/assignments", async (c) => {
  const billId = c.req.param("billId");
  const body = await c.req.json<{
    itemId: string;
    members: Array<{ userId: number; weight: number }>;
  }>();

  db.query("DELETE FROM item_assignments WHERE bill_item_id = ?1").run(body.itemId);

  for (const member of body.members) {
    db.query(
      `INSERT INTO item_assignments (id, bill_item_id, user_id, weight) VALUES (?1, ?2, ?3, ?4)`
    ).run(randomUUID(), body.itemId, member.userId, member.weight);
  }

  db.query(
    `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
     VALUES (?1, ?2, 'item_assigned', json_object('itemId', ?3))`
  ).run(randomUUID(), billId, body.itemId);

  return c.json({ ok: true });
});

app.post("/api/bills/:billId/settlements/compute", (c) => {
  const billId = c.req.param("billId");
  db.query("DELETE FROM settlements WHERE bill_session_id = ?1").run(billId);

  const items = db
    .query(
      `SELECT i.id AS itemId, i.total_price_cents AS totalPriceCents,
              a.user_id AS userId, a.weight AS weight
       FROM bill_items i
       LEFT JOIN item_assignments a ON a.bill_item_id = i.id
       WHERE i.bill_session_id = ?1`
    )
    .all(billId) as Array<{
    itemId: string;
    totalPriceCents: number;
    userId: number | null;
    weight: number | null;
  }>;

  const balances = new Map<number, number>();
  const grouped = new Map<string, typeof items>();
  for (const row of items) {
    if (!grouped.has(row.itemId)) grouped.set(row.itemId, []);
    grouped.get(row.itemId)?.push(row);
  }

  for (const rows of grouped.values()) {
    const total = rows[0].totalPriceCents;
    const members = rows
      .filter((r) => r.userId !== null)
      .map((r) => ({ userId: r.userId as number, weight: r.weight ?? 1 }));

    const allocation = allocateCentsByWeight({ itemTotalCents: total, members });
    for (const [userId, owed] of allocation.entries()) {
      balances.set(userId, (balances.get(userId) ?? 0) + owed);
    }
  }

  const debtors: Array<{ userId: number; amount: number }> = [];
  const creditors: Array<{ userId: number; amount: number }> = [];

  for (const [userId, amount] of balances) {
    if (amount > 0) debtors.push({ userId, amount });
    else if (amount < 0) creditors.push({ userId, amount: -amount });
  }

  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const transfer = Math.min(debtor.amount, creditor.amount);

    db.query(
      `INSERT INTO settlements (id, bill_session_id, payer_user_id, payee_user_id, amount_cents)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).run(randomUUID(), billId, debtor.userId, creditor.userId, transfer);

    debtor.amount -= transfer;
    creditor.amount -= transfer;
    if (debtor.amount === 0) i += 1;
    if (creditor.amount === 0) j += 1;
  }

  sessions.updateStatus(billId, "confirmed");
  return c.json({ ok: true });
});

app.post("/api/settlements/:settlementId/paid", (c) => {
  const settlementId = c.req.param("settlementId");
  db.query(
    `UPDATE settlements SET status = 'paid', updated_at = datetime('now') WHERE id = ?1`
  ).run(settlementId);
  return c.json({ ok: true });
});

app.get("/api/groups/:groupId/history", (c) => {
  const groupId = c.req.param("groupId");
  const rows = db
    .query(
      `SELECT id, title, status, created_at
       FROM bill_sessions
       WHERE group_id = ?1
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all(Number(groupId));
  return c.json({ bills: rows });
});

app.get("/api/bills/:billId/export.csv", (c) => {
  const billId = c.req.param("billId");
  const rows = db
    .query(
      `SELECT i.name, i.qty, i.unit_price_cents, i.total_price_cents
       FROM bill_items i
       WHERE i.bill_session_id = ?1`
    )
    .all(billId) as Array<{
    name: string;
    qty: number;
    unit_price_cents: number;
    total_price_cents: number;
  }>;

  const header = "name,qty,unit_price_cents,total_price_cents";
  const lines = rows.map((r) =>
    [r.name, r.qty, r.unit_price_cents, r.total_price_cents]
      .map((v) => `\"${String(v).replaceAll("\"", "\"\"")}\"`)
      .join(",")
  );

  return c.text([header, ...lines].join("\n"), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename=\"bill-${billId}.csv\"`
  });
});

app.post("/api/reminders/run", (c) => {
  const pending = db
    .query(
      `SELECT id, bill_session_id, payer_user_id, payee_user_id, amount_cents
       FROM settlements WHERE status = 'pending'`
    )
    .all();

  for (const row of pending as Array<{ bill_session_id: string } & Record<string, unknown>>) {
    db.query(
      `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
       VALUES (?1, ?2, 'reminder_sent', ?3)`
    ).run(randomUUID(), row.bill_session_id, JSON.stringify(row));
  }

  return c.json({ remindersQueued: pending.length });
});

await storage.assertBucketAccess();
serve({ fetch: app.fetch, port: env.PORT });
console.log(`API listening on ${env.PORT}`);
