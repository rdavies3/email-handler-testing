#!/usr/bin/env bash
# lib/test-setup.sh — Pre-condition data insertion via SF CLI
# This file is sourced by other scripts, not executed directly.
#
# Usage:
#   source lib/test-setup.sh
#   create_precondition_case "Test Subject" "New"
#   create_case_null_checksum "Subject" "Body text"
#   ensure_contact_exists "test@example.com" "Jane" "Doe"
#   run_preconditions "$TEST_CASE_JSON"
#
# Prerequisites:
#   - ORG_ALIAS must be set (typically via lib/config.sh)
#   - SF CLI must be installed and authenticated

# --- Timeout command detection ---
_SETUP_TIMEOUT_CMD=""

_setup_detect_timeout() {
  if command -v timeout &>/dev/null; then
    _SETUP_TIMEOUT_CMD="timeout"
  elif command -v gtimeout &>/dev/null; then
    _SETUP_TIMEOUT_CMD="gtimeout"
  else
    _SETUP_TIMEOUT_CMD=""
  fi
}

_setup_detect_timeout

# --- Internal helper: execute SF CLI command with timeout ---
# _exec_sf_create SOBJECT VALUES
#   Creates a record via sf data create record.
#   Prints JSON result to stdout; errors to stderr.
#   Returns: 0 on success, 1 on error, 124 on timeout.
_exec_sf_create() {
  local sobject="$1"
  local values="$2"
  local result
  local exit_code

  # Validate ORG_ALIAS is set
  if [ -z "$ORG_ALIAS" ]; then
    echo "ERROR: Test Setup - ORG_ALIAS is not set" >&2
    echo "  Details: ORG_ALIAS must be exported before calling test setup functions" >&2
    echo "  Action: Source lib/config.sh and call load_config before using test setup" >&2
    return 1
  fi

  # Build the SF CLI command
  local cmd=(sf data create record --sobject "$sobject" --values "$values" --target-org "$ORG_ALIAS" --json)

  # Execute with timeout if available
  if [ -n "$_SETUP_TIMEOUT_CMD" ]; then
    result=$("$_SETUP_TIMEOUT_CMD" 30 "${cmd[@]}" 2>/dev/null)
    exit_code=$?
  else
    result=$("${cmd[@]}" 2>/dev/null)
    exit_code=$?
  fi

  # Handle timeout
  if [ $exit_code -eq 124 ]; then
    echo "ERROR: Test Setup - SF CLI command timed out after 30 seconds" >&2
    echo "  Details: sf data create record did not respond within 30 seconds" >&2
    echo "  Action: Check Salesforce connectivity and org authentication" >&2
    return 124
  fi

  # Handle SF CLI errors
  if [ $exit_code -ne 0 ]; then
    echo "ERROR: Test Setup - SF CLI create record failed with exit code $exit_code" >&2
    if [ -n "$result" ]; then
      echo "  Details: $result" >&2
    fi
    echo "  Action: Verify SF CLI authentication and record field values" >&2
    return 1
  fi

  echo "$result"
  return 0
}

