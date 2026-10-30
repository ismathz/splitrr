import type { BillDetails, Item } from "./billTypes";

/**
 * Local-only sample data. Guarded by `import.meta.env.DEV` so production
 * builds dead-code-eliminate the fixtures.
 * Runtime also requires `VITE_SPLITBOT_USE_MOCK_DATA=true` via `isDevMockDataEnabled()`.
 */

export const mockMembers: string[] = import.meta.env.DEV
  ? [
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
    ]
  : [];

export const mockNewBillItems: Item[] = import.meta.env.DEV
  ? [
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
    ]
  : [];

export const mockBills: BillDetails[] = import.meta.env.DEV
  ? [
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
    ]
  : [];
