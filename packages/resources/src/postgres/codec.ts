import type { QuotaScope } from "../contract.js";
import { RESOURCE_STATES, type ResourceState } from "../state.js";

export function toResourceState(value: string): ResourceState {
  if (!RESOURCE_STATES.includes(value as ResourceState)) {
    throw new Error(`unknown resource state: ${value}`);
  }
  return value as ResourceState;
}

export function toQuotaScopeKind(value: string): QuotaScope["kind"] {
  if (value !== "user" && value !== "room" && value !== "server") {
    throw new Error(`unknown quota scope kind: ${value}`);
  }
  return value;
}
