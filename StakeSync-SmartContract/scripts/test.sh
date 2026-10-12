#!/usr/bin/env bash
# Builds the program, then runs the math unit tests and the LiteSVM integration tests.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build.sh
cargo test -p stake_sync "$@"
