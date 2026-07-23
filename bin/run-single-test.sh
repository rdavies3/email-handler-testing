#!/usr/bin/env bash
# bin/run-single-test.sh — Execute a single test case by ID
#
# Usage:
#   ./bin/run-single-test.sh TEST_ID [--env ENV_NAME]
#
# Arguments:
#   TEST_ID       Required. Test case identifier (e.g., "04", "22A")
#   --env ENV     Target environment: DEV, QA, UAT. If not provided, uses
#                 TEST_ENV from the parent environment.
#
# Exit codes:
#   0 = PASS
#   1 = FAIL
#   2 = ERROR
#
# This script sources lib/config.sh, lib/retry.sh, lib/reporting.sh,
# and lib/test-setup.sh to orchestrate a single test case execution.

set -euo pipefail

# --- Determine script/project root ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Source library functions ---
source "${PROJECT_ROOT}/lib/config.sh"
source "${PROJECT_ROOT}/lib/retry.sh"
source "${PROJECT_ROOT}/lib/reporting.sh"
source "${PROJECT_ROOT}/lib/test-setup.sh"

# --- Argument parsing ---
TEST_ID=""
ENV_NAME="${TEST_ENV:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --env)
      if [ -z "${2:-}" ]; then
        echo "ERROR: --env requires a value (DEV, QA, or UAT)" >&2
        exit 2
      fi
      ENV_NAME="$2"
      shift 2
      ;;
    --env=*)
      ENV_NAME="${1#--env=}"
      shift
      ;;
    -*)
      echo "ERROR: Unknown option '$1'" >&2
      echo "  Usage: $0 TEST_ID [--env ENV_NAME]" >&2
      exit 2
      ;;
    *)
      if [ -z "$TEST_ID" ]; then
        TEST_ID="$1"
      else
        echo "ERROR: Unexpected argument '$1'" >&2
        echo "  Usage: $0 TEST_ID [--env ENV_NAME]" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

# --- Validate required arguments ---
if [ -z "$TEST_ID" ]; then
  echo "ERROR: Test ID is required" >&2
  echo "  Usage: $0 TEST_ID [--env ENV_NAME]" >&2
  echo "  Example: $0 04 --env DEV" >&2
  exit 2
fi

if [ -z "$ENV_NAME" ]; then
  echo "ERROR: No environment specified" >&2
  echo "  Details: Provide --env argument or set TEST_ENV environment variable" >&2
  echo "  Action: Use --env DEV, --env QA, or --env UAT" >&2
  exit 2
fi

# --- Find test case JSON file ---
TEST_CASES_DIR="${PROJECT_ROOT}/tests/cases"
TEST_CASE_FILE=""

# Try exact match first: test-XX-*.json (case-insensitive ID)
TEST_ID_LOWER=$(echo "$TEST_ID" | tr '[:upper:]' '[:lower:]')
TEST_ID_UPPER=$(echo "$TEST_ID" | tr '[:lower:]' '[:upper:]')

for f in "${TEST_CASES_DIR}"/test-*.json; do
  [ -f "$f" ] || continue
  # Extract ID from filename (e.g., "test-04-text-body.json" -> "04")
  basename_f=$(basename "$f")
  # Match pattern: test-{ID}-description.json
  # Handle multi-segment IDs like "22a" or "22A"
  file_id=$(echo "$basename_f" | sed 's/^test-\([^-]*\)-.*/\1/' | tr '[:lower:]' '[:upper:]')
  if [ "$file_id" = "$TEST_ID_UPPER" ]; then
    TEST_CASE_FILE="$f"
    break
  fi
done

if [ -z "$TEST_CASE_FILE" ]; then
  echo "ERROR: Test case not found for ID '${TEST_ID}'" >&2
  echo "  Details: No file matching test-${TEST_ID}-*.json in ${TEST_CASES_DIR}/" >&2
  echo "  Action: Check available test IDs in tests/cases/ directory" >&2
  exit 2
fi

# --- Load configuration ---
load_config "$ENV_NAME" || exit 2

