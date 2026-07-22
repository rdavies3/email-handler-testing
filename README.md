# Email Handler Testing Framework

Automated testing framework for validating a Salesforce Email-to-Case handler (`CaseInboundEmailHandler.cls`). The framework generates test emails, orchestrates their delivery to Salesforce sandbox environments, and verifies expected outcomes via SF CLI SOQL queries.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Kiro Configuration](#kiro-configuration)
- [Email Client Configuration](#email-client-configuration)
- [Salesforce Configuration](#salesforce-configuration)
- [Credentials Setup](#credentials-setup)
- [Running Tests](#running-tests)
- [Troubleshooting](#troubleshooting)
- [Test Case Reference](#test-case-reference)
- [Project Structure](#project-structure)

---

## Prerequisites

The following software must be installed on your Mac before using this framework.

| Software | Minimum Version | Purpose |
|----------|----------------|---------|
| macOS | 13 (Ventura) | Operating system |
| Salesforce CLI (sf) | 2.0 | Querying Salesforce, creating test data |
| Node.js | 18.0 | EML file generation, SMTP sending, config validation |
| npm | (bundled with Node.js) | Installing Node.js dependencies |

### Installing Prerequisites

#### macOS

Confirm your macOS version by clicking the Apple menu and selecting "About This Mac". You need macOS 13 (Ventura) or later.

#### Salesforce CLI

Install the Salesforce CLI following the official guide:

https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_install_cli.htm

Or install via Homebrew:

```bash
brew install sf
```

Verify the installation:

```bash
sf --version
# Expected output: @salesforce/cli/2.x.x ...
```

#### Node.js

Install Node.js 18 or later from the official site:

https://nodejs.org/

Or install via Homebrew:

```bash
brew install node@18
```

Verify the installation:

```bash
node --version
# Expected output: v18.x.x or higher (e.g., v20.11.0)

npm --version
# Expected output: 9.x.x or higher
```

### Verifying All Prerequisites

Run the setup script to check all dependencies at once:

```bash
./bin/setup.sh
```

Expected output when everything is installed:

```
Checking prerequisites...
  SF CLI: v2.34.7 ✓
  Node.js: v20.11.0 ✓
  npm: v10.2.4 ✓

Installing Node.js dependencies...
  npm install complete ✓

All prerequisites satisfied.
```

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd email-handler-testing

# 2. Run setup (checks dependencies, installs npm packages)
./bin/setup.sh

# 3. Copy and configure environment settings
cp env-config.template.json env-config.json
# Edit env-config.json with your sandbox email addresses and org aliases

# 4. Copy and configure credentials (for tests 22/23 only)
cp credentials.template.json credentials.json
# Edit credentials.json with your SMTP server details

# 5. Generate test data files (attachments)
./bin/generate-test-data.sh

# 6. Authenticate SF CLI to your sandbox
sf org login web --alias DevSandbox --instance-url https://test.salesforce.com

# 7. Run a single test
./bin/run-tests.sh --env DEV --test 04
```

---

## Kiro Configuration

This project uses Kiro (AI-powered development environment) for development assistance. The AI agent configuration is stored in the project.

### Directory Structure

```
.kiro/
└── specs/
    └── email-handler-testing/
        ├── requirements.md    # Feature requirements and acceptance criteria
        ├── design.md          # Technical design document
        └── tasks.md           # Implementation task breakdown
```

### AGENTS.md Steering File

The `AGENTS.md` file in the project root provides AI agents with context about:

- Project architecture (shell scripts + Node.js)
- File naming conventions
- Key dependencies and their purposes
- Testing approach (Vitest for Node.js, bats for shell)
- Important constraints (never commit credentials, use SF CLI only)

### How It Works

When you use Kiro with this project, the AI agent reads `AGENTS.md` to understand the codebase conventions. The `.kiro/specs/` directory contains the full requirements and design documentation that guided the implementation.

You do not need to modify anything in `.kiro/` to run the test framework. These files are for development reference only.

---

## Email Client Configuration

Most test cases (tests 2-21, 24-35) generate `.eml` files that you open and send from your own mail client. This ensures emails come from a real mail client, simulating actual user behavior.

### How .eml Files Work

1. The framework generates a `.eml` file in `generated-emails/`
2. You open the file in your mail client
3. The email is pre-populated with the correct recipient, subject, and body
4. You send it from your configured email account
5. You return to the terminal and confirm the email was sent

### Microsoft Outlook (Desktop for Mac)

1. **Set the correct From address**: Your Outlook account's email address should be one that is known to your Salesforce sandbox as a Contact. This is needed for contact matching tests.
2. **Opening .eml files**: Double-click the generated `.eml` file. Outlook will open it in a new message window.
3. **Review before sending**: Check that the To address, Subject, and body look correct. The To address should be your sandbox's Email-to-Case routing address.
4. **Send**: Click Send. The email will be delivered to Salesforce.

> **Note**: Outlook may strip or modify some MIME headers. If you experience issues with attachments or inline images not arriving correctly, try Mac Mail instead.

### Outlook Web (OWA)

Outlook Web does not natively support opening `.eml` files. Use one of these workarounds:

1. **Drag and drop**: In some cases, you can drag a `.eml` file into Outlook Web's compose window as an attachment — but this sends it *as an attachment*, not as the email itself. This won't work for testing.
2. **Use Outlook Desktop or Mac Mail instead**: For the best results, use a desktop mail client that supports `.eml` files natively.
3. **Forward approach**: Open the `.eml` in Mac Mail, then forward it to the sandbox address. Be aware this changes the From address to yours, which is usually what you want.

### Apple Mail (Mac Mail)

1. **Opening .eml files**: Double-click the `.eml` file. Mac Mail opens it directly.
2. **Set the From address**: Before sending, ensure the From dropdown shows the correct email account (one that exists as a Contact in your sandbox).
3. **Send**: Click the Send button.

Mac Mail handles `.eml` files reliably and preserves MIME structure including attachments and inline images.

### Automatic Opening

The test runner can automatically open the `.eml` file in your default mail client using the macOS `open` command. When prompted:

```
Generated: generated-emails/test-04-1700000000.eml
Open in mail client? [Y/n]:
```

Press Enter or type `Y` to open automatically, or `n` to open manually.

### Setting Your From Address

For all tests, the From address of the sent email matters because Salesforce uses it for:
- Contact matching (linking Cases to Contacts)
- Loop prevention (blocking emails from org-wide addresses)
- Duplicate detection (same sender = same email)

Ensure your mail client is configured to send from an email address that exists as a Contact in your target Salesforce sandbox.

---

## Salesforce Configuration

### Authenticating SF CLI

Authenticate SF CLI to each sandbox you plan to test against:

```bash
# Authenticate to your DEV sandbox
sf org login web --alias DevSandbox --instance-url https://test.salesforce.com

# Authenticate to QA sandbox
sf org login web --alias QaSandbox --instance-url https://test.salesforce.com

# Authenticate to UAT sandbox
sf org login web --alias UatSandbox --instance-url https://test.salesforce.com
```

The `--alias` value must match the `orgAlias` field in your `env-config.json`.

Verify authentication:

```bash
sf org display --target-org DevSandbox
```

Expected output:

```
=== Org Description

 KEY              VALUE
 ──────────────── ──────────────────────────────────────
 Access Token     00D...
 Alias            DevSandbox
 Instance Url     https://your-sandbox.sandbox.my.salesforce.com
 Org Id           00D...
 Status           Active
 Username         admin@example.com.dev
```

### Case Assignment Rules (CAR)

Your sandbox must have Case Assignment Rules configured so that inbound emails create Cases. Verify this in Salesforce Setup:

1. Go to **Setup > Feature Settings > Service > Case Assignment Rules**
2. Ensure there is an active rule that routes emails to the correct queue or user
3. The Email-to-Case routing address must be active and pointing to the email addresses in your `env-config.json`

### Email-to-Case Routing

Verify that Email-to-Case is configured:

1. Go to **Setup > Feature Settings > Service > Email-to-Case**
2. Ensure Email-to-Case is enabled
3. Verify routing addresses match the `emailAddresses` in your `env-config.json`:
   - `primary` — the main Email-to-Case address
   - `secondary` — an alternate routing address (used for some tests)
   - `tertiary` — a third routing address (used for multi-sender tests)

### Test Contacts

Several tests require specific Contacts to exist in your sandbox:

1. **A Contact matching your email address**: For tests that verify ContactId matching. Create a Contact with the same email address you send from.
2. **A Contact with a known first and last name**: For tests 22A and 23A (From Name matching). The Contact's name must match the From Name used in those tests.
3. **Multiple Contacts with the same email**: For test 28 (multi-contact matching). Create 2+ Contacts sharing one email address.

Create test Contacts via Setup > Contacts, or via SF CLI:

```bash
sf data create record --sobject Contact \
  --values "FirstName='Test' LastName='User' Email='your-email@example.com'" \
  --target-org DevSandbox
```

### Org-Wide Email Addresses

Test 10 (loop prevention) requires an org-wide email address. This is the email that, when used as a sender, should NOT create a Case (to prevent loops).

1. Go to **Setup > Email > Organization-Wide Addresses**
2. Note the verified org-wide email address
3. Enter it as the `orgWideEmailAddress` in your `env-config.json`

### Email Deliverability

Ensure your sandbox allows outbound email (needed for rejection notification tests):

1. Go to **Setup > Email > Deliverability**
2. Set "Access Level" to **All email**
3. This is required for tests 18 (rejected attachment type sends a reply to the sender)

### Spam Filter Configuration

Test 21 validates the spam filter. Ensure your sandbox has Email_Case_Filter__c custom object records:

1. Query existing filters:
   ```bash
   sf data query --query "SELECT Name, Filter_Email_Body__c FROM Email_Case_Filter__c" \
     --target-org DevSandbox
   ```
2. The `spamFilterTerms` in your `env-config.json` should match Name values in those records

---

## Credentials Setup

Credentials are needed only for tests 22 and 23 (From Name manipulation via SMTP). If you are not running those tests, you can skip this section.

### Creating credentials.json

1. Copy the template:
   ```bash
   cp credentials.template.json credentials.json
   ```

2. Edit `credentials.json` with your SMTP server details:

```json
{
  "manipulatedSmtp": {
    "host": "smtp.your-server.com",
    "port": 587,
    "secure": false,
    "auth": {
      "username": "your-smtp-username",
      "password": "your-smtp-password"
    }
  }
}
```

### Field Descriptions

| Field | Description |
|-------|-------------|
| `host` | SMTP server hostname |
| `port` | SMTP server port (typically 587 for STARTTLS, 465 for SSL) |
| `secure` | `true` for SSL/TLS on connect, `false` for STARTTLS |
| `auth.username` | SMTP authentication username |
| `auth.password` | SMTP authentication password |

### What is the "Manipulated SMTP Server"?

Tests 22 and 23 need to send emails with a custom From display name (or blank From name) that differs from the actual sender. This requires an SMTP server that allows setting arbitrary From headers — most legitimate email providers don't allow this.

You need access to an SMTP server (or relay) that permits:
- Setting a custom display name in the From header
- Sending with a blank display name

This is typically a development/testing SMTP server or a relay you control.

### Security Notes

- `credentials.json` is listed in `.gitignore` and will never be committed
- Do not share this file or commit it to version control
- Use application-specific passwords where possible

---

## Running Tests

### Environment Configuration

Before running tests, ensure you have:
1. A valid `env-config.json` (copied from the template and customized)
2. SF CLI authenticated to the target sandbox
3. Run `./bin/setup.sh` to verify prerequisites

### Running a Single Test

```bash
./bin/run-tests.sh --env DEV --test 04
```

Expected output:

```
Loading configuration for DEV environment...
Verifying prerequisites...
  SF CLI authenticated to DevSandbox ✓
  Configuration valid ✓

Running test 04: Text body creates case with full description
  Generating .eml file...
  Generated: generated-emails/test-04-1700000000.eml
  Open in mail client? [Y/n]: Y
  Opening file...
  Press Enter after you have sent the email:
  Waiting 30s for Salesforce to process...
  Verifying Case created...
  Verifying EmailMessage linked...

[PASS] Test 04: Text body creates case with full description

Summary: Total: 1 | Passed: 1 | Failed: 0 | Errors: 0
```

### Running All Tests

```bash
./bin/run-tests.sh --env DEV
```

This runs all tests (02-35) in sequential order.

### Running Tests by Category

```bash
# Run only attachment-related tests
./bin/run-tests.sh --env DEV --category attachments

# Run only duplicate detection tests
./bin/run-tests.sh --env QA --category duplicates

# Run contact matching tests (uses SMTP)
./bin/run-tests.sh --env DEV --category contact-matching
```

Available categories:

| Category | Tests |
|----------|-------|
| `basic-creation` | 02, 03, 04, 05, 06 |
| `lifecycle` | 07, 08, 09 |
| `loop-prevention` | 10 |
| `duplicates` | 11, 12, 13, 14 |
| `attachments` | 15, 16, 17, 18, 19, 20 |
| `spam-filter` | 21 |
| `contact-matching` | 22A, 22B, 22C, 23A, 23B, 23C |
| `threading` | 24, 25, 26 |
| `long-body` | 27, 28 |
| `checksum-null` | 29 |
| `body-size` | 30, 31, 32, 33, 34, 35 |

### Stop on First Failure

```bash
./bin/run-tests.sh --env DEV --stop-on-failure
```

The framework will stop executing after the first test that returns FAIL or ERROR, rather than continuing through all remaining tests.

### Combining Options

```bash
# Run attachments category in UAT, stop on failure
./bin/run-tests.sh --env UAT --category attachments --stop-on-failure
```

### Understanding Test Results

| Status | Meaning |
|--------|---------|
| `PASS` | All verification steps matched expected outcomes |
| `FAIL` | One or more verification steps did not match expected outcomes after all retries |
| `ERROR` | A system error occurred (SMTP failure, SF CLI error, timeout) |

Example failure output:

```
[FAIL] Test 05: Attachments stored as ContentVersion records
  Step: ContentVersion count matches
  Expected: 2
  Actual: 1
```

Example error output:

```
[ERROR] Test 22A: From Name match - contact linked correctly
  Error: SMTP connection timeout after 30s
```

---

## Troubleshooting

### SF CLI Authentication Issues

**Problem**: `ERROR: The org with alias "DevSandbox" is not authenticated`

**Solution**:
```bash
# Re-authenticate to the sandbox
sf org login web --alias DevSandbox --instance-url https://test.salesforce.com

# Verify authentication
sf org display --target-org DevSandbox
```

**Problem**: `ERROR: SF CLI is not installed`

**Solution**: Install SF CLI following the instructions in the [Prerequisites](#prerequisites) section.

**Problem**: Authentication expires frequently

**Solution**: Salesforce CLI tokens expire after inactivity. Re-run `sf org login web` before your test session. If you use scratch orgs, ensure they haven't expired.

---

### Email Delivery Delays

**Problem**: Tests fail with timeout — expected records not found

**Possible causes**:
1. Salesforce is processing slowly (common in sandboxes)
2. The email was rejected by Salesforce before reaching the handler
3. Email routing is misconfigured

**Solutions**:

1. Increase timing values in `env-config.json`:
   ```json
   "timing": {
     "initialDelay": 60,
     "maxRetries": 10,
     "retryInterval": 15
   }
   ```

2. Check Salesforce's email logs:
   - Go to **Setup > Email > Email Logs**
   - Look for the test email by subject or sender

3. Verify Email-to-Case routing:
   - Go to **Setup > Feature Settings > Service > Email-to-Case**
   - Confirm the routing address is active

4. Check that the email actually arrived:
   ```bash
   sf data query --query "SELECT Id, Subject, CreatedDate FROM Case ORDER BY CreatedDate DESC LIMIT 5" \
     --target-org DevSandbox
   ```

---

### SMTP Connection Issues (Tests 22/23)

**Problem**: `ERROR: SMTP connection timeout after 30s`

**Solutions**:
1. Verify the SMTP server is reachable:
   ```bash
   nc -zv smtp.your-server.com 587
   ```
2. Check that your `credentials.json` has the correct host and port
3. Ensure your network allows outbound connections on the SMTP port
4. If behind a VPN or firewall, the SMTP port may be blocked

**Problem**: `ERROR: SMTP authentication failed`

**Solutions**:
1. Verify username and password in `credentials.json`
2. Check if the SMTP server requires an app-specific password
3. Ensure the account is not locked or rate-limited

---

### Configuration Issues

**Problem**: `ERROR: Configuration - Environment 'STAGING' not found`

**Solution**: Use one of the valid environment names: `DEV`, `QA`, or `UAT`. These are case-sensitive.

**Problem**: `ERROR: Configuration file not found`

**Solution**: Ensure `env-config.json` exists in the project root:
```bash
cp env-config.template.json env-config.json
# Then edit with your actual values
```

**Problem**: `ERROR: Invalid timing configuration`

**Solution**: Check that timing values in `env-config.json` are:
- `initialDelay`: a number >= 5
- `maxRetries`: a number between 1 and 20
- `retryInterval`: a number >= 2

---

### Test-Specific Issues

**Problem**: Duplicate detection tests (11-14) show unexpected Case counts

**Solution**: Each test uses a unique subject with `{{timestamp}}` to isolate from previous runs. If old Cases with similar subjects exist, they should not interfere. However, if you re-run a test too quickly, the timestamp may collide. Wait at least 60 seconds between re-runs of duplicate tests.

**Problem**: Contact matching tests (22/23) show wrong ContactId

**Solution**: Ensure the expected Contact exists in your sandbox with the exact name and email address expected by the test case. Query to verify:
```bash
sf data query --query "SELECT Id, FirstName, LastName, Email FROM Contact WHERE Email = 'your-email@example.com'" \
  --target-org DevSandbox
```

**Problem**: Spam filter test (21) creates a Case instead of blocking

**Solution**: Verify that `Email_Case_Filter__c` records exist with matching terms:
```bash
sf data query --query "SELECT Name, Filter_Email_Body__c FROM Email_Case_Filter__c" \
  --target-org DevSandbox
```

---

## Test Case Reference

### Test Summary Table

| Test ID | Category | Description | Send Method | Special Setup |
|---------|----------|-------------|-------------|---------------|
| 02 | basic-creation | Empty body creates Case with subject | EML | None |
| 03 | basic-creation | Empty subject creates Case with "Email Received From: sender" | EML | None |
| 04 | basic-creation | Text body stored in Case description | EML | None |
| 05 | basic-creation | Attachments stored as ContentVersion records | EML | None |
| 06 | basic-creation | Inline images stored as ContentVersion records | EML | None |
| 07 | lifecycle | Reply to closed Case reopens it (status: "Reopened") | EML | Pre-existing closed Case |
| 08 | lifecycle | Reply to open Case updates status to "Customer Replied" | EML | Pre-existing open Case |
| 09 | lifecycle | Reply with thread ID threads to Case, no new Case created | EML | Pre-existing Case |
| 10 | loop-prevention | Email from org-wide address does not create Case | EML | Org-wide email configured |
| 11 | duplicates | Exact duplicate (same subject+body+sender) creates one Case | EML | None |
| 12 | duplicates | Same subject, different body creates two Cases | EML | None |
| 13 | duplicates | Different subject, same body creates two Cases | EML | None |
| 14 | duplicates | Same content, different senders creates two Cases | EML | None |
| 15 | attachments | Small attachment (<1MB) stored with correct file size | EML | Generated test files |
| 16 | attachments | Large attachment (~5.5MB) stored with correct file size | EML | Generated test files |
| 17 | attachments | .p7s attachment silently dropped, no ContentVersion | EML | Generated test files |
| 18 | attachments | Rejected file type on reply triggers rejection email | EML | Pre-existing Case, generated test files |
| 19 | attachments | Accepted file type on reply stored, no rejection | EML | Pre-existing Case, generated test files |
| 20 | attachments | .p7s dropped, other valid attachments stored | EML | Generated test files |
| 21 | spam-filter | Spam term in subject blocks Case, creates LostEmail record | EML | Email_Case_Filter__c records |
| 22A | contact-matching | Matching From Name links correct Contact | SMTP | Known Contact, SMTP credentials |
| 22B | contact-matching | Non-matching From Name falls back to email-only match | SMTP | Known Contact, SMTP credentials |
| 22C | contact-matching | Blank From Name uses email-only matching | SMTP | Known Contact, SMTP credentials |
| 23A | contact-matching | Matching From Name links correct Contact (variant 2) | SMTP | Known Contact, SMTP credentials |
| 23B | contact-matching | Non-matching From Name falls back to email match (variant 2) | SMTP | Known Contact, SMTP credentials |
| 23C | contact-matching | Blank From Name uses email-only matching (variant 2) | SMTP | Known Contact, SMTP credentials |
| 24 | threading | Thread ID in subject threads to existing Case | EML | Pre-existing Case with thread ID |
| 25 | threading | Thread ID in body threads to existing Case | EML | Pre-existing Case with thread ID |
| 26 | threading | Invalid thread ID creates new Case | EML | None |
| 27 | long-body | 34,000 char body, single Contact match, description truncated at 32K | EML | Contact with matching email |
| 28 | long-body | 34,000 char body, multiple Contact matches | EML | Multiple Contacts, same email |
| 29 | checksum-null | Case without checksum does not prevent new Case creation | EML | Pre-existing Case (no checksum) |
| 30 | body-size | 512KB body creates Case successfully | EML | None |
| 31 | body-size | 1MB body creates Case successfully | EML | None |
| 32 | body-size | 2MB body creates Case successfully | EML | None |
| 33 | body-size | 4MB body creates Case successfully | EML | None |
| 34 | body-size | 8MB body — records whether Case is created or rejected | EML | None |
| 35 | body-size | 16MB body — records whether Case is created or rejected | EML | None |

### Category Descriptions

| Category | Purpose | Tests |
|----------|---------|-------|
| **basic-creation** | Verifies core Case creation from emails with various content | 02-06 |
| **lifecycle** | Verifies Case status changes on replies to existing Cases | 07-09 |
| **loop-prevention** | Verifies emails from org-wide addresses don't create loops | 10 |
| **duplicates** | Verifies deduplication logic based on subject, body, and sender | 11-14 |
| **attachments** | Verifies file handling: storage, size validation, type filtering | 15-20 |
| **spam-filter** | Verifies emails matching filter terms are blocked | 21 |
| **contact-matching** | Verifies Contact matching with manipulated From Name fields | 22A-23C |
| **threading** | Verifies thread ID detection in subject and body | 24-26 |
| **long-body** | Verifies handling of bodies exceeding 32K character limit | 27-28 |
| **checksum-null** | Verifies null checksum doesn't interfere with deduplication | 29 |
| **body-size** | Identifies maximum email body size the handler can process | 30-35 |

---

## Project Structure

```
email-handler-testing/
├── README.md                          # This file
├── AGENTS.md                          # AI agent steering configuration
├── package.json                       # Node.js dependencies and scripts
├── env-config.template.json           # Template — copy to env-config.json
├── credentials.template.json          # Template — copy to credentials.json
│
├── bin/                               # Shell scripts (executable)
│   ├── run-tests.sh                   # Main test runner
│   ├── run-single-test.sh             # Run a single test by ID
│   ├── setup.sh                       # Dependency check & npm install
│   ├── verify-prerequisites.sh        # Pre-test validation
│   └── generate-test-data.sh          # Generate attachment test files
│
├── src/                               # Node.js modules
│   ├── eml-generator.js               # RFC 5322 .eml file creation
│   ├── smtp-sender.js                 # SMTP sending (tests 22/23 only)
│   ├── attachment-generator.js        # Test file generation
│   ├── config-loader.js               # Config loading & validation
│   ├── body-generator.js              # Large email body generation
│   └── utils/
│       ├── mime-helpers.js             # MIME encoding utilities
│       └── validators.js              # Schema validation
│
├── lib/                               # Shell utility functions
│   ├── config.sh                      # Config loading for shell
│   ├── soql-queries.sh                # SOQL query templates
│   ├── retry.sh                       # Retry/polling logic
│   ├── reporting.sh                   # Output formatting
│   └── test-setup.sh                  # Precondition data creation
│
├── tests/                             # Test case definitions
│   ├── categories.json                # Category-to-test mapping
│   └── cases/                         # One JSON file per test case
│       ├── test-02-empty-body.json
│       ├── test-03-empty-subject.json
│       └── ... (test-04 through test-35)
│
├── config/                            # Configuration schema
│   └── schema.json                    # JSON Schema for env-config
│
└── generated-emails/                  # Output directory (gitignored)
    └── attachments/                   # Generated test attachment files
```

---

## License

ISC
