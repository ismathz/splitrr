export interface AllocationInput {
  itemTotalCents: number;
  members: Array<{ userId: number; weight: number }>;
}

export function allocateCentsByWeight(input: AllocationInput): Map<number, number> {
  const result = new Map<number, number>();
  const totalWeight = input.members.reduce((sum, m) => sum + m.weight, 0);
  if (!totalWeight) {
    return result;
  }

  let allocated = 0;
  const provisional = input.members.map((member) => {
    const exact = (input.itemTotalCents * member.weight) / totalWeight;
    const rounded = Math.floor(exact);
    allocated += rounded;
    return { ...member, rounded, remainder: exact - rounded };
  });

  let delta = input.itemTotalCents - allocated;
  provisional
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((member) => {
      const add = delta > 0 ? 1 : 0;
      result.set(member.userId, member.rounded + add);
      if (delta > 0) {
        delta -= 1;
      }
    });

  return result;
}
