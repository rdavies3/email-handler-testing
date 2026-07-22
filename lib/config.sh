#!/usr/bin/env bash
# lib/config.sh — Configuration loading helpers for shell scripts
# This file is sourced by other scripts, not executed directly.
#
# Usage:
#   source lib/config.sh
#   load_config "DEV"
#
# After successful load, the following variables are exported:
#   ORG_ALIAS, PRIMARY_EMAIL, SECONDARY_EMAIL, TERTIARY_EMAIL,
#   ORG_WIDE_EMAIL, INITIAL_DELAY, MAX_RETRIES, RETRY_INTERVAL

# Determine project root relative to this script's location
_CONFIG_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$_CONFIG_SH_DIR/.." && pwd)"
export PROJECT_ROOT

# --- JSON parsing helpers ---
# Extract a string value from JSON by key (simple top-level or nested dot notation)
# Uses grep/sed since jq is not a required dependency
_json_get_value() {
  local json="$1"
  local key="$2"
  # Match "key": "value" or "key": number
  echo "$json" | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/'
}

_json_get_number() {
  local json="$1"
  local key="$2"
  # Match "key": 123
  echo "$json" | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*[0-9]*" | head -1 | sed 's/.*:[[:space:]]*//'
}

# --- Main config loading function ---
# load_config ENV_NAME
#   Calls node src/config-loader.js and exports shell variables.
#   Returns 0 on success, non-zero on failure.
load_config() {
  local env_name="$1"

  if [ -z "$env_name" ]; then
    echo "ERROR: Configuration - No environment specified" >&2
    echo "  Details: The load_config function requires an environment name" >&2
    echo "  Action: Call load_config with DEV, QA, or UAT (e.g., load_config \"DEV\")" >&2
    return 1
  fi

  # Verify Node.js is available
  if ! command -v node &>/dev/null; then
    echo "ERROR: Prerequisites - Node.js not found" >&2
    echo "  Details: Node.js is required to load and validate configuration" >&2
    echo "  Action: Install Node.js 18+ from https://nodejs.org/" >&2
    return 1
  fi

  # Build paths to config files
  local config_file="${PROJECT_ROOT}/env-config.json"
  local credentials_file="${PROJECT_ROOT}/credentials.json"

  # Call config-loader.js and capture output
  local config_output
  local exit_code

  config_output=$(node "${PROJECT_ROOT}/src/config-loader.js" \
    --env "$env_name" \
    --config "$config_file" \
    --credentials "$credentials_file" 2>&1)
  exit_code=$?

  if [ $exit_code -ne 0 ]; then
    echo "ERROR: Configuration - Failed to load configuration for environment '${env_name}'" >&2
    echo "  Details: ${config_output}" >&2
    echo "  Action: Check that env-config.json and credentials.json exist and are valid" >&2
    return $exit_code
  fi

  # Parse the JSON output and export variables
  local org_alias
  local primary_email
  local secondary_email
  local tertiary_email
  local org_wide_email
  local initial_delay
  local max_retries
  local retry_interval

  org_alias=$(_json_get_value "$config_output" "orgAlias")
  primary_email=$(_json_get_value "$config_output" "primary")
  secondary_email=$(_json_get_value "$config_output" "secondary")
  tertiary_email=$(_json_get_value "$config_output" "tertiary")
  org_wide_email=$(_json_get_value "$config_output" "orgWideEmailAddress")
  initial_delay=$(_json_get_number "$config_output" "initialDelay")
  max_retries=$(_json_get_number "$config_output" "maxRetries")
  retry_interval=$(_json_get_number "$config_output" "retryInterval")

  # Validate that critical fields were parsed
  if [ -z "$org_alias" ]; then
    echo "ERROR: Configuration - Could not parse orgAlias from config-loader output" >&2
    echo "  Details: The config-loader returned data but orgAlias was empty or missing" >&2
    echo "  Action: Verify env-config.json has an orgAlias field for environment '${env_name}'" >&2
    return 1
  fi

  if [ -z "$primary_email" ]; then
    echo "ERROR: Configuration - Could not parse primary email from config-loader output" >&2
    echo "  Details: The config-loader returned data but primary email was empty or missing" >&2
    echo "  Action: Verify env-config.json has emailAddresses.primary for environment '${env_name}'" >&2
    return 1
  fi

  # Export all configuration variables
  export ORG_ALIAS="$org_alias"
  export PRIMARY_EMAIL="$primary_email"
  export SECONDARY_EMAIL="$secondary_email"
  export TERTIARY_EMAIL="$tertiary_email"
  export ORG_WIDE_EMAIL="$org_wide_email"
  export INITIAL_DELAY="${initial_delay:-30}"
  export MAX_RETRIES="${max_retries:-5}"
  export RETRY_INTERVAL="${retry_interval:-10}"

  # Also export the environment name and project root for convenience
  export TEST_ENV="$env_name"

  return 0
}
