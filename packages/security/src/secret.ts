const revealSecretSymbol: unique symbol = Symbol("revealSecret");
const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

export class Secret<T> {
  readonly #value: T;

  public constructor(value: T) {
    this.#value = value;
  }

  public [revealSecretSymbol](purpose: string): T {
    if (purpose.trim().length === 0) {
      throw new Error("secret reveal purpose is required");
    }
    return this.#value;
  }

  public toString(): string {
    return "[REDACTED]";
  }

  public toJSON(): never {
    throw new Error("secret values cannot be serialized");
  }

  public [inspectSymbol](): string {
    return "[REDACTED]";
  }
}

export type Sensitive<T> = Secret<T>;

export function secret<T>(value: T): Secret<T> {
  return new Secret(value);
}

export function revealSecret<T>(value: Secret<T>, purpose: string): T {
  return value[revealSecretSymbol](purpose);
}

export function isSecret(value: unknown): value is Secret<unknown> {
  return value instanceof Secret;
}
