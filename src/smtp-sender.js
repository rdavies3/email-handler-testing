'use strict';

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { loadJsonFile } = require('./config-loader');

/**
 * Parse CLI arguments for smtp-sender.
 * @param {string[]} args - Process argv (from index 2)
 * @returns {{ testCase: string|null, envConfig: string|null, credentials: string|null, mode: string, env: string|null }}
 */
function parseArgs(args) {
  const result = { testCase: null, envConfig: null, credentials: null, mode: 'standard', env: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--test-case':
        result.testCase = args[++i] || null;
        break;
      case '--env-config':
        result.envConfig = args[++i] || null;
        break;
      case '--credentials':
        result.credentials = args[++i] || null;
        break;
      case '--mode':
        result.mode = args[++i] || 'standard';
        break;
      case '--env':
        result.env = args[++i] || null;
        break;
    }
  }
  return result;
}

/**
 * Load and validate SMTP credentials from credentials.json.
 * @param {string} credentialsPath - Path to credentials.json
 * @param {string} [mode='standard'] - Which SMTP config to load: 'standard' or 'manipulated'
 * @returns {{ smtp: object|null, senderEmail: string|null, error: string|null }}
 */
function loadCredentials(credentialsPath, mode) {
  const smtpMode = mode || 'standard';
  const result = loadJsonFile(credentialsPath);
  if (result.error) {
    return { smtp: null, senderEmail: null, error: result.error };
  }

  const creds = result.data;

  // Resolve sender email
  const senderEmail = creds.senderEmail || null;

  // Determine which SMTP block to use
  const blockName = smtpMode === 'manipulated' ? 'manipulatedSmtp' : 'standardSmtp';
  if (!creds[blockName] || typeof creds[blockName] !== 'object') {
    return { smtp: null, senderEmail, error: `Missing ${blockName} section in credentials` };
  }

  const smtp = creds[blockName];
  if (!smtp.host || typeof smtp.host !== 'string') {
    return { smtp: null, senderEmail, error: `${blockName}.host is required and must be a string` };
  }
  if (smtp.port === undefined || typeof smtp.port !== 'number') {
    return { smtp: null, senderEmail, error: `${blockName}.port is required and must be a number` };
  }
  if (!smtp.auth || !smtp.auth.username || !smtp.auth.password) {
    return { smtp: null, senderEmail, error: `${blockName}.auth with username and password is required` };
  }

  return { smtp, senderEmail, error: null };
}

/**
 * Load test case JSON file.
 * @param {string} testCasePath - Path to test case JSON
 * @returns {{ testCase: object|null, error: string|null }}
 */
function loadTestCase(testCasePath) {
  const result = loadJsonFile(testCasePath);
  if (result.error) {
    return { testCase: null, error: result.error };
  }
  return { testCase: result.data, error: null };
}

/**
 * Load env-config and resolve the first available environment for sender info.
 * @param {string} envConfigPath - Path to env-config.json
 * @returns {{ config: object|null, error: string|null }}
 */
function loadEnvConfig(envConfigPath) {
  const result = loadJsonFile(envConfigPath);
  if (result.error) {
    return { config: null, error: result.error };
  }
  return { config: result.data, error: null };
}

/**
 * Resolve the sender email address.
 * In standard mode, uses senderEmail from credentials.
 * In manipulated mode, falls back to first environment's primary email.
 * @param {object} envConfig - Parsed env-config object
 * @param {string|null} senderEmail - The senderEmail from credentials (if available)
 * @returns {string} The sender email address
 */
function resolveSenderAddress(envConfig, senderEmail) {
  // Prefer explicit senderEmail from credentials
  if (senderEmail) {
    return senderEmail;
  }

  // Fallback: use first environment's primary email
  if (!envConfig.environments) {
    return 'test-sender@example.com';
  }
  const envNames = Object.keys(envConfig.environments);
  if (envNames.length === 0) {
    return 'test-sender@example.com';
  }
  const firstEnv = envConfig.environments[envNames[0]];
  if (firstEnv && firstEnv.emailAddresses && firstEnv.emailAddresses.primary) {
    return firstEnv.emailAddresses.primary;
  }
  return 'test-sender@example.com';
}

