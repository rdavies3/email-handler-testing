'use strict';

/**
 * SFMC Sender Module
 *
 * Sends test emails through Salesforce Marketing Cloud's Triggered Send API
 * to simulate how MC-originated emails arrive at Email-to-Case.
 *
 * Uses Server-to-Server (S2S) OAuth2 client_credentials flow — no interactive
 * login required. The access token is obtained automatically and cached for
 * its 20-minute lifetime.
 *
 * Prerequisites:
 *   1. An Installed Package in MC with an API Integration component (S2S)
 *   2. A Triggered Send Definition configured in Email Studio
 *   3. The Sender Profile must route replies back to the sandbox address
 *   4. The sfmc block in credentials.json must be populated
 *
 * Usage (CLI):
 *   node src/sfmc-sender.js --test-case tests/cases/test-01-sfmc.json \
 *     --env-config /path/to/env-config.json \
 *     --credentials /path/to/credentials.json \
 *     --env DEV
 *
 * Usage (module):
 *   const { authenticate, sendTriggeredEmail, sendTransactionalEmail } = require('./sfmc-sender');
 */

const fs = require('fs');
const path = require('path');

// ─── Authentication ───────────────────────────────────────────────────────────

/**
 * Token cache to avoid re-authenticating on every send within a session.
 */
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Authenticate with SFMC using Server-to-Server OAuth2 (client_credentials).
 *
 * Endpoint: POST https://{subdomain}.auth.marketingcloudapis.com/v2/token
 *
 * @param {object} sfmcConfig - The sfmc block from credentials.json
 * @param {string} sfmcConfig.subdomain - MC tenant subdomain (e.g., "mc563885gzs27c5t9-63k636ttgm")
 * @param {string} sfmcConfig.clientId - OAuth client ID from Installed Package
 * @param {string} sfmcConfig.clientSecret - OAuth client secret from Installed Package
 * @param {string} [sfmcConfig.accountId] - Optional MID (Member ID) for multi-BU contexts
 * @returns {Promise<string>} Access token
 * @throws {Error} If authentication fails
 */
