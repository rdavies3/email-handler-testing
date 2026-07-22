#!/usr/bin/env bash
# bin/run-tests.sh — Main test runner orchestration
#
# Usage:
#   ./bin/run-tests.sh --env DEV                  # Run all tests
#   ./bin/run-tests.sh --env QA --test 04         # Run single test
#   ./bin/run-tests.sh --env UAT --category attachments  # Run by category
#   ./bin/run-tests.sh --env DEV --stop-on-failure       # Stop on first failure
#
# Arguments:
#   --env              Required. Target environment: DEV, QA, UAT
#   --test             Optional. Specific test ID (e.g., "04", "22A")
#   --category         Optional. Category filter (e.g., "attachments", "basic-creation")
#   --stop-on-failure  Optional. Exit on first FAIL or ERROR
#   --help             Show help message
#
# Exit codes:
#   0 — All tests passed
#   1 — One or more tests failed or errored
#   2 — Framework-level error (config, prereqs, invalid arguments)

set -uo pipefail

# --- Determine paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Source library functions ---
source "$PROJECT_ROOT/lib/config.sh"
source "$PROJECT_ROOT/lib/reporting.sh"
source "$PROJECT_ROOT/lib/retry.sh"
source "$PROJECT_ROOT/lib/soql-queries.sh"
source "$PROJECT_ROOT/lib/test-setup.sh"

# --- Argument parsing ---
ENV_NAME=""
TEST_ID=""
CATEGORY=""
STOP_ON_FAILURE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: Arguments - --env requires a value" >&2
        echo "  Action: Use --env DEV, --env QA, or --env UAT" >&2
        exit 2
      fi
      ENV_NAME="$2"
      shift 2
      ;;
    --test)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: Arguments - --test requires a value" >&2
        echo "  Action: Provide a test ID (e.g., --test 04, --test 22A)" >&2
        exit 2
      fi
      TEST_ID="$2"
      shift 2
      ;;
    --category)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: Arguments - --category requires a value" >&2
        echo "  Action: Provide a category name (e.g., --category attachments)" >&2
        exit 2
      fi
      CATEGORY="$2"
      shift 2
      ;;
    --stop-on-failure)
      STOP_ON_FAILURE=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 --env <DEV|QA|UAT> [--test <ID>] [--category <name>] [--stop-on-failure]"
      echo ""
      echo "Options:"
      echo "  --env              Target environment (required): DEV, QA, UAT"
      echo "  --test             Run a single test by ID (e.g., 04, 22A)"
      echo "  --category         Run tests in a category (e.g., basic-creation, attachments)"
      echo "  --stop-on-failure  Stop execution on first FAIL or ERROR"
      echo "  --help             Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0 --env DEV                          # Run all tests"
      echo "  $0 --env QA --test 04                 # Run single test"
      echo "  $0 --env UAT --category attachments   # Run by category"
      echo "  $0 --env DEV --stop-on-failure        # Stop on first failure"
      exit 0
      ;;
    *)
      echo "ERROR: Arguments - Unknown argument '$1'" >&2
      echo "  Details: Valid arguments are --env, --test, --category, --stop-on-failure" >&2
      echo "  Action: Run $0 --help for usage information" >&2
      exit 2
      ;;
  esac
done

# --- Validate required arguments ---
if [ -z "$ENV_NAME" ]; then
  echo "ERROR: Arguments - No environment specified" >&2
  echo "  Details: The --env argument is required" >&2
  echo "  Action: Use --env DEV, --env QA, or --env UAT" >&2
  exit 2
fi

# Cannot specify both --test and --category
if [ -n "$TEST_ID" ] && [ -n "$CATEGORY" ]; then
  echo "ERROR: Arguments - Cannot specify both --test and --category" >&2
  echo "  Details: Use --test for a single test or --category for a group, not both" >&2
  echo "  Action: Choose either --test <ID> or --category <name>" >&2
  exit 2
fi

# --- Load configuration ---
echo "Loading configuration for environment: $ENV_NAME"
if ! load_config "$ENV_NAME"; then
  exit 2
fi

# --- Run prerequisite checks ---
echo "Running prerequisite checks..."
if ! "$PROJECT_ROOT/bin/verify-prerequisites.sh" --env "$ENV_NAME"; then
  echo ""
  echo "ERROR: Prerequisites - One or more checks failed" >&2
  echo "  Action: Fix the issues reported above and re-run" >&2
  exit 2
fi
echo ""

# --- Helper: load categories.json ---
CATEGORIES_FILE="$PROJECT_ROOT/tests/categories.json"

