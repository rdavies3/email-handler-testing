#!/usr/bin/env bash
# lib/retry.sh — Retry/polling logic for Salesforce verification
# This file is sourced by other scripts, not executed directly.
#
# Usage:
#   source lib/retry.sh
#   result=$(verify_with_retry "query_case_by_subject" "Test-04-1700000000" \
#            '{"Subject":"Test-04-1700000000","Description":"body text"}' 5 10)
#
# Prerequisites:
#   - lib/soql-queries.sh must be sourced (provides query functions)
#   - ORG_ALIAS must be set
#   - INITIAL_DELAY, MAX_RETRIES, RETRY_INTERVAL may be set (defaults: 30, 5, 10)
#
# The verify_with_retry function:
#   - Sleeps for an initial delay before the first query attempt
#   - Executes the query function and compares results against expected values
#   - Retries up to max_retries times with retry_interval sleep between attempts
#   - Returns structured text to stdout: PASS/FAIL/ERROR with details
#   - Exit codes: 0 = PASS, 1 = FAIL (retries exhausted), 2 = ERROR

# --- Source SOQL query functions if not already loaded ---
_RETRY_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! declare -f _exec_soql &>/dev/null; then
  source "${_RETRY_SH_DIR}/soql-queries.sh"
fi

# --- JSON field extraction helpers ---
# These use grep/sed since jq is not a required dependency.

