'use strict';

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { loadJsonFile } = require('./config-loader');

/**
 * Parse CLI arguments for smtp-sender.
 * @param {string[]} args - Process argv (from index 2)
 * @returns {{ testCase: string|null, envConfig: string|null, credentials: string|null }}
 */
function parseArgs(args) {
  const result = { testCase: null, envConfig: null, credentials: null };
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
    }
  }
  return result;
}

/**
 * Load and validate SMTP credentials from credentials.json.
 * @param {string} credentialsPath - Path to credentials.json
 * @returns {{ smtp: object|null, error: string|null }}
 */
function loadCredentials(credentialsPath) {
  const result = loadJsonFile(credentialsPath);
  if (result.error) {
    return { smtp: null, error: result.error };
  }

  const creds = result.data;
  if (!creds.manipulatedSmtp || typeof creds.manipulatedSmtp !== 'object') {
    return { smtp: null, error: 'Missing manipulatedSmtp section in credentials' };
  }

  const smtp = creds.manipulatedSmtp;
  if (!smtp.host || typeof smtp.host !== 'string') {
    return { smtp: null, error: 'manipulatedSmtp.host is required and must be a string' };
  }
  if (smtp.port === undefined || typeof smtp.port !== 'number') {
    return { smtp: null, error: 'manipulatedSmtp.port is required and must be a number' };
  }
  if (!smtp.auth || !smtp.auth.username || !smtp.auth.password) {
    return { smtp: null, error: 'manipulatedSmtp.auth with username and password is required' };
  }

  return { smtp, error: null };
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
 * Resolve the sender email address from env-config.
 * Uses the first environment's primary email as the envelope sender.
 * @param {object} envConfig - Parsed env-config object
 * @returns {string} The sender email address
 */
function resolveSenderAddress(envConfig) {
  if (!envConfig.environments) {
    return 'test-sender@example.com';
  }
  const envNames = Object.keys(envConfig.environments);
  if (envNames.length === 0) {
    return 'test-sender@example.com';
  }
  // Use the first environment's primary email as the test sender
  const firstEnv = envConfig.environments[envNames[0]];
  if (firstEnv && firstEnv.emailAddresses && firstEnv.emailAddresses.primary) {
    return firstEnv.emailAddresses.primary;
  }
  return 'test-sender@example.com';
}

/**
 * Resolve the recipient email address from env-config.
 * Uses the first environment's primary email as the recipient.
 * @param {object} envConfig - Parsed env-config object
 * @returns {string} The recipient email address
 */
function resolveRecipientAddress(envConfig) {
  if (!envConfig.environments) {
    return 'recipient@example.com';
  }
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
  const transportOptions = {
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure || false,
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
 * Send an email via the Manipulated SMTP server.
 * @param {object} options
 * @param {object} options.smtpConfig - Manipulated SMTP credentials
 * @param {object} options.testCase - Parsed test case JSON
 * @param {object} options.envConfig - Parsed env-config object
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string, message?: string }>}
 */
async function sendEmail({ smtpConfig, testCase, envConfig }) {
  const senderAddress = resolveSenderAddress(envConfig);
  const emailProps = testCase.emailProperties || {};

  // Resolve recipient — use test case 'to' or fall back to env-config
  let recipient = emailProps.to || resolveRecipientAddress(envConfig);
  // Replace template variables if present
  if (recipient.includes('{{primary_email}}')) {
    recipient = resolveRecipientAddress(envConfig);
  }

  // Build the From header based on fromNameOverride
  const fromNameOverride = emailProps.fromNameOverride;
  const fromHeader = buildFromHeader(fromNameOverride, senderAddress);

  // Build subject (replace template variables)
  let subject = emailProps.subject || '';
  if (subject.includes('{{timestamp}}')) {
    subject = subject.replace(/\{\{timestamp\}\}/g, Date.now().toString());
  }

  // Build mail options
  const mailOptions = {
    from: fromHeader,
    to: recipient,
    subject: subject,
    envelope: {
      from: senderAddress,
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
    return { success: true, messageId: info.messageId };
  } finally {
    transport.close();
  }
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

  // Load credentials
  const credResult = loadCredentials(credentialsPath);
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