# --- Internal helper: execute SF CLI query with timeout ---
# _exec_sf_query QUERY
#   Runs a SOQL query via sf data query.
#   Prints JSON result to stdout; errors to stderr.
#   Returns: 0 on success, 1 on error, 124 on timeout.
_exec_sf_query() {
  local query="$1"
  local result
  local exit_code

  if [ -z "$ORG_ALIAS" ]; then
    echo "ERROR: Test Setup - ORG_ALIAS is not set" >&2
    echo "  Details: ORG_ALIAS must be exported before calling test setup functions" >&2
    echo "  Action: Source lib/config.sh and call load_config before using test setup" >&2
    return 1
  fi

  local cmd=(sf data query --query "$query" --target-org "$ORG_ALIAS" --json)

  if [ -n "$_SETUP_TIMEOUT_CMD" ]; then
    result=$("$_SETUP_TIMEOUT_CMD" 30 "${cmd[@]}" 2>/dev/null)
    exit_code=$?
  else
    result=$("${cmd[@]}" 2>/dev/null)
    exit_code=$?
  fi

  if [ $exit_code -eq 124 ]; then
    echo "ERROR: Test Setup - SF CLI query timed out after 30 seconds" >&2
    echo "  Details: sf data query did not respond within 30 seconds" >&2
    echo "  Action: Check Salesforce connectivity and org authentication" >&2
    return 124
  fi

  if [ $exit_code -ne 0 ]; then
    echo "ERROR: Test Setup - SF CLI query failed with exit code $exit_code" >&2
    if [ -n "$result" ]; then
      echo "  Details: $result" >&2
    fi
    echo "  Action: Verify SF CLI authentication and query syntax" >&2
    return 1
  fi

  echo "$result"
  return 0
}

# --- Internal helper: extract record ID from SF CLI JSON response ---
# _extract_record_id JSON_RESPONSE
#   Extracts the record Id from a sf data create record JSON response.
#   Returns the Id string on stdout, or empty string on failure.
_extract_record_id() {
  local json="$1"
  # SF CLI create record response has "id" field in the result
  echo "$json" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/'
}

# --- Public functions ---

# create_precondition_case SUBJECT STATUS
#   Creates a Case record with the given subject and status via SF CLI.
#   Prints the created Case Id to stdout on success.
#   Returns: 0 on success, non-zero on failure.
create_precondition_case() {
  local subject="$1"
  local status="$2"

  if [ -z "$subject" ]; then
    echo "ERROR: Test Setup - subject parameter is required for create_precondition_case" >&2
    return 1
  fi

  if [ -z "$status" ]; then
    echo "ERROR: Test Setup - status parameter is required for create_precondition_case" >&2
    return 1
  fi

  # Escape single quotes in values for SF CLI
  local escaped_subject="${subject//\'/\\\'}"
  local escaped_status="${status//\'/\\\'}"

  local values="Subject='${escaped_subject}' Status='${escaped_status}'"
  local result

  result=$(_exec_sf_create "Case" "$values")
  local exit_code=$?

  if [ $exit_code -ne 0 ]; then
    return $exit_code
  fi

  # Extract and return the record ID
  local record_id
  record_id=$(_extract_record_id "$result")

  if [ -z "$record_id" ]; then
    echo "ERROR: Test Setup - Could not extract Case Id from SF CLI response" >&2
    echo "  Details: $result" >&2
    return 1
  fi

  echo "$record_id"
  return 0
}

# create_case_null_checksum SUBJECT BODY
#   Creates a Case directly via SF CLI (bypassing the email handler) with no checksum.
#   This is used for checksum null handling tests (Requirement 15.3).
#   Prints the created Case Id to stdout on success.
#   Returns: 0 on success, non-zero on failure.
create_case_null_checksum() {
  local subject="$1"
  local body="$2"

  if [ -z "$subject" ]; then
    echo "ERROR: Test Setup - subject parameter is required for create_case_null_checksum" >&2
    return 1
  fi

  if [ -z "$body" ]; then
    echo "ERROR: Test Setup - body parameter is required for create_case_null_checksum" >&2
    return 1
  fi

  # Escape single quotes in values for SF CLI
  local escaped_subject="${subject//\'/\\\'}"
  local escaped_body="${body//\'/\\\'}"

  # Create Case with Subject and Description — no checksum field is set,
  # so it will be null (bypasses the email handler's duplicate detection).
  local values="Subject='${escaped_subject}' Description='${escaped_body}' Status='New'"
  local result

  result=$(_exec_sf_create "Case" "$values")
  local exit_code=$?

  if [ $exit_code -ne 0 ]; then
    return $exit_code
  fi

  # Extract and return the record ID
  local record_id
  record_id=$(_extract_record_id "$result")

  if [ -z "$record_id" ]; then
    echo "ERROR: Test Setup - Could not extract Case Id from SF CLI response" >&2
    echo "  Details: $result" >&2
    return 1
  fi

  echo "$record_id"
  return 0
}

