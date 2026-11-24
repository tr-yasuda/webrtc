export type RuleViolation<TReason extends string> = {
  readonly reason: Exclude<TReason, "allowed">;
};
