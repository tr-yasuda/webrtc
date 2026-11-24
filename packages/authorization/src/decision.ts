export type AuthorizationDecision<TOperation extends string, TTarget, TReason extends string> =
  | {
      readonly allowed: true;
      readonly operation: TOperation;
      readonly target: TTarget;
      readonly reason: "allowed";
    }
  | {
      readonly allowed: false;
      readonly operation: TOperation;
      readonly target: TTarget;
      readonly reason: Exclude<TReason, "allowed">;
    };
