#!/usr/bin/env bash
set -Eeuo pipefail

PIPER_VERSION="${PIPER_VERSION:-latest}"
PIPER_DIR="${PIPER_DIR:-/opt/piper}"
PIPER_VOICES_DIR="${PIPER_VOICES_DIR:-$HOME/piper-voices}"
PIPER_ASSET="${PIPER_ASSET:-}"
PIPER_DOWNLOAD_URL="${PIPER_DOWNLOAD_URL:-}"
PIPER_TMP_DIR=""
PIPER_VOICES_BASE_URL="${PIPER_VOICES_BASE_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0}"

PIPER_VOICES=(
  "en_GB-alan-medium:en/en_GB/alan/medium"
  "en_GB-alba-medium:en/en_GB/alba/medium"
  "en_GB-jenny_dioco-medium:en/en_GB/jenny_dioco/medium"
)

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

  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64|x86_64) ;;
    *)
      warn "Automatic Piper install is only configured for 64-bit Linux. Architecture is: $arch"
      exit 2
      ;;
  esac

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
  sudo mkdir -p "$PIPER_DIR"
  sudo tar -xzf "$tmp/piper.tar.gz" -C "$PIPER_DIR" --strip-components=1
  sudo ln -sf "$PIPER_DIR/piper" /usr/local/bin/piper

  log "Installing Piper voices into ${PIPER_VOICES_DIR}"
  mkdir -p "$PIPER_VOICES_DIR"
  for voice_spec in "${PIPER_VOICES[@]}"; do
    install_voice "${voice_spec%%:*}" "${voice_spec#*:}"
  done

  log "Piper install complete"
}

install_piper
