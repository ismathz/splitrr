import type { ParsedReceipt } from "@splitbot/shared";

import { mockBills, mockMembers, mockNewBillItems } from "@/app/billDevMocks";

/** Local copies of API shapes — avoids a circular import with `splitbotApi`. */
type ApiBillMemberProfile = {
  name: string;
  photoUrl: string | null;
  tgUserId: number | null;
};

type ApiBillCharge = {
  id: string;
  chargeType: string;
  amountCents: number;
  label: string | null;
  ratePct: number | null;
};

type ApiBillDetails = {
  id: string;
  title: string;
  status: "draft" | "pending" | "completed";
  currency: string;
  billDate: string;
  place: string | null;
  settled: boolean;
  members?: string[];
  memberProfiles?: ApiBillMemberProfile[];
  items: Array<{
    id: string;
    name: string;
    totalPriceCents: number;
    assignees: string[];
  }>;
  charges?: ApiBillCharge[];
};

type ApiBillHistoryEntry = {
  id: string;
  title: string;
  status: "draft" | "pending" | "completed";
  currency: string;
  billDate: string;
  place: string | null;
  settled: boolean;
  createdAt?: string;
  members?: string[];
};

type ApiBillPaymentStatusMember = {
  name: string;
  paid: boolean;
};

type ApiGroupRoster = {
  members: Array<{
    tgUserId: number;
    name: string;
    username: string | null;
    photoUrl: string | null;
  }>;
  memberCount: number | null;
  seenCount: number;
  unseenCount: number | null;
  botIsAdmin?: boolean | null;
  botUsername?: string | null;
  backfillError?: string | null;
};

function mockDelayMs(envKey: string, fallback: number): number {
  const raw = import.meta.env[envKey];
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function mockWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

type MockBillRecord = ApiBillDetails & {
  createdAt: string;
};

const bills = new Map<string, MockBillRecord>();
const paidByBill = new Map<string, Set<string>>();
let seeded = false;
let billSeq = 1000;

function seedIfNeeded(): void {
  if (seeded || !import.meta.env.DEV) return;
  seeded = true;
  for (const bill of mockBills) {
    bills.set(bill.id, {
      id: bill.id,
      title: bill.title,
      status: bill.status,
      currency: bill.currency,
      billDate: bill.billDate,
      place: bill.place,
      settled: bill.settled,
      members: bill.members ?? mockMembers.slice(0, 4),
      memberProfiles: (bill.members ?? mockMembers.slice(0, 4)).map(
        (name, i) => ({
          name,
          photoUrl: null,
          tgUserId: 9000 + i,
        }),
      ),
      items: bill.items.map((item) => ({
        id: item.id,
        name: item.name,
        totalPriceCents: item.totalPriceCents,
        assignees: item.assignees ?? [],
      })),
      charges: bill.charges ?? [],
      createdAt: `${bill.billDate}T12:00:00.000Z`,
    });
    if (bill.settled) {
      const members = bill.members ?? mockMembers.slice(0, 4);
      paidByBill.set(bill.id, new Set(members));
    }
  }
}

function nextBillId(): string {
  billSeq += 1;
  return `mock-bill-${billSeq}`;
}

/** Fixture OCR result — rich enough to exercise items + charges UI. */
export function mockParsedReceipt(): ParsedReceipt {
  const items = mockNewBillItems.map((item) => ({
    name: item.name,
    qty: 1,
    unitPriceCents: item.totalPriceCents,
    totalPriceCents: item.totalPriceCents,
    confidence: 0.92,
  }));
  const subtotalCents = items.reduce((s, it) => s + it.totalPriceCents, 0);
  const serviceChargeCents = Math.round(subtotalCents * 0.1);
  const taxCents = Math.round((subtotalCents + serviceChargeCents) * 0.08);
  return {
    merchantName: "North Beach Pizza",
    currency: "USD",
    subtotalCents,
    serviceChargeCents,
    serviceChargeRatePct: 10,
    taxCents,
    taxRatePct: 8,
    tipCents: 0,
    totalCents: subtotalCents + serviceChargeCents + taxCents,
    items,
    discountAdjustments: [
      {
        name: "Happy hour",
        amountCents: -300,
        confidence: 0.85,
      },
    ],
    rawText: "MOCK RECEIPT\nPasta 16.00\nPizza 24.00\nDrinks 12.15",
  };
}

export async function mockCreateBillSession(body: {
  title: string;
  billDate?: string;
  place?: string | null;
  currency?: string;
}): Promise<{ billId: string; groupId: number }> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_CREATE_MS", 350));
  const billId = nextBillId();
  const day = body.billDate ?? new Date().toISOString().slice(0, 10);
  bills.set(billId, {
    id: billId,
    title: body.title,
    status: "draft",
    currency: body.currency ?? "USD",
    billDate: day,
    place: body.place ?? null,
    settled: false,
    members: mockMembers.slice(0, 4),
    memberProfiles: mockMembers.slice(0, 4).map((name, i) => ({
      name,
      photoUrl: null,
      tgUserId: 9000 + i,
    })),
    items: [],
    charges: [],
    createdAt: new Date().toISOString(),
  });
  paidByBill.set(billId, new Set());
  return { billId, groupId: 1 };
}