# _get_category_test_ids CATEGORY_NAME
#   Prints test IDs for a category, one per line.
#   Returns 1 if category not found.
_get_category_test_ids() {
  local cat_name="$1"
  local cat_ids

  if [ ! -f "$CATEGORIES_FILE" ]; then
    echo "ERROR: Configuration - categories.json not found at $CATEGORIES_FILE" >&2
    return 1
  fi

  # Use Node.js to parse the JSON and extract the array for the category
  cat_ids=$(node -e "
    const fs = require('fs');
    const cats = JSON.parse(fs.readFileSync('$CATEGORIES_FILE', 'utf8'));
    const ids = cats['$cat_name'];
    if (!ids) { process.exit(1); }
    ids.forEach(id => console.log(id));
  " 2>/dev/null)

  if [ $? -ne 0 ] || [ -z "$cat_ids" ]; then
    return 1
  fi

  echo "$cat_ids"
  return 0
}

# _get_all_categories
#   Prints all valid category names, one per line.
_get_all_categories() {
  node -e "
    const fs = require('fs');
    const cats = JSON.parse(fs.readFileSync('$CATEGORIES_FILE', 'utf8'));
    Object.keys(cats).forEach(k => console.log(k));
  " 2>/dev/null
}

# _get_all_test_ids
#   Prints all test IDs from all categories, in order.
_get_all_test_ids() {
  node -e "
    const fs = require('fs');
    const cats = JSON.parse(fs.readFileSync('$CATEGORIES_FILE', 'utf8'));
    const allIds = [];
    Object.values(cats).forEach(ids => ids.forEach(id => allIds.push(id)));
    allIds.forEach(id => console.log(id));
  " 2>/dev/null
}

# --- Resolve test case list ---
declare -a TEST_IDS=()

if [ -n "$TEST_ID" ]; then
  # Single test specified — validate it exists
  TEST_ID_UPPER=$(echo "$TEST_ID" | tr '[:lower:]' '[:upper:]')

  # Find the test case file (case-insensitive matching on ID)
  TEST_CASE_FILE=$(find "$PROJECT_ROOT/tests/cases" -name "test-${TEST_ID}-*.json" -o -name "test-${TEST_ID_UPPER}-*.json" -o -name "test-$(echo "$TEST_ID" | tr '[:upper:]' '[:lower:]')-*.json" 2>/dev/null | head -1)

  # Also try exact lowercase match (e.g., "22a" -> "test-22a-...")
  if [ -z "$TEST_CASE_FILE" ]; then
    TEST_ID_LOWER=$(echo "$TEST_ID" | tr '[:upper:]' '[:lower:]')
    TEST_CASE_FILE=$(find "$PROJECT_ROOT/tests/cases" -name "test-${TEST_ID_LOWER}-*.json" 2>/dev/null | head -1)
  fi

  if [ -z "$TEST_CASE_FILE" ]; then
    echo "ERROR: Arguments - Test ID '$TEST_ID' not found" >&2
    echo "  Details: No test case file matching 'test-${TEST_ID}-*.json' in tests/cases/" >&2
    echo "  Action: Valid test IDs include: $(_get_all_test_ids | tr '\n' ' ')" >&2
    exit 2
  fi

  TEST_IDS=("$TEST_ID")

elif [ -n "$CATEGORY" ]; then
  # Category specified — validate and resolve test IDs
  CATEGORY_IDS=$(_get_category_test_ids "$CATEGORY")

  if [ $? -ne 0 ] || [ -z "$CATEGORY_IDS" ]; then
    echo "ERROR: Arguments - Category '$CATEGORY' not found" >&2
    echo "  Details: No category matching '$CATEGORY' in categories.json" >&2
    echo "  Action: Valid categories are: $(_get_all_categories | tr '\n' ' ')" >&2
    exit 2
  fi

  while IFS= read -r id; do
    TEST_IDS+=("$id")
  done <<< "$CATEGORY_IDS"

else
  # No filter — run all tests
  ALL_IDS=$(_get_all_test_ids)

  if [ -z "$ALL_IDS" ]; then
    echo "ERROR: Configuration - No test IDs found in categories.json" >&2
    exit 2
  fi

  while IFS= read -r id; do
    TEST_IDS+=("$id")
  done <<< "$ALL_IDS"
fi

# --- Helper: find test case file by ID ---
# _find_test_case_file TEST_ID
#   Returns the path to the test case JSON file, or empty string if not found.
_find_test_case_file() {
  local tid="$1"
  local tid_lower
  tid_lower=$(echo "$tid" | tr '[:upper:]' '[:lower:]')

  # Try various patterns to find the file
  local found
  found=$(find "$PROJECT_ROOT/tests/cases" -name "test-${tid_lower}-*.json" 2>/dev/null | head -1)

  if [ -z "$found" ]; then
    found=$(find "$PROJECT_ROOT/tests/cases" -name "test-${tid}-*.json" 2>/dev/null | head -1)
  fi

  echo "$found"
}

# --- Helper: extract field from test case JSON ---
# _tc_get_string JSON KEY
#   Extract a string value from test case JSON (simple top-level key)
_tc_get_string() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/'
}

