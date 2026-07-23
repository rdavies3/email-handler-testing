#!/usr/bin/env bash
# bin/generate-test-data.sh — Generate test attachment files
#
# Calls the Node.js attachment generator to create test files of exact byte
# sizes with valid content for each declared file type. Verifies that key
# files exist and reports their sizes.
#
# Usage:
#   ./bin/generate-test-data.sh
#
# Exit codes:
#   0 — All files generated successfully
#   1 — Generation failed or verification errors detected

set -euo pipefail

# Determine project root relative to this script (bin/ -> parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Output directory for generated attachments
OUTPUT_DIR="$PROJECT_ROOT/generated-emails/attachments"

# --- Main ---

echo "=== Email Handler Testing Framework — Generate Test Data ==="
echo ""

# Create output directory if it doesn't exist
if [ ! -d "$OUTPUT_DIR" ]; then
  echo "Creating output directory: $OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"
fi

echo "Generating test attachment files..."
echo ""

# Call Node.js attachment generator
if ! node "$PROJECT_ROOT/src/attachment-generator.js" --output "$OUTPUT_DIR"; then
  echo ""
  echo "ERROR: Test Data Generation - attachment-generator.js failed"
  echo "  Details: The Node.js attachment generator exited with a non-zero status code"
  echo "  Action: Check the output above for errors and ensure Node.js v18+ is installed"
  exit 1
fi

echo ""
echo "Verifying generated files..."
echo ""

# Key files to verify (name and expected size in bytes)
declare -a verify_files=(
  "test-small.txt:524288"
  "test-large.pdf:5767168"
  "test-rejected.xyz:10240"
  "test-signature.p7s:2048"
  "test-2mb.png:2097152"
  "test-16mb.txt:16777216"
)

errors=0

for entry in "${verify_files[@]}"; do
  filename="${entry%%:*}"
  expected_size="${entry##*:}"
  filepath="$OUTPUT_DIR/$filename"

  if [ ! -f "$filepath" ]; then
    echo "  FAIL: $filename — file not found"
    errors=$((errors + 1))
    continue
  fi

  # Get actual file size (macOS stat syntax)
  actual_size=$(stat -f%z "$filepath" 2>/dev/null || stat --printf="%s" "$filepath" 2>/dev/null)

  if [ "$actual_size" -eq "$expected_size" ]; then
    echo "  OK: $filename — $actual_size bytes (expected $expected_size)"
  else
    echo "  FAIL: $filename — $actual_size bytes (expected $expected_size)"
    errors=$((errors + 1))
  fi
done

echo ""

if [ "$errors" -gt 0 ]; then
  echo "ERROR: Test Data Generation - $errors file(s) failed verification"
  echo "  Details: Some generated files are missing or have incorrect sizes"
  echo "  Action: Check the errors above and re-run this script"
  exit 1
fi

echo "All test data files generated and verified successfully."
exit 0
