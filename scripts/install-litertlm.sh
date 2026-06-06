#!/usr/bin/env bash
#
# Downloads and verifies the LiteRT-LM C xcframework into ios/Vendor/.
# Invoked from ExpoAiKit.podspec's prepare_command.
#
# Idempotent: skips download if the xcframework is already present and
# its Info.plist version string matches the expected tag.

set -euo pipefail

LITERTLM_VERSION="v0.12.0"
LITERTLM_SHA256="3c2a11ecc8511d1e74efa7ca308dc7130c95223325c33212337ffb0563b79cde"
LITERTLM_URL="https://github.com/google-ai-edge/LiteRT-LM/releases/download/${LITERTLM_VERSION}/CLiteRTLM.xcframework.zip"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENDOR_DIR="${REPO_ROOT}/ios/Vendor"
XCFRAMEWORK_PATH="${VENDOR_DIR}/CLiteRTLM.xcframework"
VERSION_STAMP="${VENDOR_DIR}/.litertlm-version"

mkdir -p "${VENDOR_DIR}"

if [[ -d "${XCFRAMEWORK_PATH}" ]] && [[ -f "${VERSION_STAMP}" ]] && [[ "$(cat "${VERSION_STAMP}")" == "${LITERTLM_VERSION}" ]]; then
  echo "[ExpoAiKit] CLiteRTLM.xcframework ${LITERTLM_VERSION} already installed."
  exit 0
fi

echo "[ExpoAiKit] Downloading CLiteRTLM.xcframework ${LITERTLM_VERSION} (~122MB)..."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

ZIP_PATH="${TMP_DIR}/CLiteRTLM.xcframework.zip"

if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar -o "${ZIP_PATH}" "${LITERTLM_URL}"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "${ZIP_PATH}" "${LITERTLM_URL}"
else
  echo "[ExpoAiKit] ERROR: neither curl nor wget is installed." >&2
  exit 1
fi

echo "[ExpoAiKit] Verifying SHA256..."
ACTUAL_SHA="$(shasum -a 256 "${ZIP_PATH}" | awk '{print $1}')"
if [[ "${ACTUAL_SHA}" != "${LITERTLM_SHA256}" ]]; then
  echo "[ExpoAiKit] ERROR: SHA256 mismatch." >&2
  echo "  expected: ${LITERTLM_SHA256}" >&2
  echo "  actual:   ${ACTUAL_SHA}" >&2
  exit 1
fi

echo "[ExpoAiKit] Unpacking..."
rm -rf "${XCFRAMEWORK_PATH}"
unzip -q "${ZIP_PATH}" -d "${VENDOR_DIR}"

if [[ ! -d "${XCFRAMEWORK_PATH}" ]]; then
  echo "[ExpoAiKit] ERROR: ${XCFRAMEWORK_PATH} not found after unzip." >&2
  exit 1
fi

echo "${LITERTLM_VERSION}" > "${VERSION_STAMP}"
echo "[ExpoAiKit] Installed CLiteRTLM.xcframework ${LITERTLM_VERSION}."