async function authenticate(sfmcConfig) {
  // Return cached token if still valid (with 60s buffer)
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60000) {
    return tokenCache.accessToken;
  }

  const authUrl = `https://${sfmcConfig.subdomain}.auth.marketingcloudapis.com/v2/token`;

  const body = {
    grant_type: 'client_credentials',
    client_id: sfmcConfig.clientId,
    client_secret: sfmcConfig.clientSecret,
  };

  // Include account_id if specified (for multi-business-unit access)
  if (sfmcConfig.accountId) {
    body.account_id = sfmcConfig.accountId;
  }

  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`SFMC auth failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  // Cache the token
  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = now + (data.expires_in * 1000);

  return data.access_token;
}

/**
 * Clear the cached token (useful for testing or forced re-auth).
 */
function clearTokenCache() {
  tokenCache = { accessToken: null, expiresAt: 0 };
}

// ─── Triggered Send (Legacy REST) ────────────────────────────────────────────

/**
 * Send a triggered email via the legacy Triggered Send REST API.
 *
 * Endpoint: POST /messaging/v1/messageDefinitionSends/{key}/send
 *
 * This fires an existing Triggered Send Definition configured in Email Studio.
 * The MC admin must have the triggered send active and pointing to the correct
 * email template.
 *
 * @param {object} options
 * @param {string} options.accessToken - OAuth access token
 * @param {string} options.restBaseUrl - e.g., "https://{subdomain}.rest.marketingcloudapis.com"
 * @param {string} options.triggeredSendKey - External key of the Triggered Send Definition
 * @param {string} options.toAddress - Recipient email (the Email-to-Case routing address)
 * @param {string} options.subscriberKey - Unique key for the subscriber (can be the email or a test ID)
 * @param {string} [options.fromAddress] - Optional From email override
 * @param {string} [options.fromName] - Optional From name override
 * @param {object} [options.subscriberAttributes] - Optional name/value pairs for personalization
 * @returns {Promise<object>} API response
 */
async function sendTriggeredEmail(options) {
  const {
    accessToken,
    restBaseUrl,
    triggeredSendKey,
    toAddress,
    subscriberKey,
    fromAddress,
    fromName,
    subscriberAttributes,
  } = options;

  const url = `${restBaseUrl}/messaging/v1/messageDefinitionSends/key:${triggeredSendKey}/send`;

  const payload = {
    To: {
      Address: toAddress,
      SubscriberKey: subscriberKey,
    },
  };

  // Optional From override
  if (fromAddress || fromName) {
    payload.From = {};
    if (fromAddress) payload.From.Address = fromAddress;
    if (fromName) payload.From.Name = fromName;
  }

  // Optional subscriber attributes for personalization/merge fields
  if (subscriberAttributes && Object.keys(subscriberAttributes).length > 0) {
    payload.To.ContactAttributes = {
      SubscriberAttributes: subscriberAttributes,
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json();

  if (!response.ok) {
    throw new Error(`SFMC triggered send failed (${response.status}): ${JSON.stringify(responseBody)}`);
  }

  return responseBody;
}

// ─── Transactional Messaging (Modern REST) ───────────────────────────────────

/**
 * Send a transactional email via the modern Transactional Messaging API.
 *
 * Endpoint: POST /messaging/v1/email/messages/{messageKey}
 *
 * This uses a Transactional Send Journey configured in Journey Builder.
 * Preferred over triggered sends for new implementations.
 *
 * @param {object} options
 * @param {string} options.accessToken - OAuth access token
 * @param {string} options.restBaseUrl - e.g., "https://{subdomain}.rest.marketingcloudapis.com"
 * @param {string} options.definitionKey - External key of the Transactional Send Definition
 * @param {string} options.toAddress - Recipient email
 * @param {string} options.subscriberKey - Unique subscriber key
 * @param {string} [options.messageKey] - Unique message key for dedup (auto-generated if omitted)
 * @param {string} [options.fromAddress] - Optional From email override
 * @param {string} [options.fromName] - Optional From name override
 * @param {object} [options.contactAttributes] - Optional personalization attributes
 * @returns {Promise<object>} API response with requestId and status
 */
async function sendTransactionalEmail(options) {
  const {
    accessToken,
    restBaseUrl,
    definitionKey,
    toAddress,
    subscriberKey,
    messageKey,
    fromAddress,
    fromName,
    contactAttributes,
  } = options;

  const msgKey = messageKey || `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const url = `${restBaseUrl}/messaging/v1/email/messages/${msgKey}`;

  const payload = {
    definitionKey: definitionKey,
    recipient: {
      contactKey: subscriberKey,
      to: toAddress,
    },
  };

  // Optional From override
  if (fromAddress || fromName) {
    payload.options = payload.options || {};
    // Note: From override may not be supported on all Transactional Send configs
    // The Sender Profile on the send definition takes precedence
  }

  // Optional contact attributes for personalization
  if (contactAttributes && Object.keys(contactAttributes).length > 0) {
    payload.recipient.attributes = contactAttributes;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json();

  if (!response.ok) {
    throw new Error(`SFMC transactional send failed (${response.status}): ${JSON.stringify(responseBody)}`);
  }

  return { ...responseBody, messageKey: msgKey };
}

// ─── High-Level Send (Test Case Oriented) ────────────────────────────────────

/**
 * Send SFMC test email(s) based on a test case definition.
 *
 * Handles authentication, resolves config, and fires the appropriate API call.
 *
 * @param {object} options
 * @param {object} options.sfmcConfig - The sfmc block from credentials.json
 * @param {object} options.testCase - The test case JSON object
 * @param {object} options.envConfig - The loaded env-config object
 * @param {string} options.envName - Target environment (DEV, QA, UAT)
 * @returns {Promise<object>} Results object
 */
