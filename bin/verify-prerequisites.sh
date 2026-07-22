#!/usr/bin/env bash
# bin/verify-prerequisites.sh — Verify all prerequisites before running tests
#
# Usage:
#   ./bin/verify-prerequisites.sh --env DEV
#   TEST_ENV=DEV ./bin/verify-prerequisites.sh
#
# Checks:
#   1. Node.js installed and version >= 18
#   2. SF CLI installed
#   3. SF CLI authenticated to target org
#   4. Configuration files exist and are valid
#   5. Credentials file exists and has required sections
#
# Exit codes:
#   0 — All prerequisites pass
#   1 — One or more prerequisites failed

set -uo pipefail

# Determine script location and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source configuration helpers
source "$PROJECT_ROOT/lib/config.sh"

# --- Argument parsing ---
ENV_NAME="${TEST_ENV:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 --env <DEV|QA|UAT>"
      echo ""
      echo "Options:"
      echo "  --env    Target environment (DEV, QA, UAT). Can also set TEST_ENV env var."
      echo "  --help   Show this help message"
      exit 0
      ;;
    *)
      echo "ERROR: Arguments - Unknown argument '$1'" >&2
      echo "  Details: Valid arguments are --env <environment>" >&2
      echo "  Action: Use --env DEV, --env QA, or --env UAT" >&2
      exit 1
      ;;
  esac
done

if [ -z "$ENV_NAME" ]; then
  echo "ERROR: Arguments - No environment specified" >&2
  echo "  Details: An environment name is required via --env or TEST_ENV variable" >&2
  echo "  Action: Use --env DEV, --env QA, or --env UAT (or set TEST_ENV=DEV)" >&2
  exit 1
fi

# --- Tracking ---
PREREQ_FAILED=0

pass() {
  echo "  [PASS] $1"
}

fail() {
  PREREQ_FAILED=1
  echo ""
  echo "ERROR: $1"
  echo "  Details: $2"
  echo "  Action: $3"
  echo ""
}

# --- Header ---
echo "============================================"
echo " Prerequisite Check — Environment: $ENV_NAME"
echo "============================================"
echo ""

# --- 1. Check Node.js ---
echo "Checking Node.js..."
if ! command -v node &>/dev/null; then
  fail "Prerequisites - Node.js not found" \
    "Node.js is not installed or not on the system PATH" \
    "Install Node.js 18+ from https://nodejs.org/"
else
  NODE_VERSION_FULL=$(node --version)
  # Strip leading 'v' and extract major version
  NODE_MAJOR=$(echo "$NODE_VERSION_FULL" | sed 's/^v//' | cut -d. -f1)

  if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    fail "Prerequisites - Node.js version too old" \
      "Found Node.js $NODE_VERSION_FULL but version 18+ is required" \
      "Upgrade Node.js to version 18 or later from https://nodejs.org/"
  else
    pass "Node.js $NODE_VERSION_FULL"
  fi
fi

# --- 2. Check SF CLI ---
echo "Checking SF CLI..."
if ! command -v sf &>/dev/null; then
  fail "Prerequisites - SF CLI not found" \
    "The Salesforce CLI (sf) is not installed or not on the system PATH" \
    "Install SF CLI from https://developer.salesforce.com/tools/salesforcecli"
else
  SF_VERSION=$(sf --version 2>/dev/null | head -1)
  pass "SF CLI: $SF_VERSION"
fi

# --- 3. Check configuration files exist and are valid ---
echo "Checking configuration..."

CONFIG_FILE="$PROJECT_ROOT/env-config.json"
CREDENTIALS_FILE="$PROJECT_ROOT/credentials.json"

if [ ! -f "$CONFIG_FILE" ]; then
  fail "Configuration - env-config.json not found" \
    "Expected configuration file at: $CONFIG_FILE" \
    "Create env-config.json from env-config.template.json in the project root"
else
  pass "env-config.json exists"
fi

if [ ! -f "$CREDENTIALS_FILE" ]; then
  fail "Configuration - credentials.json not found" \
    "Expected credentials file at: $CREDENTIALS_FILE" \
    "Create credentials.json from credentials.template.json in the project root"
else
  pass "credentials.json exists"
fi

# --- 4. Validate config files via config-loader ---
echo "Validating configuration..."

