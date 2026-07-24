---
description: Environment-specific defaults for email routing, org aliases, and config generation
inclusion: auto
---

# Environment Defaults

These values should be used automatically when generating configuration or running tests. Do not prompt the user for these unless they explicitly ask to change them.

## Email-to-Case Routing Addresses

Pattern: `{env}_sandbox@asu.edu` (primary), `{env}_sandbox1@asu.edu` (secondary), `{env}_sandbox2@asu.edu` (tertiary).

| Environment | Primary | Secondary | Tertiary |
|-------------|---------|-----------|----------|
| DEV | dev_sandbox@asu.edu | dev_sandbox1@asu.edu | dev_sandbox2@asu.edu |
| QA | qa_sandbox@asu.edu | qa_sandbox1@asu.edu | qa_sandbox2@asu.edu |
| UAT | uat_sandbox@asu.edu | uat_sandbox1@asu.edu | uat_sandbox2@asu.edu |

## Org-Wide Email Address

The org-wide email address (From address on outbound case emails, used in loop-prevention test 10) is always the **primary** address for that environment:

- DEV: dev_sandbox@asu.edu
- QA: qa_sandbox@asu.edu
- UAT: uat_sandbox@asu.edu

## SF CLI Org Aliases

| Environment | Alias | Username | Instance |
|-------------|-------|----------|----------|
| DEV | EntDevSB | rdavies3@asu.edu.dev | asu--dev.sandbox.my.salesforce.com |
| QA | EntQaSB | rdavies3@asu.edu.qa | asu--qa.sandbox.my.salesforce.com |
| UAT | EntUatSB | rdavies3@asu.edu.uat | asu--uat.sandbox.my.salesforce.com |

## Credentials Handling

SMTP credentials and other secrets must NEVER be collected via chat. When credentials need to be added or updated:
1. Create the credentials file with placeholder values
2. Open the file in the editor for the user to fill in directly
3. Instruct the user to save when done, then validate the file

This applies to `credentials.json` and any other file containing passwords, tokens, or API keys.

## External Config Directory

Configuration is stored outside the repository. The user chooses the path during setup. Common options:

- **Keybase (portable):** `/Volumes/Keybase/private/<username>/`
- **Local:** `~/.config/email-handler-testing/`

The current path is stored in `.config-path` in the project root. If the path is not accessible, prompt the user to either mount the volume (Keybase) or verify the directory exists (local).

## Standard SMTP (ASU Gmail)

All tests (except 22/23) are sent via `smtp.gmail.com` using a Gmail App Password.

- Host: smtp.gmail.com
- Port: 587
- Secure: false (uses STARTTLS)
- Username: user's ASURITE@asu.edu
- Password: Gmail App Password (NOT the ASURITE password)

To set up a Gmail App Password:
1. Enable 2-Step Verification: https://myaccount.google.com/signinoptions/two-step-verification
2. Create App Password: https://myaccount.google.com/apppasswords

The `senderEmail` in credentials.json is the user's personal ASU email (the "From" address on test emails).

## Manipulated SMTP

Tests 22/23 (contact-matching via From Name) use a separate SMTP server configured in `manipulatedSmtp`. This allows controlling the From display name independently.

## Default Timing Settings

- Initial delay: 30 seconds
- Max retries: 5
- Retry interval: 10 seconds

## Default Attachment & Spam Settings

- Accepted attachment types: `.txt`, `.pdf`, `.png`, `.jpg`, `.docx`, `.xlsx`
- Spam filter terms: `UNSUBSCRIBE`, `FREE OFFER`