/**
 * Resolve the recipient email address from env-config.
 * Uses the specified environment's primary email, or falls back to first environment.
 * @param {object} envConfig - Parsed env-config object
 * @param {string|null} [envName] - Target environment name (DEV, QA, UAT)
 * @returns {string} The recipient email address
 */
function resolveRecipientAddress(envConfig, envName) {
  if (!envConfig.environments) {
    return 'recipient@example.com';
  }

  // If envName specified and exists, use that
  if (envName && envConfig.environments[envName]) {
    const env = envConfig.environments[envName];
    if (env.emailAddresses && env.emailAddresses.primary) {
      return env.emailAddresses.primary;
    }
  }

  // Fallback: first environment
  const envNames = Object.keys(envConfig.environments);
  if (envNames.length === 0) {
    return 'recipient@example.com';
  }
  const firstEnv = envConfig.environments[envNames[0]];
  if (firstEnv && firstEnv.emailAddresses && firstEnv.emailAddresses.primary) {
    return firstEnv.emailAddresses.primary;
  }
  return 'recipient@example.com';
}

/**
 * Resolve a template email address variable against the env config.
 * Supports: {{org_wide_email}}, {{secondary_email}}, {{tertiary_email}}, {{primary_email}}
 * If the value is not a template, returns it unchanged.
 * @param {string} address - The address (possibly a template variable)
 * @param {object} envConfig - Parsed env-config object
 * @param {string|null} envName - Target environment name
 * @returns {string} The resolved email address
 */
function resolveTemplateAddress(address, envConfig, envName) {
  if (!address || !address.startsWith('{{')) return address;

  const env = (envConfig && envConfig.environments && envName)
    ? envConfig.environments[envName]
    : null;

  switch (address) {
    case '{{org_wide_email}}':
      return (env && env.orgWideEmailAddress) || (env && env.emailAddresses && env.emailAddresses.primary) || address;
    case '{{primary_email}}':
      return (env && env.emailAddresses && env.emailAddresses.primary) || address;
    case '{{secondary_email}}':
      return (env && env.emailAddresses && env.emailAddresses.secondary) || address;
    case '{{tertiary_email}}':
      return (env && env.emailAddresses && env.emailAddresses.tertiary) || address;
    default:
      return address;
  }
}

/**
 * Build the From header value based on test case fromNameOverride.
 * @param {*} fromNameOverride - The fromNameOverride value from test case
 * @param {string} senderAddress - The sender email address
 * @returns {string} The formatted From header value
 */
function buildFromHeader(fromNameOverride, senderAddress) {
  if (fromNameOverride === null || fromNameOverride === undefined) {
    // Use default sender name
    return `Test Sender <${senderAddress}>`;
  }
  if (fromNameOverride === '') {
    // Blank From Name — no display name
    return senderAddress;
  }
  // Custom display name (1-255 chars)
  const name = String(fromNameOverride).slice(0, 255);
  return `${name} <${senderAddress}>`;
}

/**
 * Create a nodemailer transport configured for the Manipulated SMTP server.
 * @param {object} smtpConfig - The manipulatedSmtp config object
 * @returns {object} Nodemailer transport instance
 */
