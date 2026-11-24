#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

node scripts/validate-authorization-policy.mjs
node scripts/generate-authorization-policy.mjs --check
