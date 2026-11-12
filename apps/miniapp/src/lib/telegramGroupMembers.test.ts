import { describe, expect, it } from "bun:test";
import { defaultNewBillMembers } from "./telegramGroupMembers";

describe("defaultNewBillMembers", () => {
  const roster = [
    { name: "Alice", tgUserId: 101 },
    { name: "Bob", tgUserId: 102 },
    { name: "Cara", tgUserId: 103 },
  ];

  it("selects only the current viewer matched by Telegram id", () => {
    expect(
      defaultNewBillMembers({
        groupMembers: roster,
        currentUserId: 102,
        currentUserDisplayName: "Someone Else",
      }),
    ).toEqual(["Bob"]);
  });

  it("falls back to display-name match when id is missing from roster", () => {
    expect(
      defaultNewBillMembers({
        groupMembers: roster,
        currentUserId: 999,
        currentUserDisplayName: "cara",
      }),
    ).toEqual(["Cara"]);
  });

  it("uses display name alone when roster has no match", () => {
    expect(
      defaultNewBillMembers({
        groupMembers: roster,
        currentUserId: null,
        currentUserDisplayName: "Dana",
      }),
    ).toEqual(["Dana"]);
  });

  it("never pre-selects the full roster (small groups included)", () => {
    const selected = defaultNewBillMembers({
      groupMembers: roster,
      currentUserId: 101,
      currentUserDisplayName: "Alice",
    });
    expect(selected).toEqual(["Alice"]);
    expect(selected).not.toEqual(roster.map((m) => m.name));
  });

  it("returns empty when viewer identity is unknown", () => {
    expect(
      defaultNewBillMembers({
        groupMembers: roster,
        currentUserId: null,
        currentUserDisplayName: null,
      }),
    ).toEqual([]);
  });
});
