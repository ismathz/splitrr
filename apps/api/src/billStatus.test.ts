import { describe, expect, it } from "bun:test";
import {
  normalizeBillSessionStatus,
  statusAfterOpenWithMembers,
  statusFromPaymentChecklist,
} from "./billStatus";

describe("normalizeBillSessionStatus", () => {
  it("maps legacy active/settled", () => {
    expect(normalizeBillSessionStatus("active")).toBe("pending");
    expect(normalizeBillSessionStatus("settled")).toBe("completed");
    expect(normalizeBillSessionStatus("draft")).toBe("draft");
    expect(normalizeBillSessionStatus("pending")).toBe("pending");
    expect(normalizeBillSessionStatus("completed")).toBe("completed");
  });
});

describe("statusAfterOpenWithMembers", () => {
  it("promotes draft to pending when members exist", () => {
    expect(
      statusAfterOpenWithMembers({ currentStatus: "draft", memberCount: 2 })
    ).toBe("pending");
  });

  it("keeps draft when no members", () => {
    expect(
      statusAfterOpenWithMembers({ currentStatus: "draft", memberCount: 0 })
    ).toBe("draft");
  });

  it("keeps completed", () => {
    expect(
      statusAfterOpenWithMembers({
        currentStatus: "completed",
        memberCount: 3,
      })
    ).toBe("completed");
  });
});

describe("statusFromPaymentChecklist", () => {
  it("marks completed when everyone paid", () => {
    expect(
      statusFromPaymentChecklist({
        memberNames: ["Ada", "Bob"],
        paidByName: { Ada: true, Bob: true },
      })
    ).toBe("completed");
  });

  it("marks pending when someone unpaid", () => {
    expect(
      statusFromPaymentChecklist({
        memberNames: ["Ada", "Bob"],
        paidByName: new Map([
          ["Ada", true],
          ["Bob", false],
        ]),
      })
    ).toBe("pending");
  });

  it("keeps draft when no members", () => {
    expect(
      statusFromPaymentChecklist({
        memberNames: [],
        paidByName: {},
        currentStatus: "draft",
      })
    ).toBe("draft");
  });
});
