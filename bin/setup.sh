#!/usr/bin/env bash
# bin/setup.sh — Check prerequisites and install Node.js dependencies
#
# Checks for required tools (SF CLI v2+, Node.js v18+, npm), reports their
# versions, runs `npm install`, and exits non-zero if anything is missing
# or npm install fails.
#
# Usage:
#   ./bin/setup.sh
#
# Exit codes:
#   0 — All checks pass and npm install succeeds
#   1 — One or more required tools are missing or npm install failed

set -euo pipefail

# Determine project root relative to this script (bin/ -> parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Track missing dependencies
missing_tools=()

# --- Tool check functions ---

check_sf_cli() {
  if ! command -v sf &>/dev/null; then
    missing_tools+=("sf (Salesforce CLI v2+)")
    return
  fi

  local version
  version=$(sf --version 2>/dev/null | head -1)
  # Extract major version number — sf outputs something like "@salesforce/cli/2.x.y ..."
  local major
  major=$(echo "$version" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 | cut -d. -f1)

  if [ -z "$major" ] || [ "$major" -lt 2 ]; then
    echo "  WARNING: SF CLI version may be below v2. Found: $version"
    echo "           Minimum required: v2.0"
    missing_tools+=("sf (Salesforce CLI v2+ — installed version too old)")
    return
  fi

  echo "  sf (Salesforce CLI): $version"
}

check_node() {
  if ! command -v node &>/dev/null; then
    missing_tools+=("node (Node.js v18+)")
    return
  fi

  local version
  version=$(node --version 2>/dev/null)
  # version looks like "v18.17.0" — extract major
  local major
  major=$(echo "$version" | sed 's/^v//' | cut -d. -f1)

  if [ -z "$major" ] || [ "$major" -lt 18 ]; then
    echo "  WARNING: Node.js version is below v18. Found: $version"
    echo "           Minimum required: v18.0.0"
    missing_tools+=("node (Node.js v18+ — installed version too old)")
    return
  fi

  echo "  node (Node.js): $version"
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    missing_tools+=("npm")
    return
  fi

  local version
  version=$(npm --version 2>/dev/null)
  echo "  npm: v$version"
}

# --- Main ---

echo "=== Email Handler Testing Framework — Setup ==="
echo ""
echo "Checking required tools..."
echo ""

check_sf_cli
check_node
check_npm

echo ""

# Report results
if [ ${#missing_tools[@]} -gt 0 ]; then
  echo "ERROR: Prerequisites - Missing required dependencies"
  echo "  Details: The following tools are required but were not found:"
  for tool in "${missing_tools[@]}"; do
    echo "    - $tool"
  done
  echo "  Action: Install the missing tools and re-run this script"
  echo ""
  echo "  Install links:"
  echo "    SF CLI:   https://developer.salesforce.com/tools/salesforcecli"
  echo "    Node.js:  https://nodejs.org/ (v18 LTS or later)"
  echo "    npm:      Included with Node.js"
  exit 1
fi

echo "All required tools found."
echo ""

# Run npm install
echo "Installing Node.js dependencies..."
echo ""

if ! (cd "$PROJECT_ROOT" && npm install); then
  echo ""
  echo "ERROR: Setup - npm install failed"
  echo "  Details: npm install exited with a non-zero status code"
  echo "  Action: Check the output above for errors, fix any issues, and re-run this script"
  exit 1
fi

echo ""
echo "Setup complete. All dependencies installed successfully."
exit 0
