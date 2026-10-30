/**
 * @deprecated Import from `./billTypes` (types) or `./billDevMocks` (fixtures).
 * Re-exports kept so older imports keep typechecking during the move.
 */
export type { BillDetails, Item } from "./billTypes";
export { formatBillDateLabel } from "./billTypes";
export {
  mockBills,
  mockMembers,
  mockNewBillItems,
} from "./billDevMocks";
