#!/usr/bin/env bash
set -euo pipefail

if [[ "${AUTHORIZATION_LEAN_CASES_READY:-}" == "true" ]]; then
  exit 0
fi

package_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$package_root"

mkdir -p .cache
elan run --install "$(cat proofs/lean-toolchain)" lake -d proofs exe authorizationCases \
  > .cache/lean-authorization-cases.json

(
  cd proofs
  elan run --install "$(cat lean-toolchain)" lake env lean Axioms.lean
) > .cache/lean-axioms.txt
