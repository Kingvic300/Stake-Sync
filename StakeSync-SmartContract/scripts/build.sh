#!/usr/bin/env bash
# Builds the on-chain program to target/deploy/stake_sync.so.
# Uses the Solana platform-tools rustc directly, which avoids cargo-build-sbf failing to parse
# newer `rustup toolchain list` output ("invalid toolchain name ... platform-tools/rust").
set -euo pipefail
cd "$(dirname "$0")/.."

TOOLS_VERSION="${TOOLS_VERSION:-v1.54}"
PT="$HOME/.cache/solana/$TOOLS_VERSION/platform-tools"
if [ ! -x "$PT/rust/bin/rustc" ]; then
  cargo build-sbf --install-only --tools-version "$TOOLS_VERSION"
fi

PATH="$PT/rust/bin:$PT/llvm/bin:$PATH" \
  cargo build-sbf --no-rustup-override --manifest-path programs/stake_sync/Cargo.toml "$@"
