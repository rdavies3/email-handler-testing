'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  generateBoundary,
  encodeBase64,
  encodeQuotedPrintable,
  generateContentType,
  generateContentId,
  getMimeType,
} = require('./utils/mime-helpers');

/**
 * EML Generator — creates RFC 5322-compliant .eml files from test case definitions.
 *
 * Supports:
 * - multipart/alternative (text + html, no attachments)
 * - multipart/mixed (attachments present)
 * - multipart/related (inline images present)
 * - Both attachments and inline images
 * - Empty subject / empty body handling
 * - Template variable resolution ({{primary_email}}, {{timestamp}}, etc.)
 */

// ─── Template Variable Resolution ─────────────────────────────────────────────

/**
 * Resolves template variables in a string using env-config values.
 * Supported variables: {{primary_email}}, {{secondary_email}}, {{tertiary_email}}, {{timestamp}}
 * @param {string} str - Input string with template placeholders
 * @param {object} envConfig - Resolved environment config
 * @param {string} timestamp - Timestamp value for {{timestamp}}
 * @returns {string} String with resolved placeholders
 */
function resolveTemplateVars(str, envConfig, timestamp) {
  if (!str || typeof str !== 'string') return str;

  return str
    .replace(/\{\{primary_email\}\}/g, envConfig.emailAddresses.primary)
    .replace(/\{\{secondary_email\}\}/g, envConfig.emailAddresses.secondary)
    .replace(/\{\{tertiary_email\}\}/g, envConfig.emailAddresses.tertiary)
    .replace(/\{\{timestamp\}\}/g, timestamp);
}

/**
 * Deep-resolves template variables throughout a test case's emailProperties.
 * @param {object} emailProps - emailProperties object from test case JSON
 * @param {object} envConfig - Resolved environment config
 * @param {string} timestamp - Timestamp value
 * @returns {object} New emailProperties with resolved values
 */