export async function mockUploadReceipt(
  billId: string,
): Promise<{ key: string; signedUrl: string }> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_UPLOAD_MS", 1200));
  if (!bills.has(billId)) {
    throw new Error(
      JSON.stringify({
        error: "bill_not_found",
        message: `Mock bill ${billId} was not found.`,
      }),
    );
  }
  const key = `mock/receipts/${billId}/${Date.now()}.jpg`;
  return {
    key,
    signedUrl: `https://example.invalid/${key}`,
  };
}

export async function mockRunReceiptOcr(
  billId: string,
): Promise<ParsedReceipt> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_OCR_MS", 2000));
  if (!bills.has(billId)) {
    throw new Error(
      JSON.stringify({
        error: "bill_not_found",
        message: `Mock bill ${billId} was not found.`,
      }),
    );
  }
  return mockParsedReceipt();
}

export async function mockGetGroupRosterByTelegramChatId(): Promise<ApiGroupRoster> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_ROSTER_MS", 200));
  const members = mockMembers.slice(0, 6).map((name, i) => ({
    tgUserId: 9000 + i,
    name,
    username: name.toLowerCase(),
    photoUrl: null,
  }));
  return {
    members,
    memberCount: members.length,
    seenCount: members.length,
    unseenCount: 0,
    botIsAdmin: true,
    botUsername: "SplitrrBot",
  };
}

export async function mockGetGroupHistoryByTelegramChatId(): Promise<{
  bills: ApiBillHistoryEntry[];
}> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_HISTORY_MS", 250));
  const billsList = [...bills.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((bill) => ({
      id: bill.id,
      title: bill.title,
      status: bill.status,
      currency: bill.currency,
      billDate: bill.billDate,
      place: bill.place,
      settled: bill.settled,
      createdAt: bill.createdAt,
      members: bill.members ?? [],
    }));
  return { bills: billsList };
}

export async function mockGetBillDetails(billId: string): Promise<ApiBillDetails> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_GET_MS", 200));
  const bill = bills.get(billId);
  if (!bill) {
    throw new Error(
      JSON.stringify({
        error: "bill_not_found",
        message: `Mock bill ${billId} was not found.`,
      }),
    );
  }
  const { createdAt: _createdAt, ...rest } = bill;
  return structuredClone(rest);
}

