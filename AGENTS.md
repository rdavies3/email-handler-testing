# AI Agent Steering Configuration

## Project Context

This is an automated testing framework for a Salesforce Email-to-Case handler (`CaseInboundEmailHandler.cls`). The framework generates test emails, orchestrates their delivery, and verifies expected outcomes in Salesforce via SF CLI SOQL queries.

## Architecture

- **Shell scripts** (`bin/`, `lib/`): Test orchestration, user prompts, SF CLI invocation, retry logic
- **Node.js modules** (`src/`): EML file generation, SMTP sending (tests 22/23 only), config validation, attachment generation
- **Test definitions** (`tests/cases/`): JSON files defining test inputs and expected Salesforce outcomes
- **Configuration** (project root): JSON files for environment settings and credentials

## Key Conventions

- Shell scripts use bash/zsh and must be executable (`chmod +x`)
- Node.js modules use CommonJS (`require`/`module.exports`)
- All configuration is JSON-based (no YAML, no TOML)
- SF CLI is the only interface to Salesforce (no REST API, no JSforce)
- Test case JSON files use template variables: `{{primary_email}}`, `{{timestamp}}`, `{{caseId}}`

## File Naming

- Shell scripts: `kebab-case.sh`
- Node.js modules: `kebab-case.js`
- Test cases: `test-XX-description.json` (XX = zero-padded test number)
- Shell library functions: `kebab-case.sh`

## Testing

- Node.js unit tests use Vitest and live alongside source in `*.test.js` files
- Shell tests use bats (Bash Automated Testing System)
- The test case JSON files ARE the integration tests (they exercise the real Salesforce handler)
- Property-based testing does not apply to this project

## Dependencies

- **Runtime**: SF CLI (v2+), Node.js (v18+), macOS built-in tools (bash, zsh, curl, grep, sed, awk)
- **Node.js packages**: `nodemailer` (SMTP sending)
- **Dev packages**: `vitest` (unit testing)

## Important Notes

- Never commit `credentials.json` or `env-config.json` (they contain secrets and environment-specific data)
- Generated .eml files go in `generated-emails/` (gitignored)
- Tests 22/23 use a Manipulated SMTP server; all other tests generate .eml files for manual sending
- Each test case must have a unique subject line using `{{timestamp}}` for isolation