# --- Generate timestamp for test isolation ---
TIMESTAMP=$(date +%s)
export TIMESTAMP

# --- Load and parse test case JSON ---
# Use node for reliable JSON parsing
TEST_CASE_JSON=$(cat "$TEST_CASE_FILE")

# Extract key fields using node
TEST_NAME=$(node -e "
  const tc = JSON.parse(require('fs').readFileSync('${TEST_CASE_FILE}', 'utf8'));
  process.stdout.write(tc.name || '');
")

SEND_METHOD=$(node -e "
  const tc = JSON.parse(require('fs').readFileSync('${TEST_CASE_FILE}', 'utf8'));
  process.stdout.write(tc.sendMethod || 'eml');
")

VERIFICATION_TYPE=$(node -e "
  const tc = JSON.parse(require('fs').readFileSync('${TEST_CASE_FILE}', 'utf8'));
  process.stdout.write((tc.verification && tc.verification.type) || '');
")

# --- Initialize reporting ---
init_reporting

# --- Inject {{timestamp}} into the test case JSON ---
# Replace template variables with resolved values
RESOLVED_JSON=$(echo "$TEST_CASE_JSON" | sed \
  -e "s/{{timestamp}}/${TIMESTAMP}/g" \
  -e "s/{{primary_email}}/${PRIMARY_EMAIL}/g" \
  -e "s/{{secondary_email}}/${SECONDARY_EMAIL:-}/g" \
  -e "s/{{tertiary_email}}/${TERTIARY_EMAIL:-}/g")

# Write resolved JSON to a temporary file for tools to consume
RESOLVED_TEST_CASE=$(mktemp "${TMPDIR:-/tmp}/test-case-XXXXXX.json")
echo "$RESOLVED_JSON" > "$RESOLVED_TEST_CASE"

# Cleanup temp file on exit
cleanup() {
  rm -f "$RESOLVED_TEST_CASE"
}
trap cleanup EXIT

# --- Run preconditions ---
echo "--- Running test ${TEST_ID}: ${TEST_NAME} ---"
echo ""

HAS_PRECONDITIONS=$(node -e "
  const tc = JSON.parse(require('fs').readFileSync('${RESOLVED_TEST_CASE}', 'utf8'));
  const preconds = tc.preconditions || [];
  process.stdout.write(preconds.length > 0 ? 'yes' : 'no');
")

if [ "$HAS_PRECONDITIONS" = "yes" ]; then
  echo "Setting up preconditions..."
  precondition_output=$(run_preconditions "$RESOLVED_JSON")
  precondition_exit=$?

  if [ $precondition_exit -ne 0 ]; then
    report_error "$TEST_ID" "$TEST_NAME" "Precondition setup failed"
    exit 2
  fi

  # Extract any created record IDs for use in verification
  if [ -n "$precondition_output" ]; then
    echo "  Preconditions created: $precondition_output"
    # Extract Case ID if a case was created (for thread_id resolution)
    PRECONDITION_CASE_ID=$(echo "$precondition_output" | grep "^CASE:" | head -1 | cut -d: -f2)
    if [ -n "$PRECONDITION_CASE_ID" ]; then
      export PRECONDITION_CASE_ID
      # Update resolved JSON with the case ID for thread_id references
      RESOLVED_JSON=$(echo "$RESOLVED_JSON" | sed "s/{{thread_id}}/${PRECONDITION_CASE_ID}/g")
      echo "$RESOLVED_JSON" > "$RESOLVED_TEST_CASE"
    fi
  fi
  echo ""
fi

# --- Execute send mechanism ---
echo "Sending email (method: ${SEND_METHOD})..."
SEND_EXIT=0

case "$SEND_METHOD" in
  eml)
    # Generate .eml file
    EML_OUTPUT_DIR="${PROJECT_ROOT}/generated-emails"
    mkdir -p "$EML_OUTPUT_DIR"

    EML_PATH=$(node "${PROJECT_ROOT}/src/eml-generator.js" \
      --test-case "$RESOLVED_TEST_CASE" \
      --env-config "${PROJECT_ROOT}/env-config.json" \
      --output "$EML_OUTPUT_DIR/" 2>&1)
    SEND_EXIT=$?

    if [ $SEND_EXIT -ne 0 ]; then
      report_error "$TEST_ID" "$TEST_NAME" "EML generation failed: ${EML_PATH}"
      exit 2
    fi

    echo ""
    echo "  Generated: ${EML_PATH}"
    echo ""

    # Ask user if they want to open the .eml in their mail client
    read -r -p "  Open in mail client? [y/N] " open_choice
    if [[ "$open_choice" =~ ^[Yy]$ ]]; then
      open "$EML_PATH" 2>/dev/null || echo "  Warning: Could not open file with default application"
    fi

    echo ""
    read -r -p "  Press Enter after sending the email..." _
    echo ""
    ;;

  smtp)
    # Send directly via Manipulated SMTP server
    SMTP_RESULT=$(node "${PROJECT_ROOT}/src/smtp-sender.js" \
      --test-case "$RESOLVED_TEST_CASE" \
      --env-config "${PROJECT_ROOT}/env-config.json" \
      --credentials "${PROJECT_ROOT}/credentials.json" 2>&1)
    SEND_EXIT=$?

    if [ $SEND_EXIT -ne 0 ]; then
      # Parse error details from JSON output if possible
      local_error=$(echo "$SMTP_RESULT" | node -e "
        let data=''; process.stdin.on('data',c=>data+=c); process.stdin.on('end',()=>{
          try { const j=JSON.parse(data); process.stdout.write(j.error||j.message||data); }
          catch(e) { process.stdout.write(data); }
        });
      " 2>/dev/null || echo "$SMTP_RESULT")

      report_error "$TEST_ID" "$TEST_NAME" "SMTP send failed (exit ${SEND_EXIT}): ${local_error}"
      exit 2
    fi

    echo "  Email sent via SMTP"
    echo ""
    ;;

  *)
    report_error "$TEST_ID" "$TEST_NAME" "Unknown send method '${SEND_METHOD}'"
    exit 2
    ;;
esac

# --- Wait initial delay ---
echo "Waiting ${INITIAL_DELAY}s for Salesforce processing..."
sleep "$INITIAL_DELAY"
echo ""

# --- Run verification with retry logic ---
echo "Running verification..."

# Build verification query and expected results from test case JSON
VERIFY_RESULT=$(node -e "
  const fs = require('fs');
  const tc = JSON.parse(fs.readFileSync('${RESOLVED_TEST_CASE}', 'utf8'));
  const v = tc.verification;

  if (!v || !v.queries || v.queries.length === 0) {
    console.log(JSON.stringify({ error: 'No verification queries defined' }));
    process.exit(0);
  }

  // For the first query, build the expected JSON and determine query function
  const firstQuery = v.queries[0];
  const queryObject = firstQuery.object;
  const assertions = firstQuery.assertions || [];

  // Build expected JSON from assertions
  const expected = {};
  for (const a of assertions) {
    if (a.operator === 'equals') {
      expected[a.field] = a.value;
    } else if (a.operator === 'not_null') {
      expected[a.field] = 'NOT_NULL';
    }
  }

  // Determine which query function to use based on object type
  let queryFunction = '';
  let queryArgs = '';

  switch (queryObject) {
    case 'Case':
      // Extract the subject from the filter or assertions
      const subjectAssert = assertions.find(a => a.field === 'Subject' && a.operator === 'equals');
      const filterMatch = (firstQuery.filter || '').match(/Subject\\s*=\\s*'([^']+)'/);
      queryArgs = subjectAssert ? subjectAssert.value : (filterMatch ? filterMatch[1] : '');
      queryFunction = 'query_case_by_subject';
      break;
    case 'EmailMessage':
      queryFunction = 'query_email_message_by_case';
      queryArgs = '{{caseId}}'; // resolved after Case query
      break;
    case 'LostEmail__c':
      queryFunction = 'query_lost_email';
      break;
    default:
      queryFunction = 'query_case_by_subject';
  }

  console.log(JSON.stringify({
    queryFunction,
    queryArgs,
    expected,
    verificationType: v.type,
    totalQueries: v.queries.length
  }));
")

# Parse verification parameters
QUERY_FUNCTION=$(echo "$VERIFY_RESULT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    const r=JSON.parse(d);process.stdout.write(r.queryFunction||'');
  });
")

QUERY_ARGS=$(echo "$VERIFY_RESULT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    const r=JSON.parse(d);process.stdout.write(r.queryArgs||'');
  });
