import { allocateCentsByWeight as allocateShared } from "@splitbot/shared";

export interface AllocationInput {
  itemTotalCents: number;
  members: Array<{ userId: number; weight: number }>;
}

export function allocateCentsByWeight(input: AllocationInput): Map<number, number> {
  return allocateShared(
    input.itemTotalCents,
    input.members.map((member) => ({
      id: member.userId,
      weight: member.weight,
    })),
  );
}
