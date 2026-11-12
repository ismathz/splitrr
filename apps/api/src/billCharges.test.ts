import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { applyMigrations } from "@splitbot/db";
import { loadBillCharges, replaceBillCharges } from "./billCharges";

function seedBill(db: Database): string {
  db.query(
    `INSERT INTO groups (telegram_chat_id, title) VALUES ('-1001', 'G')`,
  ).run();
  const groupId = (
    db.query(`SELECT id FROM groups`).get() as { id: number }
  ).id;
  db.query(
    `INSERT INTO users (telegram_user_id, first_name) VALUES ('42', 'Host')`,
  ).run();
  const hostId = (
    db
      .query(`SELECT id FROM users WHERE telegram_user_id = '42'`)
      .get() as { id: number }
  ).id;
  const billId = randomUUID();
  db.query(
    `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id, bill_date, currency)
     VALUES (?1, ?2, 'Dinner', 'pending', ?3, '2026-11-12', 'USD')`,
  ).run(billId, groupId, hostId);
  return billId;
}

describe("bill charges persistence", () => {
  it("save → reload preserves taxes / service / custom charges", () => {
    const db = new Database(":memory:", { create: true, strict: true });
    applyMigrations(db);
    const billId = seedBill(db);

    replaceBillCharges(db, billId, [
      {
        chargeType: "service",
        amountCents: 1000,
        label: "Service Charge",
        ratePct: 10,
      },
      {
        chargeType: "tax",
        amountCents: 880,
        label: "Tax",
        ratePct: 8,
      },
      {
        chargeType: "custom",
        amountCents: 200,
        label: "Packaging",
        ratePct: null,
      },
    ]);

    const loaded = loadBillCharges(db, billId);
    expect(loaded).toHaveLength(3);
    expect(loaded.map((c) => c.chargeType).sort()).toEqual([
      "custom",
      "service",
      "tax",
    ]);

    const service = loaded.find((c) => c.chargeType === "service")!;
    expect(service.amountCents).toBe(1000);
    expect(service.ratePct).toBe(10);
    expect(service.label).toBe("Service Charge");

    const tax = loaded.find((c) => c.chargeType === "tax")!;
    expect(tax.amountCents).toBe(880);
    expect(tax.ratePct).toBe(8);

    const custom = loaded.find((c) => c.chargeType === "custom")!;
    expect(custom.amountCents).toBe(200);
    expect(custom.label).toBe("Packaging");
    expect(custom.ratePct).toBeNull();

    // Second save replaces (e.g. user clears tax).
    replaceBillCharges(db, billId, [
      {
        chargeType: "service",
        amountCents: 500,
        label: "Service Charge",
        ratePct: 5,
      },
    ]);
    const afterEdit = loadBillCharges(db, billId);
    expect(afterEdit).toHaveLength(1);
    expect(afterEdit[0]!.chargeType).toBe("service");
    expect(afterEdit[0]!.amountCents).toBe(500);
    expect(afterEdit[0]!.ratePct).toBe(5);
  });
});
