#!/usr/bin/env bash
# package-firefox.sh
#
# Packages the firefox-extension/ directory into a distributable .xpi file.
# A .xpi is a standard ZIP archive — Firefox loads it via:
#   about:addons → Install Add-on From File…
#
# Usage (from any directory):
#   bash scripts/package-firefox.sh
#
# Output: tab-search-<version>.xpi in the repository root.
#
# Requirements: zip (available by default on Linux/macOS).

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO_ROOT/firefox-extension"
MANIFEST="$SRC/manifest.json"

# ---------------------------------------------------------------------------
# Read extension version from manifest.json
# ---------------------------------------------------------------------------
if command -v python3 &>/dev/null; then
    VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])")
else
    # Fallback: parse with grep + sed (no external JSON tool needed)
    VERSION=$(grep '"version"' "$MANIFEST" | head -1 \
        | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

if [[ -z "$VERSION" ]]; then
    echo "Error: could not read version from $MANIFEST" >&2
    exit 1
fi

OUTPUT="$REPO_ROOT/tab-search-${VERSION}.xpi"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo "Packaging firefox-extension/  →  $(basename "$OUTPUT")"

rm -f "$OUTPUT"

# Zip the *contents* of firefox-extension/ (not the directory itself), so that
# manifest.json sits at the root of the archive — as required by Firefox.
(
    cd "$SRC"
    zip -r "$OUTPUT" . \
        --exclude "*DS_Store" \
        --exclude "__MACOSX/*"
)

echo "Done: $OUTPUT"
