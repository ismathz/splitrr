import { describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { createDb } from "./client";
import {
  BillSessionRepository,
  GroupRepository,
  GroupRosterRepository
} from "./repositories";

describe("bill session create with Telegram creator", () => {
  it("fails FK when Telegram id is written directly into created_by_user_id", () => {
    const path = `/tmp/splitbot-bill-fk-${Date.now()}.db`;
    try {
      const db = createDb(path);
      const groups = new GroupRepository(db);
      const sessions = new BillSessionRepository(db);
      const groupId = groups.upsertGroup("-1001", "G");
      expect(() =>
        sessions.create({
          id: "b1",
          groupId,
          title: "Receipt",
          status: "draft",
          createdByUserId: 999_001_234, // Telegram id, not users.id
          billDate: "2026-11-01"
        })
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  });

  it("succeeds after upserting Telegram user and using internal users.id", () => {
    const path = `/tmp/splitbot-bill-ok-${Date.now()}.db`;
    try {
      const db = createDb(path);
      const groups = new GroupRepository(db);
      const roster = new GroupRosterRepository(db);
      const sessions = new BillSessionRepository(db);
      const groupId = groups.upsertGroup("-1002", "G");
      const internalId = roster.upsertUser({
        telegramUserId: "999001234",
        firstName: "Ada"
      });
      roster.addMember(groupId, internalId);
      sessions.create({
        id: "b2",
        groupId,
        title: "Receipt",
        status: "draft",
        createdByUserId: internalId,
        billDate: "2026-11-01"
      });
      const row = db
        .query("SELECT created_by_user_id FROM bill_sessions WHERE id = ?1")
        .get("b2") as { created_by_user_id: number };
      expect(row.created_by_user_id).toBe(internalId);
    } finally {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  });
});
