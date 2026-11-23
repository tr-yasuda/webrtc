export type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed" | "closed";
export type ResourceState =
  | "reserved"
  | "in-use"
  | "release-pending"
  | "isolated"
  | "released"
  | "result-unknown";
