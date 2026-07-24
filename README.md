# Email Handler Testing Framework

Automated testing framework for validating a Salesforce Email-to-Case handler (`CaseInboundEmailHandler.cls`). The framework sends test emails via SMTP, orchestrates their delivery to Salesforce sandbox environments, and verifies expected outcomes via SF CLI SOQL queries.

## Getting Started

This project is designed to be set up interactively with the Kiro AI agent. Open the project in Kiro and use the following prompt to get started:

> **"Help me set up the email handler testing framework."**

The agent will walk you through:
1. Checking prerequisites (Node.js, SF CLI)
2. Authenticating to your Salesforce sandbox(es)
3. Choosing where to store config files (Keybase or local)
4. Creating your environment and credentials configuration
5. Validating everything works

Once set up, run the full test suite with:

> **"Run all tests against DEV."**

The rest of this README covers how things work under the hood — useful if you want to understand the architecture, troubleshoot, or run things manually.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Manual)](#quick-start-manual)
- [Configuration](#configuration)
- [Salesforce Configuration](#salesforce-configuration)
- [Credentials Setup](#credentials-setup)
- [Running Tests](#running-tests)
- [How Verification Works](#how-verification-works)
- [Troubleshooting](#troubleshooting)
- [Test Case Reference](#test-case-reference)
- [Project Structure](#project-structure)

---

## Prerequisites

The following software must be installed on your Mac before using this framework.

| Software | Minimum Version | Purpose |
|----------|----------------|---------|
| macOS | 13 (Ventura) | Operating system |
| Homebrew | any | Installing other tools |
| Salesforce CLI (sf) | 2.0 | Querying Salesforce, creating test data |
| Node.js | 18.0 | SMTP sending, config validation, report generation |

### Installing Prerequisites

```bash
# Check/install Homebrew
which brew || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node

# Install Salesforce CLI
brew install sf

# Verify
node --version   # v18+ required
sf --version     # @salesforce/cli/2.x.x required
```

### Install Node.js Dependencies

```bash
cd email-handler-testing
npm install
```

---

## Quick Start (Manual)

```bash
# 1. Clone the repository
git clone <repository-url>
cd email-handler-testing

# 2. Install dependencies
npm install

# 3. Set up external configuration (interactive — see Configuration section)
# The Kiro setup agent walks you through this interactively

# 4. Authenticate SF CLI to your sandbox(es)
sf org login web --alias EntDevSB --instance-url https://asu--dev.sandbox.my.salesforce.com/
sf org login web --alias EntQaSB --instance-url https://asu--qa.sandbox.my.salesforce.com/
sf org login web --alias EntUatSB --instance-url https://asu--uat.sandbox.my.salesforce.com/

# 5. Run tests interactively via Kiro test execution agent
# Or run a single test directly:
node src/smtp-sender.js --test-case tests/cases/test-04-text-body.json \
  --env-config /path/to/env-config.json \
  --credentials /path/to/credentials.json \
  --env DEV --mode standard
```

---

## Configuration

Configuration files are stored **outside** the repository to protect credentials. A pointer file (`.config-path`) tells the framework where to find them.

### Config Directory Options

You can store your config files wherever makes sense for your workflow:

| Option | Path | Best for |
|--------|------|----------|
| **Keybase (recommended)** | `/Volumes/Keybase/private/<username>/` | Encrypted, syncs across machines |
| **Local user config** | `~/.config/email-handler-testing/` | Simple local setup, no extra tools |

Both options keep credentials out of the repo. Keybase is nice if you code on multiple machines — the config follows you. Otherwise `~/.config/` works perfectly.

### Config Directory Contents

| File | Purpose |
|------|---------|
| `env-config.json` | Environment-specific settings (email addresses, org aliases, timing) |
| `credentials.json` | SMTP credentials (Gmail App Password, manipulated SMTP) |

### Setting Up the Config Pointer

```bash
# Option A: Keybase (encrypted, portable across machines)
node src/config-resolver.js --set "/Volumes/Keybase/private/yourname/"

# Option B: Local ~/.config directory
mkdir -p ~/.config/email-handler-testing
node src/config-resolver.js --set ~/.config/email-handler-testing/

# Validate the pointer and config files
node src/config-resolver.js --validate
```

### Environment Configuration (env-config.json)

Each environment (DEV, QA, UAT) has:

| Field | Description |
|-------|-------------|
| `emailAddresses.primary` | Main Email-to-Case routing address |
| `emailAddresses.secondary` | Secondary routing address |
| `emailAddresses.tertiary` | Tertiary routing address |
| `orgAlias` | SF CLI alias for this org |
| `orgWideEmailAddress` | Org-wide email (used for loop prevention) |
| `acceptedAttachmentTypes` | File extensions the handler accepts |
| `spamFilterTerms` | Keywords that block Case creation |
| `timing` | `initialDelay`, `maxRetries`, `retryInterval` for polling |

#### Email Address Convention

| Environment | Primary | Secondary | Tertiary |
|-------------|---------|-----------|----------|
| DEV | dev_sandbox@asu.edu | dev_sandbox1@asu.edu | dev_sandbox2@asu.edu |
| QA | qa_sandbox@asu.edu | qa_sandbox1@asu.edu | qa_sandbox2@asu.edu |
| UAT | uat_sandbox@asu.edu | uat_sandbox1@asu.edu | uat_sandbox2@asu.edu |

#### SF CLI Org Alias Mapping

| Environment | Alias | Login URL |
|-------------|-------|-----------|
| DEV | EntDevSB | https://asu--dev.sandbox.my.salesforce.com/ |
| QA | EntQaSB | https://asu--qa.sandbox.my.salesforce.com/ |
| UAT | EntUatSB | https://asu--uat.sandbox.my.salesforce.com/ |

### Validating Configuration

```bash
# Validate config resolution (pointer + file existence)
node src/config-resolver.js --validate

# Validate config loading for a specific environment
node src/config-loader.js --env DEV \
  --config /path/to/env-config.json \
  --credentials /path/to/credentials.json
```

---

## Salesforce Configuration

### Authenticating SF CLI

```bash
# Authenticate to each sandbox (use the instance URL for your sandbox)
sf org login web --alias EntDevSB --instance-url https://asu--dev.sandbox.my.salesforce.com/
sf org login web --alias EntQaSB --instance-url https://asu--qa.sandbox.my.salesforce.com/
sf org login web --alias EntUatSB --instance-url https://asu--uat.sandbox.my.salesforce.com/

# Verify authentication
sf org display --target-org EntDevSB --json
```

### Email-to-Case Routing

Verify that Email-to-Case is configured in your sandbox:

1. **Setup > Feature Settings > Service > Email-to-Case** — ensure enabled
2. Routing addresses must match the `emailAddresses` in your `env-config.json`
3. The routing address must point to your `CaseInboundEmailHandler` Apex class

### Test Contacts

Several tests require specific Contacts:

```bash
# Create Contacts for contact-matching tests (22/23)
sf data create record --sobject Contact \
  --values "FirstName='Test' LastName='Contact Alpha' Email='salesforce@carl.me'" \
  --target-org EntDevSB

sf data create record --sobject Contact \
  --values "FirstName='Test' LastName='Contact Beta' Email='salesforce@carl.me'" \
  --target-org EntDevSB
```

### Org-Wide Email Address

Test 10 (loop prevention) uses the org-wide email address. Verify in **Setup > Email > Organization-Wide Addresses**.

---

## Credentials Setup

Credentials are stored in `credentials.json` in the external config directory.

### Structure

```json
{
  "senderEmail": "yourname@asu.edu",
  "standardSmtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "secure": false,
    "auth": {
      "username": "yourname@asu.edu",
      "password": "YOUR_GMAIL_APP_PASSWORD"
    }
  },
  "manipulatedSmtp": {
    "host": "mail.carl.me",
    "port": 465,
    "secure": false,
    "auth": {
      "username": "salesforce@carl.me",
      "password": "YOUR_SMTP_PASSWORD"
    }
  }
}
```

### SMTP Modes

| Mode | Config Block | Used By | Purpose |
|------|-------------|---------|---------|
| `standard` | `standardSmtp` | Tests 02-21, 24-35 | Send from authenticated Gmail account |
| `manipulated` | `manipulatedSmtp` | Tests 10, 14, 22A-23C | Control From header (name/address spoofing) |

### Gmail App Password Setup

The standard SMTP uses Gmail with an App Password (NOT your regular password):

1. **Enable 2-Step Verification**: https://myaccount.google.com/signinoptions/two-step-verification
2. **Create App Password**: https://myaccount.google.com/apppasswords — name it "Email Testing"
3. Paste the 16-character password into `credentials.json`

### Port 465 Auto-Secure

The smtp-sender automatically forces `secure: true` when port 465 is configured, regardless of the `secure` field in credentials. This means you can leave `"secure": false` in the config — port 465 always uses implicit TLS.

### Security Notes

- `credentials.json` is stored on an encrypted volume outside the repo
- Never commit credentials to version control
- The `.config-path` pointer file IS committed (it contains only a directory path)

---

## Running Tests

### All Tests via SMTP

All 36 tests are sent via SMTP. The `smtp-sender.js` module handles email delivery and returns a JSON result with the generated timestamp for immediate verification:

```bash
node src/smtp-sender.js \
  --test-case tests/cases/test-04-text-body.json \
  --env-config /path/to/env-config.json \
  --credentials /path/to/credentials.json \
  --env DEV \
  --mode standard
```

Output:
```json
{"success":true,"messageId":"<abc@asu.edu>","subject":"Test-04-1784847763576","timestamp":"1784847763576"}
```

The `timestamp` and `subject` fields allow immediate SOQL verification without guessing:

```bash
sf data query --query "SELECT Id, Subject FROM Case WHERE Subject = 'Test-04-1784847763576'" \
  --target-org EntDevSB --json
```

### Interactive Test Execution (Kiro Agent)

The recommended way to run tests is via the Kiro test execution agent, which handles:
- Sending emails via the appropriate SMTP mode
- Creating precondition Cases (for lifecycle/threading tests)
- Polling Salesforce for results
- Evaluating assertions
- Generating PDF reports

### Multi-Email Tests

Tests with an `emails` array (e.g., test 11 for dedup, test 14 for different senders) are handled natively by the smtp-sender. It sends each email with a configurable `sendDelay` between them and shares a single timestamp across the batch.

### Test Modes by Category

| Category | SMTP Mode | Notes |
|----------|-----------|-------|
| basic-creation (02-06) | standard | |
| lifecycle (07-09) | standard | Requires precondition Cases with thread IDs |
| loop-prevention (10) | **manipulated** | Spoofs From as org-wide address |
| duplicates (11-13) | standard | Multiple emails per test |
| duplicates (14) | **manipulated** | Requires different From addresses |
| attachments (15-20) | standard | Some require precondition Cases |
| spam-filter (21) | standard | |
| contact-matching (22-23) | **manipulated** | Controls From display name |
| threading (24-26) | standard | Requires precondition Cases |
| long-body (27-28) | standard | Uses large generated bodies |
| checksum-null (29) | standard | Requires precondition CLI-created Case |
| body-size (30-35) | standard | 512KB through 16MB bodies |

---

## How Verification Works

After sending an email, the framework queries Salesforce to verify the handler processed it correctly.

### Case Creation Verification

```bash
sf data query --query "SELECT Id, Subject, CaseNumber FROM Case WHERE Subject = 'Test-XX-{{timestamp}}'" \
  --target-org EntDevSB --json
```

### Attachment Verification

**Important:** The handler stores attachments as `Attachment` records on the **Case** (not on the EmailMessage). This is a key distinction:

```sql
-- CORRECT: Attachments are children of the Case
SELECT Id, Name, BodyLength FROM Attachment WHERE ParentId = '<CaseId>'

-- WRONG: Attachments are NOT on the EmailMessage
SELECT Id FROM Attachment WHERE ParentId IN (SELECT Id FROM EmailMessage WHERE ParentId = '<CaseId>')
```

The `EmailMessage.HasAttachment` field will show `false` even when attachments exist on the Case. Always query `Attachment WHERE ParentId = CaseId` directly.

#### Inline Images (CID)

Inline images embedded via `cid:` references in HTML are **not** stored as Attachment records. Only MIME-attached files are extracted by the handler. This is confirmed handler behavior (Test 06).

### Threading Verification

The handler recognizes thread IDs in both subject and body:
- **Subject**: `ref:_XXXXX._YYYYY:ref` anywhere in the subject line
- **Body**: `ref:_XXXXX._YYYYY:ref` in the email body text

Thread IDs are stored on Cases in the `Thread_Id__c` custom field.

### Deduplication Verification

The handler deduplicates based on a combination of subject + body + sender address. Emails with identical content from the same sender produce only one Case. Different subjects, different bodies, or different senders each result in separate Cases.

### Polling Strategy

Salesforce processing takes 15-60 seconds. The framework uses:
- **Initial delay**: 30 seconds (configurable)
- **Retry polling**: Up to 5 attempts, 10 seconds apart
- **Large emails**: May take 2-5 minutes (especially body-size tests 30-35)

---

## Troubleshooting

### SF CLI Authentication Issues

```bash
# Re-authenticate
sf org login web --alias EntDevSB --instance-url https://asu--dev.sandbox.my.salesforce.com/

# Verify
sf org display --target-org EntDevSB --json
```

### SMTP Connection Timeout

**Port 465 (manipulated SMTP):** The smtp-sender auto-forces `secure: true` for port 465. If you still get timeouts:

```bash
# Check connectivity
nc -z -w 5 mail.carl.me 465

# Check for firewall/VPN blocking
```

**Port 587 (Gmail):** Ensure your App Password is valid. Gmail may revoke App Passwords if 2-Step Verification is disabled.

### Configuration Not Found

```bash
# Check config pointer
cat .config-path

# Verify the path is accessible
node src/config-resolver.js --validate

# Common issues:
# - Keybase users: volume not mounted (open Keybase app first)
# - Local users: ~/.config/email-handler-testing/ directory doesn't exist
```

### Attachments Not Found in Verification

If SOQL returns no attachments, ensure you're querying the **Case** as ParentId:

```bash
# First get the Case ID
sf data query --query "SELECT Id FROM Case WHERE Subject = 'Test-15-...'" --target-org EntDevSB --json

# Then query Attachments on the Case (NOT the EmailMessage)
sf data query --query "SELECT Id, Name, BodyLength FROM Attachment WHERE ParentId = '<CaseId>'" --target-org EntDevSB --json
```

### Body-Size Tests Processing Slowly

Tests 30-35 send bodies from 512KB to 16MB. Salesforce may take 2-5 minutes to process larger emails. The smaller emails (30-32) sometimes arrive *after* larger ones (33-35) due to Salesforce's email processing queue ordering. This is normal — just wait longer.

### Duplicate Detection Interference

If you run the same body-size tests multiple times in one day, deduplication may kick in (the handler checksums the body). Use unique body content for each run, or wait for the dedup window to expire.

---

## Test Case Reference

### Test Summary Table

| Test ID | Category | Description | SMTP Mode | Special Setup |
|---------|----------|-------------|-----------|---------------|
| 02 | basic-creation | Empty body creates Case with subject | standard | None |
| 03 | basic-creation | Empty subject → "Email Received From: sender" | standard | None |
| 04 | basic-creation | Text body stored in Case.Description | standard | None |
| 05 | basic-creation | Attachments stored as Attachment records on Case | standard | None |
| 06 | basic-creation | Inline images (CID) — NOT stored by handler | standard | None |
| 07 | lifecycle | Reply to closed Case — creates new Case | standard | Closed Case precondition |
| 08 | lifecycle | Reply to open Case — status transition | standard | Open Case precondition |
| 09 | lifecycle | Reply with thread ID — no new Case | standard | Case precondition |
| 10 | loop-prevention | Email from org-wide address blocked | **manipulated** | Org-wide email configured |
| 11 | duplicates | Exact duplicate → 1 Case | standard | None |
| 12 | duplicates | Same subject, diff body → 2 Cases | standard | None |
| 13 | duplicates | Diff subject, same body → 2 Cases | standard | None |
| 14 | duplicates | Same content, diff senders → 2 Cases | **manipulated** | None |
| 15 | attachments | Small .txt attachment stored on Case | standard | Generated test files |
| 16 | attachments | Large .pdf attachment stored on Case | standard | Generated test files |
| 17 | attachments | .p7s attachment silently dropped | standard | Generated test files |
| 18 | attachments | Rejected type (.xyz) on reply → email dropped | standard | Case precondition |
| 19 | attachments | Accepted type (.txt) on reply → stored on Case | standard | Case precondition |
| 20 | attachments | .p7s dropped, valid attachment kept | standard | Generated test files |
| 21 | spam-filter | Spam term in subject blocks Case creation | standard | Spam filter records |
| 22A | contact-matching | Matching From Name → correct Contact | **manipulated** | Contact precondition |
| 22B | contact-matching | Non-matching From Name → new Contact created | **manipulated** | Contact precondition |
| 22C | contact-matching | Blank From Name → email-only match | **manipulated** | Contact precondition |
| 23A | contact-matching | Matching From Name (variant 2) | **manipulated** | Contact precondition |
| 23B | contact-matching | Non-matching From Name (variant 2) | **manipulated** | Contact precondition |
| 23C | contact-matching | Blank From Name (variant 2) | **manipulated** | Contact precondition |
| 24 | threading | Thread ID in subject → threads to Case | standard | Case precondition |
| 25 | threading | Thread ID in body → threads to Case | standard | Case precondition |
| 26 | threading | Invalid thread ID → new Case | standard | None |
| 27 | long-body | 34K char body — truncated in Description | standard | None |
| 28 | long-body | 34K char body — multiple Contact match | standard | Multiple Contacts |
| 29 | checksum-null | CLI-created Case (null checksum) doesn't block new Case | standard | CLI Case precondition |
| 30 | body-size | 512KB body → Case created | standard | None |
| 31 | body-size | 1MB body → Case created | standard | None |
| 32 | body-size | 2MB body → Case created | standard | None |
| 33 | body-size | 4MB body → Case created | standard | None |
| 34 | body-size | 8MB body → Case created | standard | None |
| 35 | body-size | 16MB body → Case created | standard | None |

---

## Project Structure

```
email-handler-testing/
├── README.md                          # This file
├── AGENTS.md                          # AI agent steering configuration
├── package.json                       # Node.js dependencies and scripts
├── .config-path                       # Pointer to external config directory
├── env-config.template.json           # Template for env-config.json
├── credentials.template.json          # Template for credentials.json
│
├── src/                               # Node.js modules
│   ├── smtp-sender.js                 # SMTP sending (all tests)
│   ├── eml-generator.js               # EML file creation (legacy)
│   ├── config-loader.js               # Config loading & validation
│   ├── config-resolver.js             # External config path resolution
│   ├── report-generator.js            # PDF report generation
│   ├── attachment-generator.js        # Test file generation
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
│   └── cases/                         # One JSON file per test case
│       ├── test-02-empty-body.json
│       └── ... (test-03 through test-35)
│
├── config/                            # Configuration schema
│   └── schema.json                    # JSON Schema for env-config
│
└── generated-emails/                  # Output directory (gitignored)
    ├── attachments/                   # Generated test attachment files
    ├── session-YYYY-MM-DD.json        # Session results JSON (input to report generator)
    └── test-report-ENV-YYYY-MM-DD.pdf # Generated PDF reports
```

---

## PDF Reports

After a test session, the framework generates a PDF report from a session JSON file.

### Session JSON File

The session JSON (`generated-emails/session-YYYY-MM-DD.json`) captures all test results and is the input to the PDF generator. Structure:

```json
{
  "environment": "DEV",
  "orgAlias": "EntDevSB",
  "instanceUrl": "https://asu--dev.sandbox.lightning.force.com",
  "date": "2026-07-23",
  "duration": "~40 minutes",
  "results": [
    {
      "id": "02",
      "name": "Empty body creates case with subject",
      "status": "PASS",
      "caseId": "500W400000lC7c9IAC",
      "caseNumber": "35821079",
      "note": null
    }
  ],
  "rootCauses": [
    {
      "category": "Category Name",
      "description": "Explanation of the failure pattern.",
      "tests": "05, 06, 15"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `environment` | Target environment name (DEV, QA, UAT) |
| `orgAlias` | SF CLI alias used for queries |
| `instanceUrl` | Lightning base URL — used to generate clickable Case links in the PDF |
| `date` | Session date (YYYY-MM-DD) |
| `duration` | Approximate session duration |
| `results[]` | Array of per-test outcomes |
| `results[].id` | Test ID (e.g., "02", "22A") |
| `results[].status` | "PASS", "FAIL", or "ERROR" |
| `results[].caseId` | 18-char Salesforce Case ID (null if no Case found) |
| `results[].caseNumber` | Human-readable Case Number (null if unavailable) |
| `results[].note` | Optional context about the result |
| `rootCauses[]` | Grouped failure analysis |

The PDF renders each `caseId` as a clickable hyperlink to `{instanceUrl}/lightning/r/Case/{caseId}/view`.

### Generating the PDF

```bash
node src/report-generator.js \
  --input generated-emails/session-2026-07-23.json \
  --output generated-emails/test-report-DEV-2026-07-23.pdf
```

### Output Location

Both files live in `generated-emails/` which is gitignored:
- `generated-emails/session-YYYY-MM-DD.json` — raw results data
- `generated-emails/test-report-ENV-YYYY-MM-DD.pdf` — formatted PDF report

The PDF includes:
- Pass/fail summary with counts
- Per-test results table with Case numbers
- Clickable links to each Case in Salesforce Lightning
- Root cause analysis section grouping related failures

---

## License

ISC
