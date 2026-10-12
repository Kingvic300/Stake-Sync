#!/usr/bin/env bash
# Regenerates idl/stake_sync.json. Run after changing instructions, accounts, events or errors.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p idl
cargo test -p stake_sync --features idl-build --lib __anchor_private_print_idl -- --show-output --quiet --test-threads=1 | python3 scripts/idl.py
