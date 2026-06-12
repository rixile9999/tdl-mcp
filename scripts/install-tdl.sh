#!/usr/bin/env bash
# Install a specific tdl release binary (https://github.com/iyear/tdl).
#
# Usage:
#   scripts/install-tdl.sh [vX.Y.Z]
#
# Version defaults to the pin in .tdl-version at the repo root. The asset
# checksum is verified against the release's tdl_checksums.txt.
#
# Env:
#   TDL_INSTALL_DIR — target directory (default /usr/local/bin; pick a
#                     user-writable dir like "$RUNNER_TEMP/tdl-bin" in CI)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(tr -d '[:space:]' < "$REPO_ROOT/.tdl-version")}"
INSTALL_DIR="${TDL_INSTALL_DIR:-/usr/local/bin}"

case "$(uname -s)" in
  Linux) OS="Linux" ;;
  Darwin) OS="MacOS" ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64) ARCH="64bit" ;;
  arm64 | aarch64) ARCH="arm64" ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

ASSET="tdl_${OS}_${ARCH}.tar.gz"
BASE_URL="https://github.com/iyear/tdl/releases/download/${VERSION}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "downloading ${BASE_URL}/${ASSET}"
curl -fsSL --retry 3 -o "$TMP_DIR/$ASSET" "${BASE_URL}/${ASSET}"
curl -fsSL --retry 3 -o "$TMP_DIR/tdl_checksums.txt" "${BASE_URL}/tdl_checksums.txt"

(
  cd "$TMP_DIR"
  grep " ${ASSET}\$" tdl_checksums.txt > expected.txt
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum -c expected.txt
  else
    shasum -a 256 -c expected.txt
  fi
)

tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR" tdl
mkdir -p "$INSTALL_DIR"
install -m 0755 "$TMP_DIR/tdl" "$INSTALL_DIR/tdl"

echo "installed $("$INSTALL_DIR/tdl" version | head -1) to $INSTALL_DIR/tdl"
