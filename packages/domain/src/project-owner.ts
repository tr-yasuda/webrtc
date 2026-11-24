export type ProjectOwnerChange =
  | { readonly kind: "remove"; readonly currentIsOwner: boolean }
  | {
      readonly kind: "changeRole";
      readonly currentIsOwner: boolean;
      readonly nextIsOwner: boolean;
    };

export type ProjectOwnerInvariantResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "last-owner" | "owner-count-invalid";
    };

export function checkProjectOwnerInvariant(input: {
  readonly activeOwnerCount: number;
  readonly change: ProjectOwnerChange;
}): ProjectOwnerInvariantResult {
  if (!Number.isInteger(input.activeOwnerCount) || input.activeOwnerCount < 0) {
    return { ok: false, reason: "owner-count-invalid" };
  }
  const removesOwner =
    input.change.currentIsOwner && (input.change.kind === "remove" || !input.change.nextIsOwner);
  if (removesOwner && input.activeOwnerCount <= 1) {
    return { ok: false, reason: "last-owner" };
  }
  return { ok: true };
}
