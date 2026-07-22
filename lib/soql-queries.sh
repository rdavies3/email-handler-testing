#!/usr/bin/env bash
# lib/soql-queries.sh — SOQL query template functions for Salesforce verification
# This file is sourced by other scripts, not executed directly.
#
# Usage:
#   source lib/soql-queries.sh
#   result=$(query_case_by_subject "Test-04-1700000000")
#
# Prerequisites:
#   - ORG_ALIAS must be set (typically via lib/config.sh)
#   - SF CLI must be installed and authenticated
#
# All functions:
#   - Return JSON on stdout (from SF CLI --json output)
#   - Return errors on stderr
#   - Exit codes: 0 = success, 1 = query error, 124 = timeout

# --- Timeout command detection ---
# macOS does not ship with `timeout` by default; use `gtimeout` from coreutils if available.
_SOQL_TIMEOUT_CMD=""

_soql_detect_timeout() {
  if command -v timeout &>/dev/null; then
    _SOQL_TIMEOUT_CMD="timeout"
  elif command -v gtimeout &>/dev/null; then
    _SOQL_TIMEOUT_CMD="gtimeout"
  else
    _SOQL_TIMEOUT_CMD=""
  fi
}

_soql_detect_timeout

# --- Internal helper: execute a SOQL query via SF CLI ---
# _exec_soql QUERY
#   Executes the given SOQL query against $ORG_ALIAS with a 30-second timeout.
#   Prints JSON result to stdout; errors to stderr.
#   Returns: 0 on success, 1 on SF CLI error, 124 on timeout.
_exec_soql() {
  local query="$1"
  local result
  local exit_code

  # Validate ORG_ALIAS is set
  if [ -z "$ORG_ALIAS" ]; then
    echo "ERROR: SOQL - ORG_ALIAS is not set" >&2
    echo "  Details: ORG_ALIAS must be exported before calling SOQL query functions" >&2
    echo "  Action: Source lib/config.sh and call load_config before using SOQL queries" >&2
    return 1
  fi

  # Build the SF CLI command
  local cmd=(sf data query --query "$query" --target-org "$ORG_ALIAS" --json)

  # Execute with timeout if available
  if [ -n "$_SOQL_TIMEOUT_CMD" ]; then
    result=$("$_SOQL_TIMEOUT_CMD" 30 "${cmd[@]}" 2>/dev/null)
    exit_code=$?
  else
    # No timeout command available; run directly (warn on stderr)
    echo "WARNING: No timeout command available (install coreutils for gtimeout on macOS)" >&2
    result=$("${cmd[@]}" 2>/dev/null)
    exit_code=$?
  fi

  # Handle timeout (exit code 124 from timeout/gtimeout)
  if [ $exit_code -eq 124 ]; then
    echo "ERROR: SOQL - Query timed out after 30 seconds" >&2
    echo "  Details: sf data query did not respond within 30 seconds" >&2
    echo "  Action: Check Salesforce connectivity and org authentication" >&2
    return 124
  fi

  # Handle SF CLI errors
  if [ $exit_code -ne 0 ]; then
    echo "ERROR: SOQL - SF CLI query failed with exit code $exit_code" >&2
    if [ -n "$result" ]; then
      echo "  Details: $result" >&2
    fi
    echo "  Action: Verify SF CLI authentication and query syntax" >&2
    return 1
  fi

  # Output the JSON result
  echo "$result"
  return 0
}

# --- Public query functions ---

# query_case_by_subject SUBJECT
#   Find Case records by unique subject line.
#   Returns JSON with matching Case records (up to 5, most recent first).
query_case_by_subject() {
  local subject="$1"

  if [ -z "$subject" ]; then
    echo "ERROR: SOQL - subject parameter is required for query_case_by_subject" >&2
    return 1
  fi

  # Escape single quotes in subject for SOQL
  local escaped_subject="${subject//\'/\\\'}"

  local query="SELECT Id, Subject, Description, Status, ContactId, CaseNumber FROM Case WHERE Subject = '${escaped_subject}' ORDER BY CreatedDate DESC LIMIT 5"

  _exec_soql "$query"
}

# query_email_message_by_case CASE_ID
#   Find EmailMessage records linked to a specific Case.
#   Returns JSON with EmailMessage records for the given Case.
query_email_message_by_case() {
  local case_id="$1"

  if [ -z "$case_id" ]; then
    echo "ERROR: SOQL - caseId parameter is required for query_email_message_by_case" >&2
    return 1
  fi

  local query="SELECT Id, ParentId, Subject, TextBody, Status FROM EmailMessage WHERE ParentId = '${case_id}'"

  _exec_soql "$query"
}

# query_content_versions_by_case CASE_ID
#   Find ContentVersion records associated with a Case via ContentDocumentLink.
#   Returns JSON with ContentVersion records (file metadata).
query_content_versions_by_case() {
  local case_id="$1"

  if [ -z "$case_id" ]; then
    echo "ERROR: SOQL - caseId parameter is required for query_content_versions_by_case" >&2
    return 1
  fi

  local query="SELECT Id, Title, ContentSize, FileExtension FROM ContentVersion WHERE ContentDocumentId IN (SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${case_id}')"

  _exec_soql "$query"
}

# query_lost_email SENDER SUBJECT
#   Find LostEmail__c records by sender and subject.
#   Returns JSON with matching LostEmail records.
query_lost_email() {
  local sender="$1"
  local subject="$2"

  if [ -z "$sender" ]; then
    echo "ERROR: SOQL - sender parameter is required for query_lost_email" >&2
    return 1
  fi

  if [ -z "$subject" ]; then
    echo "ERROR: SOQL - subject parameter is required for query_lost_email" >&2
    return 1
  fi

  # Escape single quotes
  local escaped_sender="${sender//\'/\\\'}"
  local escaped_subject="${subject//\'/\\\'}"

  local query="SELECT Id, Sender__c, Subject__c FROM LostEmail__c WHERE Sender__c = '${escaped_sender}' AND Subject__c = '${escaped_subject}'"

  _exec_soql "$query"
}

# count_cases_by_subject SUBJECT START_TIME
#   Count Case records matching a subject created after a given time.
#   Used for duplicate detection verification.
#   START_TIME should be in Salesforce datetime format (e.g., 2024-01-01T00:00:00Z).
#   Returns JSON with count result.
count_cases_by_subject() {
  local subject="$1"
  local start_time="$2"

  if [ -z "$subject" ]; then
    echo "ERROR: SOQL - subject parameter is required for count_cases_by_subject" >&2
    return 1
  fi

  if [ -z "$start_time" ]; then
    echo "ERROR: SOQL - startTime parameter is required for count_cases_by_subject" >&2
    return 1
  fi

  # Escape single quotes in subject
  local escaped_subject="${subject//\'/\\\'}"

  # Note: startTime is a datetime literal in SOQL, not quoted
  local query="SELECT COUNT(Id) cnt FROM Case WHERE Subject = '${escaped_subject}' AND CreatedDate >= ${start_time}"

  _exec_soql "$query"
}