export async function mockUpdateBillDetails(
  billId: string,
  body: {
    title: string;
    billDate?: string;
    place?: string | null;
    members?: string[];
    items?: Array<{
      id?: string;
      name: string;
      totalPriceCents: number;
      assignees?: string[];
    }>;
    charges?: Array<{
      id?: string;
      chargeType: string;
      amountCents: number;
      label?: string | null;
      ratePct?: number | null;
    }>;
  },
): Promise<{ ok: true }> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_SAVE_MS", 400));
  const bill = bills.get(billId);
  if (!bill) {
    throw new Error(
      JSON.stringify({
        error: "bill_not_found",
        message: `Mock bill ${billId} was not found.`,
      }),
    );
  }
  bill.title = body.title;
  if (body.billDate !== undefined) bill.billDate = body.billDate;
  if (body.place !== undefined) bill.place = body.place;
  if (body.members) {
    bill.members = body.members;
    bill.memberProfiles = body.members.map((name, i) => ({
      name,
      photoUrl: null,
      tgUserId: 9000 + i,
    }));
  }
  if (body.items) {
    bill.items = body.items.map((item, i) => ({
      id: item.id ?? `item-${billId}-${i}`,
      name: item.name,
      totalPriceCents: item.totalPriceCents,
      assignees: item.assignees ?? [],
    }));
  }
  if (body.charges) {
    bill.charges = body.charges.map((charge, i) => ({
      id: charge.id ?? `charge-${billId}-${i}`,
      chargeType: charge.chargeType,
      amountCents: charge.amountCents,
      label: charge.label ?? null,
      ratePct: charge.ratePct ?? null,
    }));
  }
  if (bill.status === "draft" && (bill.items.length > 0 || (bill.members?.length ?? 0) > 0)) {
    bill.status = "pending";
  }
  return { ok: true };
}

export async function mockDeleteBill(billId: string): Promise<{ ok: true }> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_DELETE_MS", 300));
  bills.delete(billId);
  paidByBill.delete(billId);
  return { ok: true };
}

export async function mockGetBillPaymentStatus(
  billId: string,
): Promise<{ members: ApiBillPaymentStatusMember[] }> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_GET_MS", 150));
  const bill = bills.get(billId);
  if (!bill) {
    throw new Error(
      JSON.stringify({
        error: "bill_not_found",
        message: `Mock bill ${billId} was not found.`,
      }),
    );
  }
  const paid = paidByBill.get(billId) ?? new Set<string>();
  const names =
    bill.members && bill.members.length > 0
      ? bill.members
      : [...new Set(bill.items.flatMap((it) => it.assignees))];
  return {
    members: names.map((name) => ({ name, paid: paid.has(name) })),
  };
}

export async function mockUpdateBillPaymentStatus(
  billId: string,
  body: { name: string; paid: boolean },
): Promise<{ ok: true; status?: "draft" | "pending" | "completed" }> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_SAVE_MS", 250));
  const bill = bills.get(billId);
  if (!bill) {
    throw new Error(
      JSON.stringify({
        error: "bill_not_found",
        message: `Mock bill ${billId} was not found.`,
      }),
    );
  }
  let paid = paidByBill.get(billId);
  if (!paid) {
    paid = new Set();
    paidByBill.set(billId, paid);
  }
  if (body.paid) paid.add(body.name);
  else paid.delete(body.name);

  const members =
    bill.members && bill.members.length > 0
      ? bill.members
      : [...new Set(bill.items.flatMap((it) => it.assignees))];
  const allPaid =
    members.length > 0 && members.every((name) => paid!.has(name));
  bill.status = allPaid ? "completed" : bill.status === "draft" ? "pending" : bill.status;
  bill.settled = allPaid;
  return { ok: true, status: bill.status };
}

export async function mockComputeBillSettlements(): Promise<{
  ok: true;
  transfers: number;
}> {
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_SAVE_MS", 300));
  return { ok: true, transfers: 2 };
}

export async function mockAnnounceBillToGroup(
  billId: string,
): Promise<{ ok: true; openUrl?: string | null }> {
  seedIfNeeded();
  await mockWait(mockDelayMs("VITE_SPLITBOT_MOCK_ANNOUNCE_MS", 400));
  const bill = bills.get(billId);
  if (!bill) {
    throw new Error(
      JSON.stringify({
        error: "bill_not_found",
        message: `Mock bill ${billId} was not found.`,
      }),
    );
  }
  if (bill.status === "draft") {
    bill.status = "pending";
    bill.settled = false;
  }
  return { ok: true, openUrl: null };
}
