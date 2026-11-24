import { test } from "vitest";

export function authSpecName(ids: string | readonly string[], name: string): string {
  const values = typeof ids === "string" ? [ids] : ids;
  return `[${values.join(", ")}] ${name}`;
}

export function authSpecTest(
  ids: string | readonly string[],
  name: string,
  fn: () => void | Promise<void>,
  timeout?: number,
): void {
  if (timeout === undefined) {
    test(authSpecName(ids, name), fn);
    return;
  }
  test(authSpecName(ids, name), fn, timeout);
}