if [ -f "$CONFIG_FILE" ] && [ -f "$CREDENTIALS_FILE" ] && command -v node &>/dev/null; then
  CONFIG_OUTPUT=$(node "$PROJECT_ROOT/src/config-loader.js" \
    --env "$ENV_NAME" \
    --config "$CONFIG_FILE" \
    --credentials "$CREDENTIALS_FILE" 2>&1)
  CONFIG_EXIT=$?

  if [ $CONFIG_EXIT -ne 0 ]; then
    fail "Configuration - Validation failed for environment '$ENV_NAME'" \
      "$CONFIG_OUTPUT" \
      "Check that env-config.json and credentials.json are valid and contain the '$ENV_NAME' environment"
  else
    # Extract orgAlias from the validated config
    ORG_ALIAS=$(_json_get_value "$CONFIG_OUTPUT" "orgAlias")
    pass "Configuration valid for environment '$ENV_NAME' (org: $ORG_ALIAS)"
  fi
else
  if ! command -v node &>/dev/null; then
    echo "  [SKIP] Cannot validate config — Node.js not available"
  else
    echo "  [SKIP] Cannot validate config — required files missing"
  fi
fi

# --- 5. Check SF CLI authentication ---
echo "Checking SF CLI authentication..."

if command -v sf &>/dev/null && [ -n "${ORG_ALIAS:-}" ]; then
  AUTH_OUTPUT=$(sf org display --target-org "$ORG_ALIAS" 2>&1)
  AUTH_EXIT=$?

  if [ $AUTH_EXIT -ne 0 ]; then
    fail "Authentication - SF CLI not authenticated to org '$ORG_ALIAS'" \
      "sf org display --target-org $ORG_ALIAS failed: $(echo "$AUTH_OUTPUT" | head -3)" \
      "Authenticate with: sf org login web --alias $ORG_ALIAS --instance-url <your-sandbox-url>"
  else
    pass "SF CLI authenticated to org '$ORG_ALIAS'"
  fi
elif ! command -v sf &>/dev/null; then
  echo "  [SKIP] Cannot check auth — SF CLI not available"
elif [ -z "${ORG_ALIAS:-}" ]; then
  echo "  [SKIP] Cannot check auth — org alias not resolved from config"
fi

# --- 6. Check credentials has required sections ---
echo "Checking credentials structure..."

if [ -f "$CREDENTIALS_FILE" ] && command -v node &>/dev/null; then
  # Use a simple Node.js one-liner to check for manipulatedSmtp section
  CRED_CHECK=$(node -e "
    const fs = require('fs');
    try {
      const creds = JSON.parse(fs.readFileSync('$CREDENTIALS_FILE', 'utf8'));
      const issues = [];
      if (!creds.manipulatedSmtp) issues.push('missing manipulatedSmtp section');
      else {
        if (!creds.manipulatedSmtp.host) issues.push('missing manipulatedSmtp.host');
        if (!creds.manipulatedSmtp.port) issues.push('missing manipulatedSmtp.port');
        if (!creds.manipulatedSmtp.auth) issues.push('missing manipulatedSmtp.auth');
        else {
          if (!creds.manipulatedSmtp.auth.username) issues.push('missing manipulatedSmtp.auth.username');
          if (!creds.manipulatedSmtp.auth.password) issues.push('missing manipulatedSmtp.auth.password');
        }
      }
      if (issues.length > 0) {
        console.error(issues.join('; '));
        process.exit(1);
      }
      console.log('OK');
    } catch(e) {
      console.error('Failed to parse: ' + e.message);
      process.exit(1);
    }
  " 2>&1)
  CRED_CHECK_EXIT=$?

  if [ $CRED_CHECK_EXIT -ne 0 ]; then
    fail "Credentials - Missing required sections" \
      "$CRED_CHECK" \
      "Update credentials.json to include all required fields (see credentials.template.json)"
  else
    pass "Credentials structure valid (manipulatedSmtp section present)"
  fi
elif [ ! -f "$CREDENTIALS_FILE" ]; then
  echo "  [SKIP] Cannot check credentials — file missing"
else
  echo "  [SKIP] Cannot check credentials — Node.js not available"
fi

# --- Summary ---
echo ""
echo "============================================"
if [ $PREREQ_FAILED -eq 0 ]; then
  echo " All prerequisites PASSED"
  echo "============================================"
  exit 0
else
  echo " One or more prerequisites FAILED"
  echo "============================================"
  echo ""
  echo "Fix the issues above and re-run this script."
  exit 1
fi
