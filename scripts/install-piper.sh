#!/usr/bin/env bash
set -Eeuo pipefail

PIPER_VERSION="${PIPER_VERSION:-v1.2.0}"
PIPER_DIR="${PIPER_DIR:-/opt/piper}"
PIPER_VOICES_DIR="${PIPER_VOICES_DIR:-$HOME/piper-voices}"
PIPER_VOICE="${PIPER_VOICE:-en_GB-alan-medium}"

log() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'WARNING: %s\n' "$*" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'ERROR: required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

install_piper() {
  local arch piper_asset tmp

  require_command curl
  require_command tar
  require_command sudo

  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64)
      piper_asset="piper_linux_aarch64.tar.gz"
      ;;
    *)
      warn "Automatic Piper install is only configured for 64-bit Raspberry Pi OS. Architecture is: $arch"
      exit 2
      ;;
  esac

  log "Installing Piper ${PIPER_VERSION} into ${PIPER_DIR}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/${piper_asset}" \
    -o "$tmp/piper.tar.gz"
  sudo mkdir -p "$PIPER_DIR"
  sudo tar -xzf "$tmp/piper.tar.gz" -C "$PIPER_DIR" --strip-components=1
  sudo ln -sf "$PIPER_DIR/piper" /usr/local/bin/piper

  log "Installing Piper voice ${PIPER_VOICE} into ${PIPER_VOICES_DIR}"
  mkdir -p "$PIPER_VOICES_DIR"
  curl -fsSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/${PIPER_VOICE}.onnx" \
    -o "$PIPER_VOICES_DIR/${PIPER_VOICE}.onnx"
  curl -fsSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/${PIPER_VOICE}.onnx.json" \
    -o "$PIPER_VOICES_DIR/${PIPER_VOICE}.onnx.json"

  log "Piper install complete"
}

install_piper