# ensure_contact_exists EMAIL FIRST_NAME LAST_NAME
#   Checks if a Contact with the given email exists. Creates one if not.
#   Used to set up Contact records for contact matching tests (Requirement 13).
#   Prints the Contact Id to stdout on success.
#   Returns: 0 on success, non-zero on failure.
ensure_contact_exists() {
  local email="$1"
  local first_name="$2"
  local last_name="$3"

  if [ -z "$email" ]; then
    echo "ERROR: Test Setup - email parameter is required for ensure_contact_exists" >&2
    return 1
  fi

  if [ -z "$first_name" ]; then
    echo "ERROR: Test Setup - first_name parameter is required for ensure_contact_exists" >&2
    return 1
  fi

  if [ -z "$last_name" ]; then
    echo "ERROR: Test Setup - last_name parameter is required for ensure_contact_exists" >&2
    return 1
  fi

  # Escape single quotes for SOQL
  local escaped_email="${email//\'/\\\'}"

  # Check if Contact already exists
  local query="SELECT Id FROM Contact WHERE Email = '${escaped_email}' LIMIT 1"
  local query_result

  query_result=$(_exec_sf_query "$query")
  local exit_code=$?

  if [ $exit_code -ne 0 ]; then
    return $exit_code
  fi

  # Check if any records were returned
  # SF CLI JSON response has "totalSize" field indicating record count
  local total_size
  total_size=$(echo "$query_result" | grep -o '"totalSize"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*:[[:space:]]*//')

  if [ -n "$total_size" ] && [ "$total_size" -gt 0 ] 2>/dev/null; then
    # Contact already exists — extract and return the existing Id
    local existing_id
    existing_id=$(echo "$query_result" | grep -o '"Id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')

    if [ -n "$existing_id" ]; then
      echo "$existing_id"
      return 0
    fi
  fi

  # Contact does not exist — create one
  local escaped_first="${first_name//\'/\\\'}"
  local escaped_last="${last_name//\'/\\\'}"

  local values="Email='${escaped_email}' FirstName='${escaped_first}' LastName='${escaped_last}'"
  local create_result

  create_result=$(_exec_sf_create "Contact" "$values")
  exit_code=$?

  if [ $exit_code -ne 0 ]; then
    return $exit_code
  fi

  # Extract and return the record ID
  local record_id
  record_id=$(_extract_record_id "$create_result")

  if [ -z "$record_id" ]; then
    echo "ERROR: Test Setup - Could not extract Contact Id from SF CLI response" >&2
    echo "  Details: $create_result" >&2
    return 1
  fi

  echo "$record_id"
  return 0
}

