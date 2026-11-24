#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
proof_dir="$repo_root/packages/authorization/proofs"

cd "$proof_dir"

output="$(elan run --install "$(cat lean-toolchain)" lake env lean Axioms.lean)"

expected_count="$(grep -c '^#print axioms ' Axioms.lean)"
actual_count="$(printf '%s\n' "$output" | grep -Ec 'depends on axioms:|does not depend on any axioms')"

if [[ "$actual_count" -ne "$expected_count" ]]; then
  printf 'axiom check produced %s results, expected %s\n' "$actual_count" "$expected_count" >&2
  exit 1
fi

unexpected="$(
  printf '%s\n' "$output" | awk '
    /does not depend on any axioms/ { next }
    /depends on axioms: \[/ {
      line = $0
      sub(/^.*\[/, "", line)
      sub(/\].*$/, "", line)
      count = split(line, axioms, /, */)
      for (i = 1; i <= count; i++) {
        axiom = axioms[i]
        if (axiom != "propext" && axiom != "Classical.choice" && axiom != "Quot.sound") {
          print axiom
        }
      }
    }
  '
)"

if [[ -n "$unexpected" ]]; then
  printf 'unexpected axioms:\n%s\n' "$unexpected" >&2
  exit 1
fi