function createTransport(smtpConfig) {
  // Port 465 always uses implicit TLS regardless of the secure flag in config
  const isSecure = smtpConfig.port === 465 ? true : (smtpConfig.secure || false);
  const transportOptions = {
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: isSecure,
    auth: {
      user: smtpConfig.auth.username,
      pass: smtpConfig.auth.password,
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  };

  // If not secure and port is typically STARTTLS (587), enable STARTTLS
  if (!smtpConfig.secure && smtpConfig.port === 587) {
    transportOptions.requireTLS = true;
  }

  // Allow self-signed certs for test servers
  transportOptions.tls = {
    rejectUnauthorized: false,
  };

  return nodemailer.createTransport(transportOptions);
}

/**
 * Send an email via SMTP (standard or manipulated).
 * @param {object} options
 * @param {object} options.smtpConfig - SMTP credentials (standard or manipulated)
 * @param {object} options.testCase - Parsed test case JSON
 * @param {object} options.envConfig - Parsed env-config object
 * @param {string|null} [options.senderEmail] - Explicit sender email from credentials
 * @param {string|null} [options.envName] - Target environment name for recipient resolution
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string, message?: string }>}
 */
async function sendEmail({ smtpConfig, testCase, envConfig, senderEmail, envName }) {
  const senderAddress = resolveSenderAddress(envConfig, senderEmail || null);
  // Envelope sender must be the SMTP auth user (what the server allows)
  const envelopeSender = smtpConfig.auth.username || senderAddress;

  // Handle multi-email test cases (e.g., duplicate detection tests)
  if (Array.isArray(testCase.emails) && testCase.emails.length > 0) {
    return sendMultipleEmails({ smtpConfig, testCase, envConfig, senderAddress, envelopeSender, envName });
  }

  const emailProps = testCase.emailProperties || {};

  // Resolve recipient — use test case 'to' or fall back to env-config
  let recipient = emailProps.to || resolveRecipientAddress(envConfig, envName || null);
  // Replace template variables if present
  if (recipient.includes('{{primary_email}}')) {
    recipient = resolveRecipientAddress(envConfig, envName || null);
  }

  // Build the From header based on fromNameOverride or explicit from address
  const fromNameOverride = emailProps.fromNameOverride;
  let fromAddress = senderAddress;
  // If emailProperties.from is specified, resolve it and override the sender
  if (emailProps.from) {
    fromAddress = resolveTemplateAddress(emailProps.from, envConfig, envName);
  }
  const fromHeader = buildFromHeader(fromNameOverride, fromAddress);

  // Build subject (replace template variables)
  let subject = emailProps.subject || '';
  let generatedTimestamp = null;
  if (subject.includes('{{timestamp}}')) {
    generatedTimestamp = Date.now().toString();
    subject = subject.replace(/\{\{timestamp\}\}/g, generatedTimestamp);
  }

  // Build mail options
  const mailOptions = {
    from: fromHeader,
    to: recipient,
    subject: subject,
    envelope: {
      from: envelopeSender,
      to: recipient,
    },
  };

  // Add text body
  if (emailProps.textBody !== undefined) {
    mailOptions.text = emailProps.textBody;
  }

  // Add HTML body
  if (emailProps.htmlBody !== undefined) {
    mailOptions.html = emailProps.htmlBody;
  }

  // Add attachments if present
  if (Array.isArray(emailProps.attachments) && emailProps.attachments.length > 0) {
    mailOptions.attachments = emailProps.attachments.map((att) => {
      if (att.path) {
        return { filename: att.filename || path.basename(att.path), path: att.path };
      }
      return { filename: att.filename || 'attachment', content: att.content || '' };
    });
  }

  const transport = createTransport(smtpConfig);

  try {
    const info = await transport.sendMail(mailOptions);
    const result = { success: true, messageId: info.messageId, subject: subject };
    if (generatedTimestamp) {
      result.timestamp = generatedTimestamp;
    }
    return result;
  } finally {
    transport.close();
  }
}

/**
 * Send multiple emails for test cases that use the 'emails' array pattern.
 * Supports per-email fromAddress overrides and sendDelay between emails.
 */
async function sendMultipleEmails({ smtpConfig, testCase, envConfig, senderAddress, envelopeSender, envName }) {
  const emails = testCase.emails;
  const sendDelay = (testCase.sendDelay || 10) * 1000; // default 10s
  const transport = createTransport(smtpConfig);
  const results = [];

  // Generate a single timestamp for the batch (used in all subjects)
  const generatedTimestamp = Date.now().toString();

  try {
    for (let i = 0; i < emails.length; i++) {
      const emailProps = emails[i];

      // Resolve recipient
      let recipient = emailProps.to || resolveRecipientAddress(envConfig, envName || null);
      if (recipient.includes('{{primary_email}}')) {
        recipient = resolveRecipientAddress(envConfig, envName || null);
      }

      // Resolve From address (supports per-email fromAddress override)
      let fromAddress = senderAddress;
      if (emailProps.fromAddress) {
        fromAddress = resolveTemplateAddress(emailProps.fromAddress, envConfig, envName);
      }

      const fromHeader = buildFromHeader(emailProps.fromNameOverride, fromAddress);

      // Build subject with timestamp
      let subject = emailProps.subject || '';
      if (subject.includes('{{timestamp}}')) {
        subject = subject.replace(/\{\{timestamp\}\}/g, generatedTimestamp);
      }

      const mailOptions = {
        from: fromHeader,
        to: recipient,
        subject: subject,
        envelope: { from: envelopeSender, to: recipient },
      };

      if (emailProps.textBody !== undefined) mailOptions.text = emailProps.textBody;
      if (emailProps.htmlBody !== undefined) mailOptions.html = emailProps.htmlBody;

      const info = await transport.sendMail(mailOptions);
      results.push({ messageId: info.messageId, subject: subject, from: fromAddress });

      // Wait between sends (except after the last one)
      if (i < emails.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, sendDelay));
      }
    }
  } finally {
    transport.close();
  }

  return {
    success: true,
    emailCount: results.length,
    timestamp: generatedTimestamp,
    subject: results[0].subject,
    results: results,
  };
}

