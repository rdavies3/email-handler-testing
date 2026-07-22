#!/usr/bin/env bash
# lib/reporting.sh — Test result output formatting and counters
# This file is sourced by other scripts, not executed directly.
#
# Usage:
#   source lib/reporting.sh
#   init_reporting
#   report_pass "04" "Text body creates case with full description"
#   report_fail "05" "Attachments stored" "ContentVersion check" "2 files" "0 files"
#   report_error "22A" "From Name match" "SMTP connection refused"
#   report_summary "$_REPORT_TOTAL" "$_REPORT_PASSED" "$_REPORT_FAILED" "$_REPORT_ERRORS"
#   exit $(get_exit_code)
#
# Output format (machine-parseable):
#   [PASS] Test XX: <name>
#   [FAIL] Test XX: <name> - Step: <step> Expected: <expected> Actual: <actual>
#   [ERROR] Test XX: <name> - <error description>
#   Total: X | Passed: X | Failed: X | Errors: X

# --- Internal counters ---
_REPORT_TOTAL=0
_REPORT_PASSED=0
_REPORT_FAILED=0
_REPORT_ERRORS=0

# --- init_reporting ---
# Resets all counters to zero. Call at the start of a test run.
init_reporting() {
  _REPORT_TOTAL=0
  _REPORT_PASSED=0
  _REPORT_FAILED=0
  _REPORT_ERRORS=0
}

# --- Counter increment functions ---

increment_pass() {
  _REPORT_TOTAL=$((_REPORT_TOTAL + 1))
  _REPORT_PASSED=$((_REPORT_PASSED + 1))
}

increment_fail() {
  _REPORT_TOTAL=$((_REPORT_TOTAL + 1))
  _REPORT_FAILED=$((_REPORT_FAILED + 1))
}

increment_error() {
  _REPORT_TOTAL=$((_REPORT_TOTAL + 1))
  _REPORT_ERRORS=$((_REPORT_ERRORS + 1))
}

# --- Output functions ---

# report_pass TEST_ID TEST_NAME
#   Prints a PASS line and increments counters.
report_pass() {
  local test_id="$1"
  local test_name="$2"

  increment_pass
  echo "[PASS] Test ${test_id}: ${test_name}"
}

# report_fail TEST_ID TEST_NAME STEP EXPECTED ACTUAL
#   Prints a FAIL line with details and increments counters.
report_fail() {
  local test_id="$1"
  local test_name="$2"
  local step="$3"
  local expected="$4"
  local actual="$5"

  increment_fail
  echo "[FAIL] Test ${test_id}: ${test_name} - Step: ${step} Expected: ${expected} Actual: ${actual}"
}

# report_error TEST_ID TEST_NAME ERROR_DESC
#   Prints an ERROR line and increments counters.
report_error() {
  local test_id="$1"
  local test_name="$2"
  local error_desc="$3"

  increment_error
  echo "[ERROR] Test ${test_id}: ${test_name} - ${error_desc}"
}

# report_summary TOTAL PASSED FAILED ERRORS
#   Prints the summary line. If arguments are provided, uses them;
#   otherwise uses the internal counters.
report_summary() {
  local total="${1:-$_REPORT_TOTAL}"
  local passed="${2:-$_REPORT_PASSED}"
  local failed="${3:-$_REPORT_FAILED}"
  local errors="${4:-$_REPORT_ERRORS}"

  echo "Total: ${total} | Passed: ${passed} | Failed: ${failed} | Errors: ${errors}"
}

# --- Exit code helper ---

# get_exit_code
#   Returns 0 if all tests passed (no failures or errors), 1 otherwise.
get_exit_code() {
  if [ "$_REPORT_FAILED" -eq 0 ] && [ "$_REPORT_ERRORS" -eq 0 ]; then
    return 0
  else
    return 1
  fi
}