# run_preconditions TEST_CASE_JSON
#   Parses the preconditions array from a test case JSON string and executes each.
#   Supported precondition types:
#     - "create-case": Creates a Case with subject and status
#     - "create-case-null-checksum": Creates a Case bypassing email handler (null checksum)
#     - "ensure-contact": Ensures a Contact exists with the given email and name
#
#   Prints created record IDs to stdout (one per line, format: "TYPE:ID").
#   Returns: 0 on success, 1 if any precondition fails.
#
#   Example JSON preconditions array:
#   [
#     {"type": "create-case", "subject": "Existing Case", "status": "Closed"},
#     {"type": "ensure-contact", "email": "test@example.com", "firstName": "Jane", "lastName": "Doe"}
#   ]
run_preconditions() {
  local test_case_json="$1"

  if [ -z "$test_case_json" ]; then
    echo "ERROR: Test Setup - test_case_json parameter is required for run_preconditions" >&2
    return 1
  fi

  # Extract the preconditions array content from the JSON
  # Look for "preconditions": [...] and extract items
  local has_preconditions
  has_preconditions=$(echo "$test_case_json" | grep -o '"preconditions"[[:space:]]*:[[:space:]]*\[' | head -1)

  if [ -z "$has_preconditions" ]; then
    # No preconditions key found — nothing to do
    return 0
  fi

  # Check for empty preconditions array
  local empty_array
  empty_array=$(echo "$test_case_json" | grep -o '"preconditions"[[:space:]]*:[[:space:]]*\[\]' | head -1)

  if [ -n "$empty_array" ]; then
    # Empty preconditions array — nothing to do
    return 0
  fi

  # Parse individual precondition objects using grep/sed
  # Extract each "type" value from within the preconditions array
  # Strategy: find each precondition object by its type field and extract sibling fields

  local precondition_types
  precondition_types=$(echo "$test_case_json" | grep -o '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')

  if [ -z "$precondition_types" ]; then
    return 0
  fi

  # Process each precondition by index
  local index=0
  local failed=0

  while IFS= read -r ptype; do
    index=$((index + 1))
    local record_id=""

    case "$ptype" in
      "create-case")
        # Extract subject and status for this precondition
        local pc_subject
        local pc_status
        pc_subject=$(echo "$test_case_json" | grep -o '"subject"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -n "${index}p" | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')
        pc_status=$(echo "$test_case_json" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -n "${index}p" | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')

        if [ -z "$pc_subject" ] || [ -z "$pc_status" ]; then
          echo "ERROR: Test Setup - create-case precondition missing subject or status" >&2
          failed=1
          continue
        fi

        record_id=$(create_precondition_case "$pc_subject" "$pc_status")
        if [ $? -ne 0 ]; then
          echo "ERROR: Test Setup - Failed to create precondition Case" >&2
          failed=1
          continue
        fi
        echo "CASE:${record_id}"
        ;;

      "create-case-null-checksum")
        # Extract subject and body for this precondition
        local nc_subject
        local nc_body
        nc_subject=$(echo "$test_case_json" | grep -o '"subject"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -n "${index}p" | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')
        nc_body=$(echo "$test_case_json" | grep -o '"body"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -n "${index}p" | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')

        if [ -z "$nc_subject" ] || [ -z "$nc_body" ]; then
          echo "ERROR: Test Setup - create-case-null-checksum precondition missing subject or body" >&2
          failed=1
          continue
        fi

        record_id=$(create_case_null_checksum "$nc_subject" "$nc_body")
        if [ $? -ne 0 ]; then
          echo "ERROR: Test Setup - Failed to create null-checksum Case" >&2
          failed=1
          continue
        fi
        echo "CASE_NULL_CHECKSUM:${record_id}"
        ;;

      "ensure-contact")
        # Extract email, firstName, lastName for this precondition
        local ct_email
        local ct_first
        local ct_last
        ct_email=$(echo "$test_case_json" | grep -o '"email"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -n "${index}p" | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')
        ct_first=$(echo "$test_case_json" | grep -o '"firstName"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -n "${index}p" | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')
        ct_last=$(echo "$test_case_json" | grep -o '"lastName"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -n "${index}p" | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/')

        if [ -z "$ct_email" ] || [ -z "$ct_first" ] || [ -z "$ct_last" ]; then
          echo "ERROR: Test Setup - ensure-contact precondition missing email, firstName, or lastName" >&2
          failed=1
          continue
        fi

        record_id=$(ensure_contact_exists "$ct_email" "$ct_first" "$ct_last")
        if [ $? -ne 0 ]; then
          echo "ERROR: Test Setup - Failed to ensure Contact exists" >&2
          failed=1
          continue
        fi
        echo "CONTACT:${record_id}"
        ;;

      *)
        echo "ERROR: Test Setup - Unknown precondition type '${ptype}'" >&2
        failed=1
        ;;
    esac
  done <<< "$precondition_types"

  if [ $failed -ne 0 ]; then
    return 1
  fi

  return 0
}