")

EXPECTED_JSON=$(echo "$VERIFY_RESULT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    const r=JSON.parse(d);process.stdout.write(JSON.stringify(r.expected||{}));
  });
")

VERIFICATION_TYPE_PARSED=$(echo "$VERIFY_RESULT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    const r=JSON.parse(d);process.stdout.write(r.verificationType||'');
  });
")

# Handle special verification types
if [ "$QUERY_FUNCTION" = "query_case_by_subject" ] && [ -n "$QUERY_ARGS" ]; then
  # Standard case: verify case was created/updated by subject
  RESULT_OUTPUT=$(verify_with_retry "$QUERY_FUNCTION" "$QUERY_ARGS" "$EXPECTED_JSON" "$MAX_RETRIES" "$RETRY_INTERVAL")
  VERIFY_EXIT=$?
elif [ "$QUERY_FUNCTION" = "query_lost_email" ]; then
  # Special handling for lost email verification — use subject from filter
  LOST_SUBJECT=$(echo "$RESOLVED_JSON" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      const tc=JSON.parse(d);
      const subj=tc.emailProperties.subject||'';
      process.stdout.write(subj);
    });
  ")
  RESULT_OUTPUT=$(verify_with_retry "query_lost_email" "$LOST_SUBJECT" "$EXPECTED_JSON" "$MAX_RETRIES" "$RETRY_INTERVAL")
  VERIFY_EXIT=$?