/**
 * Classify an SMTP error into an error type and exit code.
 * @param {Error} err - The error thrown by nodemailer
 * @returns {{ errorType: string, exitCode: number }}
 */
function classifyError(err) {
  const message = (err.message || '').toLowerCase();
  const code = err.code || '';

  // Connection timeout
  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKET' ||
    code === 'ECONNECTION' ||
    message.includes('timeout') ||
    message.includes('timed out')
  ) {
    return { errorType: 'connection_timeout', exitCode: 1 };
  }

  // Auth failure
  if (
    code === 'EAUTH' ||
    message.includes('authentication') ||
    message.includes('auth') ||
    message.includes('535') ||
    message.includes('invalid credentials') ||
    message.includes('login')
  ) {
    return { errorType: 'auth_failure', exitCode: 2 };
  }

  // Send failure (default for other errors)
  return { errorType: 'send_failure', exitCode: 3 };
}

/**
 * Main entry point for CLI usage.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.testCase) {
    const errorOutput = { success: false, error: 'send_failure', message: '--test-case argument is required' };
    process.stdout.write(JSON.stringify(errorOutput) + '\n');
    process.exit(3);
  }

  const credentialsPath = args.credentials || 'credentials.json';
  const envConfigPath = args.envConfig || 'env-config.json';
  const mode = args.mode || 'standard';

  // Load credentials
  const credResult = loadCredentials(credentialsPath, mode);
  if (credResult.error) {
    const errorOutput = { success: false, error: 'auth_failure', message: credResult.error };
    process.stdout.write(JSON.stringify(errorOutput) + '\n');
    process.exit(2);
  }

  // Load test case
  const tcResult = loadTestCase(args.testCase);
  if (tcResult.error) {
    const errorOutput = { success: false, error: 'send_failure', message: tcResult.error };
    process.stdout.write(JSON.stringify(errorOutput) + '\n');
    process.exit(3);
  }

  // Load env-config
  const envResult = loadEnvConfig(envConfigPath);
  if (envResult.error) {
    const errorOutput = { success: false, error: 'send_failure', message: envResult.error };
    process.stdout.write(JSON.stringify(errorOutput) + '\n');
    process.exit(3);
  }

  // Send the email
  try {
    const result = await sendEmail({
      smtpConfig: credResult.smtp,
      testCase: tcResult.testCase,
      envConfig: envResult.config,
      senderEmail: credResult.senderEmail,
      envName: args.env,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  } catch (err) {
    const { errorType, exitCode } = classifyError(err);
    const errorOutput = { success: false, error: errorType, message: err.message };
    process.stdout.write(JSON.stringify(errorOutput) + '\n');
    process.exit(exitCode);
  }
}

// Export functions for use as a module
module.exports = {
  parseArgs,
  loadCredentials,
  loadTestCase,
  loadEnvConfig,
  resolveSenderAddress,
  resolveRecipientAddress,
  buildFromHeader,
  createTransport,
  sendEmail,
  classifyError,
};

// Run as CLI if invoked directly
if (require.main === module) {
  main();
}
