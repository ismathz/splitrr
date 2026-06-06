export type Item = {
  id: string;
  name: string;
  totalPriceCents: number;
  assignees: string[];
  /** Set when parsed by AI; omit for manually added items (UI uses keyword map). */
  emoji?: string;
};

/** Format ISO date YYYY-MM-DD for display (local calendar day). */
export function formatBillDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type BillDetails = {
  id: string;
  title: string;
  status: "draft" | "active" | "settled";
  /** ISO 4217 code. */
  currency: string;
  /** ISO date YYYY-MM-DD — when the meal / bill happened. */
  billDate: string;
  /** Venue or place (e.g. restaurant). */
  place: string | null;
  /** False until everyone has settled up (mock flag for now). */
  settled: boolean;
  items: Item[];
};

export const mockMembers = [
  "Alice",
  "Bob",
  "Carol",
  "Dave",
  "Eve",
  "Frank",
  "Grace",
  "Heidi",
  "Ivan",
  "Judy",
  "Mallory",
  "Niaj",
  "Olivia",
  "Peggy",
  "Rupert",
  "Sybil",
  "Trent",
  "Uma",
  "Victor",
  "Wendy",
];

export const mockNewBillItems: Item[] = [
  {
    id: "item-1",
    name: "Pasta",
    totalPriceCents: 1600,
    assignees: [],
    emoji: "🍝",
  },
  {
    id: "item-2",
    name: "Pizza",
    totalPriceCents: 2400,
    assignees: [],
    emoji: "🍕",
  },
  {
    id: "item-3",
    name: "Drinks",
    totalPriceCents: 1215,
    assignees: [],
  },
];

export const mockBills: BillDetails[] = [
  {
    id: "bill-1001",
    title: "Dinner",
    status: "active",
    currency: "USD",
    billDate: "2026-04-06",
    place: "North Beach Pizza",
    settled: false,
    items: mockNewBillItems,
  },
  {
    id: "bill-1002",
    title: "Lunch",
    status: "settled",
    currency: "MVR",
    billDate: "2026-04-01",
    place: "Market Street Deli",
    settled: true,
    items: [
      {
        id: "item-11",
        name: "Sandwich",
        totalPriceCents: 1250,
        assignees: ["Bob", "Carol"],
      },
      {
        id: "item-12",
        name: "Fries",
        totalPriceCents: 800,
        assignees: ["Alice", "Bob"],
      },
    ],
  },
];