else
  # Fallback: try query by subject from email properties
  FALLBACK_SUBJECT=$(echo "$RESOLVED_JSON" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      const tc=JSON.parse(d);
      process.stdout.write(tc.emailProperties.subject||'');
    });
  ")
  if [ -n "$FALLBACK_SUBJECT" ]; then
    RESULT_OUTPUT=$(verify_with_retry "query_case_by_subject" "$FALLBACK_SUBJECT" "$EXPECTED_JSON" "$MAX_RETRIES" "$RETRY_INTERVAL")
    VERIFY_EXIT=$?
  else
    RESULT_OUTPUT="STATUS: ERROR
ATTEMPTS: 0
ELAPSED: 0
DETAILS: Could not determine verification query parameters"
    VERIFY_EXIT=2
  fi
fi

# --- Report result ---
echo ""
echo "$RESULT_OUTPUT"
echo ""

# Extract status from verify output
RESULT_STATUS=$(echo "$RESULT_OUTPUT" | grep "^STATUS:" | head -1 | sed 's/^STATUS:[[:space:]]*//')

case "$RESULT_STATUS" in
  PASS)
    report_pass "$TEST_ID" "$TEST_NAME"
    echo ""
    report_summary
    exit 0
    ;;
  FAIL)
    FAIL_DETAILS=$(echo "$RESULT_OUTPUT" | grep "^DETAILS:" | head -1 | sed 's/^DETAILS:[[:space:]]*//')
    report_fail "$TEST_ID" "$TEST_NAME" "Verification" "expected values" "$FAIL_DETAILS"
    echo ""
    report_summary
    exit 1
    ;;
  ERROR|*)
    ERROR_DETAILS=$(echo "$RESULT_OUTPUT" | grep "^DETAILS:" | head -1 | sed 's/^DETAILS:[[:space:]]*//')
    report_error "$TEST_ID" "$TEST_NAME" "${ERROR_DETAILS:-Verification error}"
    echo ""
    report_summary
    exit 2
    ;;
esac
