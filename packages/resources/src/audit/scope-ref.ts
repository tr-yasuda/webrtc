import { createHmac } from "node:crypto";
import type { QuotaScope } from "../contract.js";

export function computeScopeRef(secret: string, keyVersion: number, scope: QuotaScope): string {
  return createHmac("sha256", secret)
    .update(`v${keyVersion}\0${scope.kind}\0${scope.key}`, "utf8")
    .digest("base64url");
}