# _retry_extract_field JSON FIELD_NAME
#   Extract a field value from SF CLI JSON output.
#   Handles both string values ("field": "value") and numeric/null values.
#   Returns the value (without quotes for strings) on stdout.
_retry_extract_field() {
  local json="$1"
  local field="$2"

  # Try string value first: "Field": "value"
  local string_val
  string_val=$(echo "$json" | grep -o "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')

  if [ -n "$string_val" ]; then
    echo "$string_val"
    return 0
  fi

  # Try numeric value: "Field": 123
  local num_val
  num_val=$(echo "$json" | grep -o "\"${field}\"[[:space:]]*:[[:space:]]*[0-9][0-9]*" | head -1 | sed 's/.*:[[:space:]]*//')

  if [ -n "$num_val" ]; then
    echo "$num_val"
    return 0
  fi

  # Try null value: "Field": null
  local null_val
  null_val=$(echo "$json" | grep -o "\"${field}\"[[:space:]]*:[[:space:]]*null" | head -1)

  if [ -n "$null_val" ]; then
    echo "null"
    return 0
  fi

  # Try boolean true/false: "Field": true or "Field": false
  local bool_val
  bool_val=$(echo "$json" | grep -o "\"${field}\"[[:space:]]*:[[:space:]]*\(true\|false\)" | head -1 | sed 's/.*:[[:space:]]*//')

  if [ -n "$bool_val" ]; then
    echo "$bool_val"
    return 0
  fi

  # Field not found
  return 1
}

# _retry_extract_total_size JSON
#   Extract the totalSize from SF CLI JSON response to check if records were returned.
_retry_extract_total_size() {
  local json="$1"
  local size
  size=$(echo "$json" | grep -o '"totalSize"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*:[[:space:]]*//')
  echo "${size:-0}"
}

# _retry_parse_expected EXPECTED_JSON
#   Parse expected JSON into field=value pairs, one per line.
#   Input format: {"Field1":"value1","Field2":"value2"}
#   Output format: Field1=value1\nField2=value2
_retry_parse_expected() {
  local expected="$1"

  # Remove outer braces
  local inner
  inner=$(echo "$expected" | sed 's/^[[:space:]]*{//;s/}[[:space:]]*$//')

  # Split on commas that separate key-value pairs (handles simple cases)
  # Extract each "key":"value" or "key":number pair
  echo "$inner" | grep -o '"[^"]*"[[:space:]]*:[[:space:]]*"[^"]*"\|"[^"]*"[[:space:]]*:[[:space:]]*[0-9]*\|"[^"]*"[[:space:]]*:[[:space:]]*null\|"[^"]*"[[:space:]]*:[[:space:]]*\(true\|false\)' | while IFS= read -r pair; do
    local key
    local val
    key=$(echo "$pair" | sed 's/"\([^"]*\)".*/\1/')
    # Extract value - could be quoted string, number, null, or boolean
    val=$(echo "$pair" | sed 's/"[^"]*"[[:space:]]*:[[:space:]]*//')
    # Remove surrounding quotes from string values
    val=$(echo "$val" | sed 's/^"\(.*\)"$/\1/')
    echo "${key}=${val}"
  done
}

# _retry_check_not_null VALUE
#   Returns 0 if the value is not null/empty, 1 otherwise.
_retry_check_not_null() {
  local val="$1"
  if [ -z "$val" ] || [ "$val" = "null" ]; then
    return 1
  fi
  return 0
}

# --- Comparison logic ---

# _retry_compare_results ACTUAL_JSON EXPECTED_JSON
#   Compare actual SF CLI query results against expected field values.
#   Expected format: {"Field":"expected_value", "Field2":"expected_value2"}
#   Special operators in expected values:
#     - "NOT_NULL" — field must exist and not be null
#   Returns 0 if all fields match, 1 if any mismatch.
#   Outputs comparison details to stdout.
_retry_compare_results() {
  local actual_json="$1"
  local expected_json="$2"

  # Check that we have records in the result
  local total_size
  total_size=$(_retry_extract_total_size "$actual_json")

  if [ "$total_size" -eq 0 ] 2>/dev/null; then
    echo "MISMATCH: No records returned (totalSize=0)"
    return 1
  fi

  # Parse expected fields
  local all_match=0
  local details=""

  while IFS= read -r field_pair; do
    [ -z "$field_pair" ] && continue

    local field_name
    local expected_value
    field_name=$(echo "$field_pair" | cut -d'=' -f1)
    expected_value=$(echo "$field_pair" | cut -d'=' -f2-)

    # Extract actual value from the JSON response
    local actual_value
    actual_value=$(_retry_extract_field "$actual_json" "$field_name")

    # Handle NOT_NULL operator
    if [ "$expected_value" = "NOT_NULL" ]; then
      if _retry_check_not_null "$actual_value"; then
        details="${details}MATCH: ${field_name} is not null (value: ${actual_value})\n"
      else
        details="${details}MISMATCH: ${field_name} expected NOT_NULL but got '${actual_value}'\n"
        all_match=1
      fi
      continue
    fi

    # Standard equality comparison
    if [ "$actual_value" = "$expected_value" ]; then
      details="${details}MATCH: ${field_name} = '${actual_value}'\n"
    else
      details="${details}MISMATCH: ${field_name} expected '${expected_value}' but got '${actual_value}'\n"
      all_match=1
    fi
  done <<< "$(_retry_parse_expected "$expected_json")"

  # Output details
  printf "%b" "$details"

  return $all_match
}

# --- Main retry function ---

# verify_with_retry QUERY_FUNCTION QUERY_ARGS EXPECTED_JSON [MAX_RETRIES] [RETRY_INTERVAL]
#
# Parameters:
#   QUERY_FUNCTION  — Name of the query function to call (e.g., "query_case_by_subject")
#   QUERY_ARGS      — Arguments to pass to the query function (e.g., the subject string)
#   EXPECTED_JSON   — JSON object with expected field values: {"Field":"value", ...}
#                     Use "NOT_NULL" as a value to assert a field is not null/empty
#   MAX_RETRIES     — Max retry attempts (default: $MAX_RETRIES env var, or 5)
#   RETRY_INTERVAL  — Seconds between retries (default: $RETRY_INTERVAL env var, or 10)
#
# Environment variables (optional overrides):
#   INITIAL_DELAY   — Seconds to wait before first query (default: 30)
#   MAX_RETRIES     — Default max retry attempts (default: 5)
#   RETRY_INTERVAL  — Default seconds between retries (default: 10)
#
# Output (stdout):
#   Structured result text:
#     STATUS: PASS|FAIL|ERROR
#     ATTEMPTS: <number>
#     ELAPSED: <seconds>
#     DETAILS: <comparison details or error message>
#
# Exit codes:
#   0 = PASS (expected results found)
#   1 = FAIL (retries exhausted, results did not match)
#   2 = ERROR (query execution failed)
verify_with_retry() {
  local query_function="$1"
  local query_args="$2"
  local expected_json="$3"
  local max_retries="${4:-${MAX_RETRIES:-5}}"
  local retry_interval="${5:-${RETRY_INTERVAL:-10}}"
  local initial_delay="${INITIAL_DELAY:-30}"

  # Validate parameters
  if [ -z "$query_function" ]; then
    echo "STATUS: ERROR"
    echo "ATTEMPTS: 0"
    echo "ELAPSED: 0"
    echo "DETAILS: query_function parameter is required"
    return 2
  fi

  if [ -z "$expected_json" ]; then
    echo "STATUS: ERROR"
    echo "ATTEMPTS: 0"
    echo "ELAPSED: 0"
    echo "DETAILS: expected_json parameter is required"
    return 2
  fi

  # Verify the query function exists
  if ! declare -f "$query_function" &>/dev/null; then
    echo "STATUS: ERROR"
    echo "ATTEMPTS: 0"
    echo "ELAPSED: 0"
    echo "DETAILS: Query function '${query_function}' is not defined. Source lib/soql-queries.sh first."
    return 2
  fi

  # Record start time
  local start_time
  start_time=$(date +%s)

  # Initial delay before first query
  if [ "$initial_delay" -gt 0 ] 2>/dev/null; then
    sleep "$initial_delay"
  fi

  # Retry loop
  local attempt=0
  local last_result=""
  local last_comparison=""
  local query_exit_code

  while [ "$attempt" -lt "$max_retries" ]; do
    attempt=$((attempt + 1))

    # Execute the query function
    last_result=$("$query_function" "$query_args" 2>/dev/null)
    query_exit_code=$?

    # Handle query execution errors
    if [ $query_exit_code -ne 0 ]; then
      # On timeout (124) or error, still retry
      if [ $query_exit_code -eq 124 ]; then
        last_comparison="Query timed out on attempt ${attempt}"
      else
        last_comparison="Query failed with exit code ${query_exit_code} on attempt ${attempt}"
      fi

      # If it's the last attempt, report ERROR
      if [ "$attempt" -ge "$max_retries" ]; then
        local end_time
        end_time=$(date +%s)
        local elapsed=$((end_time - start_time))

        echo "STATUS: ERROR"
        echo "ATTEMPTS: ${attempt}"
        echo "ELAPSED: ${elapsed}"
        echo "DETAILS: ${last_comparison}"
        return 2
      fi

      # Wait before next retry
      sleep "$retry_interval"
      continue
    fi

    # Compare results against expected
    last_comparison=$(_retry_compare_results "$last_result" "$expected_json")
    local compare_exit=$?

    if [ $compare_exit -eq 0 ]; then
      # PASS — results match expected
      local end_time
      end_time=$(date +%s)
      local elapsed=$((end_time - start_time))

      echo "STATUS: PASS"
      echo "ATTEMPTS: ${attempt}"
      echo "ELAPSED: ${elapsed}"
      echo "DETAILS: All fields match expected values"
      return 0
    fi

    # Results don't match yet — retry if attempts remain
    if [ "$attempt" -ge "$max_retries" ]; then
      break
    fi

    sleep "$retry_interval"
  done

  # All retries exhausted — FAIL
  local end_time
  end_time=$(date +%s)
  local elapsed=$((end_time - start_time))

  echo "STATUS: FAIL"
  echo "ATTEMPTS: ${attempt}"
  echo "ELAPSED: ${elapsed}"
  echo "DETAILS: Retries exhausted after ${elapsed}s (${attempt} attempts). Last comparison:"
  echo "$last_comparison"
  return 1
}

# --- Convenience wrapper for count-based verification ---

# verify_record_count QUERY_FUNCTION QUERY_ARGS EXPECTED_COUNT [MAX_RETRIES] [RETRY_INTERVAL]
#
# Simplified verification that checks only the totalSize of query results.
# Useful for duplicate detection tests where we just need to confirm record count.
#
# Parameters:
#   QUERY_FUNCTION  — Name of the query function to call
#   QUERY_ARGS      — Arguments to pass to the query function
#   EXPECTED_COUNT  — Expected number of records (totalSize)
#   MAX_RETRIES     — Max retry attempts (default: $MAX_RETRIES env var, or 5)
#   RETRY_INTERVAL  — Seconds between retries (default: $RETRY_INTERVAL env var, or 10)
#
# Output and exit codes: same as verify_with_retry
verify_record_count() {
  local query_function="$1"
  local query_args="$2"
  local expected_count="$3"
  local max_retries="${4:-${MAX_RETRIES:-5}}"
  local retry_interval="${5:-${RETRY_INTERVAL:-10}}"
  local initial_delay="${INITIAL_DELAY:-30}"

  # Validate parameters
  if [ -z "$query_function" ]; then
    echo "STATUS: ERROR"
    echo "ATTEMPTS: 0"
    echo "ELAPSED: 0"
    echo "DETAILS: query_function parameter is required"
    return 2
  fi

  if [ -z "$expected_count" ]; then
    echo "STATUS: ERROR"
    echo "ATTEMPTS: 0"
    echo "ELAPSED: 0"
    echo "DETAILS: expected_count parameter is required"
    return 2
  fi

  # Verify the query function exists
  if ! declare -f "$query_function" &>/dev/null; then
    echo "STATUS: ERROR"
    echo "ATTEMPTS: 0"
    echo "ELAPSED: 0"
    echo "DETAILS: Query function '${query_function}' is not defined. Source lib/soql-queries.sh first."
    return 2
  fi

  # Record start time
  local start_time
  start_time=$(date +%s)

  # Initial delay before first query
  if [ "$initial_delay" -gt 0 ] 2>/dev/null; then
    sleep "$initial_delay"
  fi

  # Retry loop
  local attempt=0
  local last_count=""
  local query_exit_code

  while [ "$attempt" -lt "$max_retries" ]; do
    attempt=$((attempt + 1))

    # Execute the query function
    local result
    result=$("$query_function" "$query_args" 2>/dev/null)
    query_exit_code=$?

    # Handle query execution errors
    if [ $query_exit_code -ne 0 ]; then
      if [ "$attempt" -ge "$max_retries" ]; then
        local end_time
        end_time=$(date +%s)
        local elapsed=$((end_time - start_time))

        echo "STATUS: ERROR"
        echo "ATTEMPTS: ${attempt}"
        echo "ELAPSED: ${elapsed}"
        echo "DETAILS: Query failed with exit code ${query_exit_code} on final attempt"
        return 2
      fi
      sleep "$retry_interval"
      continue
    fi

    # Extract record count
    last_count=$(_retry_extract_total_size "$result")

    if [ "$last_count" = "$expected_count" ]; then
      local end_time
      end_time=$(date +%s)
      local elapsed=$((end_time - start_time))

      echo "STATUS: PASS"
      echo "ATTEMPTS: ${attempt}"
      echo "ELAPSED: ${elapsed}"
      echo "DETAILS: Record count matches expected (${expected_count})"
      return 0
    fi

    # Results don't match yet — retry if attempts remain
    if [ "$attempt" -ge "$max_retries" ]; then
      break
    fi

    sleep "$retry_interval"
  done

  # All retries exhausted — FAIL
  local end_time
  end_time=$(date +%s)
  local elapsed=$((end_time - start_time))

  echo "STATUS: FAIL"
  echo "ATTEMPTS: ${attempt}"
  echo "ELAPSED: ${elapsed}"
  echo "DETAILS: Expected ${expected_count} records but got ${last_count} after ${elapsed}s (${attempt} attempts)"
  return 1
}
