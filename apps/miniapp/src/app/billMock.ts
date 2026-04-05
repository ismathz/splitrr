export type Item = {
  id: string;
  name: string;
  totalPriceCents: number;
  assignees: string[];
  /** Set when parsed by AI; omit for manually added items (UI uses keyword map). */
  emoji?: string;
};

export type BillDetails = {
  id: string;
  title: string;
  status: "uploaded" | "parsed" | "assigning" | "confirmed";
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
    status: "assigning",
    settled: false,
    items: mockNewBillItems,
  },
  {
    id: "bill-1002",
    title: "Lunch",
    status: "confirmed",
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

