#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
proof_dir="$repo_root/packages/authorization/proofs"

cd "$proof_dir"

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT

elan run --install "$(cat lean-toolchain)" lake env lean Axioms.lean > "$output_file"
node "$repo_root/scripts/check-authorization-axioms.mjs" "$output_file"
