import type { ResourceState } from "@webrtc/domain";

export type { ResourceState } from "@webrtc/domain";

export const RESOURCE_STATES: readonly ResourceState[] = [
  "reserved",
  "in-use",
  "release-pending",
  "isolated",
  "released",
  "result-unknown",
];

// ResourceState の全状態をキーに持つため、ドメイン型に状態を追加すると型検査で検出できる。
const TRANSITIONS: Readonly<Record<ResourceState, readonly ResourceState[]>> = {
  reserved: ["in-use", "released", "isolated", "result-unknown"],
  "in-use": ["release-pending", "released", "isolated", "result-unknown"],
  "release-pending": ["in-use", "released", "isolated", "result-unknown"],
  "result-unknown": ["in-use", "release-pending", "released", "isolated"],
  isolated: ["released"],
  released: [],
};

export class ResourceTransitionError extends Error {
  public readonly from: ResourceState;
  public readonly to: ResourceState;

  public constructor(from: ResourceState, to: ResourceState) {
    super(`resource state cannot transition from ${from} to ${to}`);
    this.name = "ResourceTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: ResourceState, to: ResourceState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ResourceState, to: ResourceState): void {
  if (!canTransition(from, to)) {
    throw new ResourceTransitionError(from, to);
  }
}

export function isCounted(state: ResourceState): boolean {
  return state !== "released";
}
