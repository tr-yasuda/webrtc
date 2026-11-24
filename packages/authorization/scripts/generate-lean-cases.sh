#!/usr/bin/env bash
set -euo pipefail

package_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$package_root"

mkdir -p .cache
elan run --install "$(cat proofs/lean-toolchain)" lake -d proofs exe authorizationCases \
  > .cache/lean-authorization-cases.json

(
  cd proofs
  elan run --install "$(cat lean-toolchain)" lake env lean Axioms.lean
) > .cache/lean-axioms.txt