async function sendSfmcTestEmail(options) {
  const { sfmcConfig, testCase, envConfig, envName } = options;

  // Authenticate
  const accessToken = await authenticate(sfmcConfig);
  const restBaseUrl = `https://${sfmcConfig.subdomain}.rest.marketingcloudapis.com`;

  // Resolve recipient (Email-to-Case address for the target env)
  const env = envConfig.environments[envName];
  const toAddress = env.emailAddresses.primary;

  // Determine send approach
  const sendMode = sfmcConfig.sendMode || 'triggered'; // 'triggered' or 'transactional'
  const emailProps = testCase.emailProperties || {};
  const timestamp = Date.now().toString();

  // Build subscriber key (unique per test send)
  const subscriberKey = `test-${testCase.id}-${timestamp}`;

  const results = [];

  // Handle multiple sends if the test case has a fromVariants array
  // (Test #1 sends from differently formatted addresses)
  const variants = testCase.sfmcVariants || [emailProps];

  for (const variant of variants) {
    const fromAddress = variant.fromAddress || sfmcConfig.defaultFromAddress || null;
    const fromName = variant.fromName || sfmcConfig.defaultFromName || null;
    const variantSubKey = `${subscriberKey}-${variant.id || results.length}`;

    let response;

    if (sendMode === 'transactional') {
      response = await sendTransactionalEmail({
        accessToken,
        restBaseUrl,
        definitionKey: sfmcConfig.transactionalDefinitionKey,
        toAddress,
        subscriberKey: variantSubKey,
        fromAddress,
        fromName,
      });
    } else {
      response = await sendTriggeredEmail({
        accessToken,
        restBaseUrl,
        triggeredSendKey: sfmcConfig.triggeredSendKey,
        toAddress,
        subscriberKey: variantSubKey,
        fromAddress,
        fromName,
        subscriberAttributes: variant.subscriberAttributes || null,
      });
    }

    results.push({
      variantId: variant.id || results.length.toString(),
      fromAddress,
      fromName,
      toAddress,
      subscriberKey: variantSubKey,
      response,
    });
  }

  return {
    success: true,
    timestamp,
    sendMode,
    emailCount: results.length,
    results,
  };
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

/**
 * Parse CLI arguments.
 */
function parseArgs(args) {
  const result = { testCase: null, envConfig: null, credentials: null, env: null };
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
      case '--env':
        result.env = args[++i] || null;
        break;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.testCase || !args.envConfig || !args.credentials || !args.env) {
    console.error('Usage: node src/sfmc-sender.js --test-case <path> --env-config <path> --credentials <path> --env <ENV>');
    process.exit(1);
  }

  // Load files
  const testCase = JSON.parse(fs.readFileSync(path.resolve(args.testCase), 'utf8'));
  const envConfig = JSON.parse(fs.readFileSync(path.resolve(args.envConfig), 'utf8'));
  const credentials = JSON.parse(fs.readFileSync(path.resolve(args.credentials), 'utf8'));

  if (!credentials.sfmc) {
    console.error(JSON.stringify({ success: false, error: 'missing_config', message: 'No "sfmc" block found in credentials.json' }));
    process.exit(1);
  }

  try {
    const result = await sendSfmcTestEmail({
      sfmcConfig: credentials.sfmc,
      testCase,
      envConfig,
      envName: args.env,
    });
    console.log(JSON.stringify(result));
  } catch (err) {
    const errorType = err.message.includes('auth failed') ? 'auth_failure' : 'send_failure';
    console.error(JSON.stringify({ success: false, error: errorType, message: err.message }));
    process.exit(errorType === 'auth_failure' ? 2 : 3);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  authenticate,
  clearTokenCache,
  sendTriggeredEmail,
  sendTransactionalEmail,
  sendSfmcTestEmail,
  parseArgs,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ success: false, error: 'unexpected', message: err.message }));
    process.exit(1);
  });
}