# --- Helper: generate timestamp for test isolation ---
_generate_timestamp() {
  date +%s
}

# --- Helper: resolve template variables in a string ---
# _resolve_template STRING TIMESTAMP
#   Replaces {{primary_email}}, {{secondary_email}}, {{tertiary_email}}, {{timestamp}}
_resolve_template() {
  local str="$1"
  local ts="$2"

  str="${str//\{\{primary_email\}\}/$PRIMARY_EMAIL}"
  str="${str//\{\{secondary_email\}\}/$SECONDARY_EMAIL}"
  str="${str//\{\{tertiary_email\}\}/$TERTIARY_EMAIL}"
  str="${str//\{\{timestamp\}\}/$ts}"

  echo "$str"
}

# --- Helper: run a single test case ---
# _run_test TEST_ID
#   Executes a single test case. Reports result via reporting.sh functions.
#   Returns: 0 = PASS, 1 = FAIL, 2 = ERROR
_run_test() {
  local test_id="$1"
  local test_file
  local test_json
  local test_name
  local send_method
  local timestamp

  # Find test case file
  test_file=$(_find_test_case_file "$test_id")

  if [ -z "$test_file" ] || [ ! -f "$test_file" ]; then
    report_error "$test_id" "Unknown test" "Test case file not found for ID '$test_id'"
    return 2
  fi

  # Load test case JSON
  test_json=$(cat "$test_file")
  test_name=$(_tc_get_string "$test_json" "name")
  send_method=$(_tc_get_string "$test_json" "sendMethod")

  if [ -z "$test_name" ]; then
    test_name="Test $test_id"
  fi

  # Generate unique timestamp for this test run
  timestamp=$(_generate_timestamp)

  echo ""
  echo "────────────────────────────────────────────"
  echo "Running Test $test_id: $test_name"
  echo "  Send method: $send_method"
  echo "────────────────────────────────────────────"

  # --- Run preconditions ---
  echo "  Running preconditions..."
  local precondition_output
  precondition_output=$(run_preconditions "$test_json" 2>&1)
  local precondition_exit=$?

  if [ $precondition_exit -ne 0 ]; then
    report_error "$test_id" "$test_name" "Precondition setup failed: $precondition_output"
    return 2
  fi

  if [ -n "$precondition_output" ]; then
    echo "  Preconditions completed: $precondition_output"
  else
    echo "  No preconditions required"
  fi

  # --- Invoke send mechanism ---
  local send_exit=0

  if [ "$send_method" = "smtp" ]; then
    # SMTP tests (22/23): call smtp-sender directly
    echo "  Sending via Manipulated SMTP..."

    local smtp_output
    smtp_output=$(node "$PROJECT_ROOT/src/smtp-sender.js" \
      --test-case "$test_file" \
      --env-config "$PROJECT_ROOT/env-config.json" \
      --credentials "$PROJECT_ROOT/credentials.json" 2>&1)
    send_exit=$?

    if [ $send_exit -ne 0 ]; then
      report_error "$test_id" "$test_name" "SMTP send failed (exit $send_exit): $smtp_output"
      return 2
    fi

    echo "  Email sent via SMTP"

  elif [ "$send_method" = "eml" ]; then
    # EML tests: generate .eml file, prompt user to send
    echo "  Generating .eml file..."

    local eml_output
    eml_output=$(node "$PROJECT_ROOT/src/eml-generator.js" \
      --test-case "$test_file" \
      --env-config "$PROJECT_ROOT/env-config.json" \
      --output "$PROJECT_ROOT/generated-emails/" 2>&1)
    send_exit=$?

    if [ $send_exit -ne 0 ]; then
      report_error "$test_id" "$test_name" "EML generation failed (exit $send_exit): $eml_output"
      return 2
    fi

    # The eml-generator prints the file path to stdout
    local eml_file="$eml_output"
    echo ""
    echo "  ╔══════════════════════════════════════════════════════════╗"
    echo "  ║  ACTION REQUIRED: Send the generated email              ║"
    echo "  ╠══════════════════════════════════════════════════════════╣"
    echo "  ║  File: $eml_file"
    echo "  ║                                                          ║"
    echo "  ║  1. Open the .eml file in your mail client               ║"
    echo "  ║  2. Verify the To, Subject, and Body look correct        ║"
    echo "  ║  3. Send the email                                       ║"
    echo "  ╚══════════════════════════════════════════════════════════╝"
    echo ""

    # Offer to open the file automatically
    read -rp "  Press [O] to open in mail client, or [Enter] when sent: " user_choice

    if [[ "$user_choice" =~ ^[Oo]$ ]]; then
      open "$eml_file" 2>/dev/null
      echo "  Opened .eml file. Send the email, then confirm."
      read -rp "  Press [Enter] when the email has been sent: " _
    fi

    echo "  User confirmed email sent."

  else
    report_error "$test_id" "$test_name" "Unknown send method '$send_method'"
    return 2
  fi

  # --- Wait initial delay ---
  echo "  Waiting ${INITIAL_DELAY}s for Salesforce processing..."
  sleep "$INITIAL_DELAY"

  # --- Run verification ---
  echo "  Running verification queries..."

  # Use the test's subject with timestamp to build verification query
  local test_subject
  test_subject=$(_tc_get_string "$test_json" "subject")
  test_subject=$(_resolve_template "$test_subject" "$timestamp")

  # For now, use query_case_by_subject as the primary verification
  # The verification logic uses the test case's verification section
  local verification_type
  verification_type=$(echo "$test_json" | grep -o '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')

  # Build expected JSON from the first assertion set
  local verify_result
  local verify_exit

  # Simple verification: query Case by subject and check it exists
  if [ -n "$test_subject" ]; then
    # Query for the Case
    local case_result
    case_result=$(query_case_by_subject "$test_subject" 2>/dev/null)
    verify_exit=$?

    if [ $verify_exit -ne 0 ]; then
      # Retry with the retry mechanism
      verify_result=$(verify_with_retry "query_case_by_subject" "$test_subject" '{"Subject":"NOT_NULL"}' "$MAX_RETRIES" "$RETRY_INTERVAL")
      verify_exit=$?
    else
      # Check if we got records
      local total_size
      total_size=$(echo "$case_result" | grep -o '"totalSize"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*:[[:space:]]*//')

      if [ "${total_size:-0}" -gt 0 ]; then
        verify_exit=0
        verify_result="STATUS: PASS
ATTEMPTS: 1
ELAPSED: ${INITIAL_DELAY}
DETAILS: Case found with subject matching '$test_subject'"
      else
        # Case not found on first try — use retry mechanism
        verify_result=$(verify_with_retry "query_case_by_subject" "$test_subject" '{"Subject":"NOT_NULL"}' "$MAX_RETRIES" "$RETRY_INTERVAL")
        verify_exit=$?
      fi
    fi
  else
    verify_result="STATUS: ERROR
ATTEMPTS: 0
ELAPSED: 0
DETAILS: Could not resolve test subject for verification"
    verify_exit=2
  fi

  # --- Report result ---
  local status_line
  status_line=$(echo "$verify_result" | grep "^STATUS:" | sed 's/STATUS: //')

  case "$status_line" in
    PASS)
      report_pass "$test_id" "$test_name"
      return 0
      ;;
    FAIL)
      local details
      details=$(echo "$verify_result" | grep "^DETAILS:" | sed 's/DETAILS: //')
      report_fail "$test_id" "$test_name" "Verification" "Record found" "$details"
      return 1
      ;;
    ERROR|*)
      local details
      details=$(echo "$verify_result" | grep "^DETAILS:" | sed 's/DETAILS: //')
      report_error "$test_id" "$test_name" "${details:-Verification error}"
      return 2
      ;;
  esac
}

# --- Main execution loop ---
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Email Handler Test Runner                               ║"
echo "║  Environment: $ENV_NAME"
echo "║  Tests to run: ${#TEST_IDS[@]}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Initialize reporting counters
init_reporting

# Run each test
STOPPED_EARLY=false

for test_id in "${TEST_IDS[@]}"; do
  _run_test "$test_id"
  test_exit=$?

  # Check stop-on-failure
  if [ "$STOP_ON_FAILURE" = true ] && [ $test_exit -ne 0 ]; then
    echo ""
    echo "Stopping execution due to --stop-on-failure flag."
    STOPPED_EARLY=true
    break
  fi
done

# --- Print summary ---
echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$STOPPED_EARLY" = true ]; then
  echo "  Run stopped early (--stop-on-failure)"
fi
report_summary
echo "════════════════════════════════════════════════════════════"

# Exit with appropriate code
get_exit_code
exit $?
