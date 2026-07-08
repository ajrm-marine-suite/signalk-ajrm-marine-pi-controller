#!/usr/bin/env bash
set -Eeuo pipefail

PIPER_VERSION="${PIPER_VERSION:-latest}"
PIPER_DIR="${PIPER_DIR:-/opt/piper}"
PIPER_VOICES_DIR="${PIPER_VOICES_DIR:-$HOME/piper-voices}"
PIPER_ASSET="${PIPER_ASSET:-}"
PIPER_DOWNLOAD_URL="${PIPER_DOWNLOAD_URL:-}"
PIPER_TMP_DIR=""
PIPER_VOICES_BASE_URL="${PIPER_VOICES_BASE_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0}"
INSTALL_FFMPEG="${INSTALL_FFMPEG:-1}"

PIPER_VOICES=(
  "en_GB-alba-medium:en/en_GB/alba/medium"
  "en_GB-alan-medium:en/en_GB/alan/medium"
  "en_GB-jenny_dioco-medium:en/en_GB/jenny_dioco/medium"
)

log() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'WARNING: %s\n' "$*" >&2
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit "${2:-1}"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command not found: $1"
  fi
}

require_noninteractive_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    return
  fi
  require_command sudo
  if sudo -n true >/dev/null 2>&1; then
    return
  fi
  fail "Pi Controller cannot install Piper from the web UI because sudo needs a password. The Signal K service cannot answer password prompts. Configure passwordless sudo for the documented installer commands, or run sudo -v in an SSH terminal before running the installer manually." 5
}

install_ffmpeg() {
  if [[ "$INSTALL_FFMPEG" == "0" || "$INSTALL_FFMPEG" == "false" ]]; then
    log "Skipping FFmpeg install because INSTALL_FFMPEG=${INSTALL_FFMPEG}"
    return
  fi
  if command -v ffmpeg >/dev/null 2>&1; then
    log "FFmpeg is already installed: $(command -v ffmpeg)"
    return
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    warn "FFmpeg is missing and apt-get is not available. Install FFmpeg manually, or set INSTALL_FFMPEG=0 to skip this check."
    exit 4
  fi
  log "Installing FFmpeg with apt-get"
  sudo -n apt-get update
  sudo -n apt-get install -y ffmpeg
}

install_voice() {
  local voice_id voice_path voice_dir model_path metadata_path
  voice_id="$1"
  voice_path="$2"
  voice_dir="$PIPER_VOICES_DIR/$voice_id"
  model_path="$voice_dir/$voice_id.onnx"
  metadata_path="$model_path.json"

  mkdir -p "$voice_dir"

  if [[ -f "$PIPER_VOICES_DIR/$voice_id.onnx" && ! -f "$model_path" ]]; then
    mv "$PIPER_VOICES_DIR/$voice_id.onnx" "$model_path"
  fi
  if [[ -f "$PIPER_VOICES_DIR/$voice_id.onnx.json" && ! -f "$metadata_path" ]]; then
    mv "$PIPER_VOICES_DIR/$voice_id.onnx.json" "$metadata_path"
  fi

  if [[ ! -f "$model_path" ]]; then
    curl -fsSL "$PIPER_VOICES_BASE_URL/$voice_path/$voice_id.onnx?download=true" \
      -o "$model_path"
  fi
  if [[ ! -f "$metadata_path" ]]; then
    curl -fsSL "$PIPER_VOICES_BASE_URL/$voice_path/$voice_id.onnx.json?download=true" \
      -o "$metadata_path"
  fi
}

release_api_url() {
  if [[ "$PIPER_VERSION" == "latest" || -z "$PIPER_VERSION" ]]; then
    printf '%s\n' "https://api.github.com/repos/rhasspy/piper/releases/latest"
  else
    printf '%s\n' "https://api.github.com/repos/rhasspy/piper/releases/tags/${PIPER_VERSION}"
  fi
}

resolve_piper_download_url() {
  local arch release_json
  arch="$1"
  release_json="$2"

  if [[ -n "$PIPER_DOWNLOAD_URL" ]]; then
    printf '%s\n' "$PIPER_DOWNLOAD_URL"
    return
  fi

  PIPER_ASSET="$PIPER_ASSET" node - "$arch" "$release_json" <<'NODE'
const fs = require("fs");
const arch = process.argv[2];
const release = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const assets = Array.isArray(release.assets) ? release.assets : [];
const preferred = process.env.PIPER_ASSET || "";
const exactNames = preferred
  ? [preferred]
  : arch === "x86_64"
    ? ["piper_linux_x86_64.tar.gz"]
    : ["piper_linux_aarch64.tar.gz", "piper_arm64.tar.gz"];
const patterns = arch === "x86_64"
  ? [/piper.*linux.*x86_64.*\.tar\.gz$/i]
  : [/piper.*linux.*(aarch64|arm64).*\.tar\.gz$/i];

let asset = null;
for (const name of exactNames) {
  asset = assets.find((candidate) => candidate.name === name);
  if (asset) break;
}
if (!asset) {
  asset = assets.find((candidate) => patterns.some((pattern) => pattern.test(candidate.name || "")));
}
if (!asset || !asset.browser_download_url) {
  console.error(
    `No Piper Linux archive found for ${arch}. Release assets: ${assets.map((candidate) => candidate.name).join(", ")}`,
  );
  process.exit(3);
}
console.log(asset.browser_download_url);
NODE
}

install_piper() {
  local arch download_url release_json release_name tmp

  require_command curl
  require_command node
  require_command tar
  require_command sudo
  require_noninteractive_sudo

  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64|x86_64) ;;
    *)
      warn "Automatic Piper install is only configured for 64-bit Linux. Architecture is: $arch"
      exit 2
      ;;
  esac

  install_ffmpeg

  log "Finding Piper ${PIPER_VERSION} release for ${arch}"
  tmp="$(mktemp -d)"
  PIPER_TMP_DIR="$tmp"
  trap 'if [[ -n "${PIPER_TMP_DIR:-}" ]]; then rm -rf "$PIPER_TMP_DIR"; fi' EXIT
  release_json="$tmp/piper-release.json"
  curl -fsSL "$(release_api_url)" -o "$release_json"
  release_name="$(node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(r.tag_name || r.name || "unknown")' "$release_json")"
  download_url="$(resolve_piper_download_url "$arch" "$release_json")"

  log "Installing Piper ${release_name} into ${PIPER_DIR}"
  curl -fsSL "$download_url" -o "$tmp/piper.tar.gz"
  sudo -n mkdir -p "$PIPER_DIR"
  sudo -n tar -xzf "$tmp/piper.tar.gz" -C "$PIPER_DIR" --strip-components=1
  sudo -n ln -sf "$PIPER_DIR/piper" /usr/local/bin/piper

  log "Installing Piper voices into ${PIPER_VOICES_DIR}"
  mkdir -p "$PIPER_VOICES_DIR"
  for voice_spec in "${PIPER_VOICES[@]}"; do
    install_voice "${voice_spec%%:*}" "${voice_spec#*:}"
  done

  log "Piper install complete"
}

install_piper