function resolveEmailProperties(emailProps, envConfig, timestamp) {
  const resolved = {};
  for (const [key, value] of Object.entries(emailProps)) {
    if (typeof value === 'string') {
      resolved[key] = resolveTemplateVars(value, envConfig, timestamp);
    } else if (Array.isArray(value)) {
      resolved[key] = value.map((item) => {
        if (typeof item === 'string') {
          return resolveTemplateVars(item, envConfig, timestamp);
        }
        if (item && typeof item === 'object') {
          const resolvedItem = {};
          for (const [k, v] of Object.entries(item)) {
            resolvedItem[k] = typeof v === 'string' ? resolveTemplateVars(v, envConfig, timestamp) : v;
          }
          return resolvedItem;
        }
        return item;
      });
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

// ─── RFC 5322 Header Generation ───────────────────────────────────────────────

/**
 * Generates a unique Message-ID header value.
 * @returns {string} Message-ID in angle brackets
 */
function generateMessageId() {
  const uniquePart = crypto.randomBytes(16).toString('hex');
  return `<${uniquePart}@email-handler-testing.local>`;
}

/**
 * Formats a Date object as an RFC 5322 date string.
 * @param {Date} date
 * @returns {string} RFC 5322 formatted date (e.g., "Mon, 01 Jan 2024 12:00:00 +0000")
 */
function formatRfc5322Date(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = days[date.getUTCDay()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${dayName}, ${day} ${month} ${year} ${hours}:${minutes}:${seconds} +0000`;
}

/**
 * Generates RFC 5322 email headers.
 * @param {object} options
 * @param {string} options.to - Recipient address
 * @param {string} options.subject - Subject line (can be empty string)
 * @param {string} options.from - Sender address
 * @param {string} options.contentType - Top-level Content-Type header value
 * @returns {string} Formatted headers block (CRLF line endings)
 */
function generateHeaders({ to, subject, from, contentType }) {
  const headers = [];

  headers.push(`From: ${from}`);
  headers.push(`To: ${to}`);
  headers.push(`Subject: ${subject !== undefined ? subject : ''}`);
  headers.push(`Date: ${formatRfc5322Date(new Date())}`);
  headers.push(`Message-ID: ${generateMessageId()}`);
  headers.push(`MIME-Version: 1.0`);
  headers.push(`Content-Type: ${contentType}`);

  return headers.join('\r\n');
}

// ─── MIME Part Assembly ────────────────────────────────────────────────────────

/**
 * Creates a text/plain MIME part.
 * @param {string} text - Plain text content (can be empty)
 * @returns {string} MIME part string
 */
function createTextPart(text) {
  const contentType = generateContentType('text/plain', { charset: 'utf-8' });
  const encoded = encodeQuotedPrintable(text || '');

  return [
    `Content-Type: ${contentType}`,
    'Content-Transfer-Encoding: quoted-printable',
    '',
    encoded,
  ].join('\r\n');
}

/**
 * Creates a text/html MIME part.
 * @param {string} html - HTML content (can be empty)
 * @returns {string} MIME part string
 */
function createHtmlPart(html) {
  const contentType = generateContentType('text/html', { charset: 'utf-8' });
  const encoded = encodeQuotedPrintable(html || '');

  return [
    `Content-Type: ${contentType}`,
    'Content-Transfer-Encoding: quoted-printable',
    '',
    encoded,
  ].join('\r\n');
}

/**
 * Creates an attachment MIME part from a file.
 * @param {object} attachment - Attachment descriptor
 * @param {string} attachment.filename - Filename for the attachment
 * @param {string} attachment.path - File path to read content from
 * @param {Buffer} [attachment.content] - Direct content (alternative to path)
 * @returns {string} MIME part string
 */
function createAttachmentPart(attachment) {
  const filename = attachment.filename || path.basename(attachment.path || 'attachment');
  const ext = path.extname(filename);
  const mimeType = getMimeType(ext);

  let buffer;
  if (attachment.content) {
    buffer = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content);
  } else if (attachment.path) {
    buffer = fs.readFileSync(attachment.path);
  } else {
    buffer = Buffer.alloc(0);
  }

  const contentType = generateContentType(mimeType, { name: filename });
  const encoded = encodeBase64(buffer);

  return [
    `Content-Type: ${contentType}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment;\r\n\tfilename="${filename}"`,
    '',
    encoded,
  ].join('\r\n');
}

/**
 * Creates an inline image MIME part with Content-ID.
 * @param {object} image - Inline image descriptor
 * @param {string} image.filename - Filename
 * @param {string} image.path - File path to read content from
 * @param {string} [image.contentId] - Content-ID (generated if not provided)
 * @param {Buffer} [image.content] - Direct content (alternative to path)
 * @returns {{ part: string, contentId: string }} MIME part and its Content-ID
 */
function createInlineImagePart(image) {
  const filename = image.filename || path.basename(image.path || 'image.png');
  const ext = path.extname(filename);
  const mimeType = getMimeType(ext);
  const contentId = image.contentId || generateContentId();

  let buffer;
  if (image.content) {
    buffer = Buffer.isBuffer(image.content)
      ? image.content
      : Buffer.from(image.content);
  } else if (image.path) {
    buffer = fs.readFileSync(image.path);
  } else {
    buffer = Buffer.alloc(0);
  }

  const contentType = generateContentType(mimeType, { name: filename });
  const encoded = encodeBase64(buffer);

  const part = [
    `Content-Type: ${contentType}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: inline;\r\n\tfilename="${filename}"`,
    `Content-ID: ${contentId}`,
    '',
    encoded,
  ].join('\r\n');

  return { part, contentId };
}

/**
 * Assembles MIME parts into a multipart section.
 * @param {string} boundary - MIME boundary string
 * @param {string[]} parts - Array of MIME part strings
 * @returns {string} Assembled multipart body
 */
function assembleMultipart(boundary, parts) {
  const lines = [];
  for (const part of parts) {
    lines.push(`--${boundary}`);
    lines.push(part);
  }
  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

// ─── MIME Structure Determination ─────────────────────────────────────────────

/**
 * Determines the MIME structure type based on email content.
 * @param {object} emailProps - Resolved email properties
 * @returns {string} One of: 'alternative', 'mixed', 'related', 'mixed-related'
 */
function determineMimeStructure(emailProps) {
  const hasAttachments = emailProps.attachments && emailProps.attachments.length > 0;
  const hasInlineImages = emailProps.inlineImages && emailProps.inlineImages.length > 0;

  if (hasAttachments && hasInlineImages) {
    return 'mixed-related';
  }
  if (hasAttachments) {
    return 'mixed';
  }
  if (hasInlineImages) {
    return 'related';
  }
  return 'alternative';
}

// ─── Full EML Assembly ────────────────────────────────────────────────────────

/**
 * Generates a complete RFC 5322 .eml file content from email properties.
 * @param {object} emailProps - Resolved email properties
 * @param {object} [options] - Additional options
 * @param {string} [options.from] - From address (defaults to placeholder)
 * @returns {string} Complete .eml file content
 */
function generateEml(emailProps, options = {}) {
  const from = options.from || 'test-sender@email-handler-testing.local';
  const to = emailProps.to;
  const subject = emailProps.subject !== undefined ? emailProps.subject : '';
  const textBody = emailProps.textBody !== undefined ? emailProps.textBody : '';
  const htmlBody = emailProps.htmlBody !== undefined ? emailProps.htmlBody : '';

  const mimeStructure = determineMimeStructure(emailProps);

  let topLevelContentType;
  let body;

  switch (mimeStructure) {
    case 'alternative': {
      const boundary = generateBoundary();
      topLevelContentType = generateContentType('multipart/alternative', { boundary });
      const textPart = createTextPart(textBody);
      const htmlPart = createHtmlPart(htmlBody);
      body = assembleMultipart(boundary, [textPart, htmlPart]);
      break;
    }

    case 'mixed': {
      const mixedBoundary = generateBoundary();
      const altBoundary = generateBoundary();

      topLevelContentType = generateContentType('multipart/mixed', { boundary: mixedBoundary });

      // Build alternative section
      const textPart = createTextPart(textBody);
      const htmlPart = createHtmlPart(htmlBody);
      const altContentType = generateContentType('multipart/alternative', { boundary: altBoundary });
      const altSection = [
        `Content-Type: ${altContentType}`,
        '',
        assembleMultipart(altBoundary, [textPart, htmlPart]),
      ].join('\r\n');

      // Build attachment parts
      const attachmentParts = emailProps.attachments.map((att) => createAttachmentPart(att));

      body = assembleMultipart(mixedBoundary, [altSection, ...attachmentParts]);
      break;
    }

    case 'related': {
      const relatedBoundary = generateBoundary();
      const altBoundary = generateBoundary();

      topLevelContentType = generateContentType('multipart/related', { boundary: relatedBoundary });

      // Build alternative section
      const textPart = createTextPart(textBody);
      const htmlPart = createHtmlPart(htmlBody);
      const altContentType = generateContentType('multipart/alternative', { boundary: altBoundary });
      const altSection = [
        `Content-Type: ${altContentType}`,
        '',
        assembleMultipart(altBoundary, [textPart, htmlPart]),
      ].join('\r\n');

      // Build inline image parts
      const inlineParts = emailProps.inlineImages.map((img) => createInlineImagePart(img));
      const inlinePartStrings = inlineParts.map((ip) => ip.part);

      body = assembleMultipart(relatedBoundary, [altSection, ...inlinePartStrings]);
      break;
    }

    case 'mixed-related': {
      const mixedBoundary = generateBoundary();
      const relatedBoundary = generateBoundary();
      const altBoundary = generateBoundary();

      topLevelContentType = generateContentType('multipart/mixed', { boundary: mixedBoundary });

      // Build alternative section
      const textPart = createTextPart(textBody);
      const htmlPart = createHtmlPart(htmlBody);
      const altContentType = generateContentType('multipart/alternative', { boundary: altBoundary });
      const altSection = [
        `Content-Type: ${altContentType}`,
        '',
        assembleMultipart(altBoundary, [textPart, htmlPart]),
      ].join('\r\n');

      // Build inline image parts
      const inlineParts = emailProps.inlineImages.map((img) => createInlineImagePart(img));
      const inlinePartStrings = inlineParts.map((ip) => ip.part);

      // Build related section wrapping alt + inline images
      const relatedContentType = generateContentType('multipart/related', { boundary: relatedBoundary });
      const relatedSection = [
        `Content-Type: ${relatedContentType}`,
        '',
        assembleMultipart(relatedBoundary, [altSection, ...inlinePartStrings]),
      ].join('\r\n');

      // Build attachment parts
      const attachmentParts = emailProps.attachments.map((att) => createAttachmentPart(att));

      body = assembleMultipart(mixedBoundary, [relatedSection, ...attachmentParts]);
      break;
    }
  }

  // Assemble complete .eml
  const headers = generateHeaders({ to, subject, from, contentType: topLevelContentType });
  return `${headers}\r\n\r\n${body}\r\n`;
}

// ─── CLI Interface ────────────────────────────────────────────────────────────

/**
 * Parse CLI arguments for eml-generator.
 * @param {string[]} args - Process argv from index 2
 * @returns {{ testCase: string|null, envConfig: string|null, output: string|null }}
 */
function parseCliArgs(args) {
  const result = { testCase: null, envConfig: null, output: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--test-case':
        result.testCase = args[++i] || null;
        break;
      case '--env-config':
        result.envConfig = args[++i] || null;
        break;
      case '--output':
        result.output = args[++i] || null;
        break;
    }
  }
  return result;
}

/**
 * Loads env-config and resolves for the default environment (first found).
 * For CLI usage, the env-config is used to resolve template variables.
 * @param {string} envConfigPath - Path to env-config.json
 * @returns {object} Parsed env-config object
 */
function loadEnvConfig(envConfigPath) {
  const resolved = path.resolve(envConfigPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Env config file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  return JSON.parse(raw);
}

/**
 * Main CLI entry point.
 * Generates an .eml file from a test case definition and writes to output directory.
 */
function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.testCase) {
    process.stderr.write('ERROR: --test-case argument is required\n');
    process.exit(1);
  }

  if (!args.output) {
    process.stderr.write('ERROR: --output argument is required\n');
    process.exit(1);
  }

  // Load test case
  const testCasePath = path.resolve(args.testCase);
  if (!fs.existsSync(testCasePath)) {
    process.stderr.write(`ERROR: Test case file not found: ${testCasePath}\n`);
    process.exit(1);
  }

  let testCase;
  try {
    testCase = JSON.parse(fs.readFileSync(testCasePath, 'utf8'));
  } catch (err) {
    process.stderr.write(`ERROR: Failed to parse test case JSON: ${err.message}\n`);
    process.exit(1);
  }

  // Load env-config for template resolution
  let envConfig = null;
  if (args.envConfig) {
    try {
      const rawConfig = loadEnvConfig(args.envConfig);
      // Use first environment found for template resolution
      const envNames = Object.keys(rawConfig.environments || {});
      if (envNames.length > 0) {
        const envName = envNames[0];
        envConfig = {
          emailAddresses: rawConfig.environments[envName].emailAddresses,
        };
      }
    } catch (err) {
      process.stderr.write(`WARNING: Could not load env-config: ${err.message}\n`);
    }
  }

  // Fallback env config for template resolution
  if (!envConfig) {
    envConfig = {
      emailAddresses: {
        primary: 'primary@example.com',
        secondary: 'secondary@example.com',
        tertiary: 'tertiary@example.com',
      },
    };
  }

  // Generate timestamp for isolation
  const timestamp = Date.now().toString();

  // Resolve template variables in email properties
  const emailProps = resolveEmailProperties(
    testCase.emailProperties || {},
    envConfig,
    timestamp
  );

  // Generate .eml content
  const emlContent = generateEml(emailProps);

  // Ensure output directory exists
  const outputDir = path.resolve(args.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write .eml file
  const testId = testCase.id || 'unknown';
  const filename = `test-${testId}-${timestamp}.eml`;
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, emlContent);

  // Print path to stdout
  process.stdout.write(outputPath + '\n');
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  resolveTemplateVars,
  resolveEmailProperties,
  generateMessageId,
  formatRfc5322Date,
  generateHeaders,
  createTextPart,
  createHtmlPart,
  createAttachmentPart,
  createInlineImagePart,
  assembleMultipart,
  determineMimeStructure,
  generateEml,
  parseCliArgs,
};

// Run as CLI if invoked directly
if (require.main === module) {
  main();
}
