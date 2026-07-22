'use strict';

const crypto = require('crypto');

/**
 * MIME encoding utilities for .eml file generation.
 * Provides boundary generation, base64/quoted-printable encoding,
 * Content-Type header generation, Content-ID generation, and MIME type lookup.
 */

/**
 * Generates a unique MIME boundary string.
 * Format: ----=_Part_<random hex>
 * @returns {string} A unique MIME boundary string
 */
function generateBoundary() {
  const randomHex = crypto.randomBytes(16).toString('hex');
  return `----=_Part_${randomHex}`;
}

/**
 * Encodes a Buffer to base64 with line wrapping at 76 characters per RFC 2045.
 * @param {Buffer} buffer - The binary data to encode
 * @returns {string} Base64-encoded string with lines wrapped at 76 characters
 */
function encodeBase64(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('encodeBase64 requires a Buffer argument');
  }

  const base64 = buffer.toString('base64');
  const lines = [];

  for (let i = 0; i < base64.length; i += 76) {
    lines.push(base64.slice(i, i + 76));
  }

  return lines.join('\r\n');
}

/**
 * Encodes text using quoted-printable encoding per RFC 2045.
 * - Non-ASCII characters (> 126) and special characters are encoded as =XX
 * - Lines are soft-wrapped at 76 characters using =\r\n
 * - Literal CRLF line breaks are preserved
 * - Tab and space are preserved unless at end of line
 * @param {text} text - The text to encode
 * @returns {string} Quoted-printable encoded string
 */
function encodeQuotedPrintable(text) {
  if (typeof text !== 'string') {
    throw new Error('encodeQuotedPrintable requires a string argument');
  }

  // Split on CRLF, LF, or CR to handle different line ending styles
  const inputLines = text.split(/\r\n|\r|\n/);
  const outputLines = [];

  for (const line of inputLines) {
    let encoded = '';

    for (let i = 0; i < line.length; i++) {
      const charCode = line.charCodeAt(i);
      const char = line[i];
      const isLastChar = i === line.length - 1;

      // Encode: equals sign, non-printable ASCII (except tab/space), chars > 126
      if (char === '=') {
        encoded += '=3D';
      } else if (charCode === 9 || charCode === 32) {
        // Tab and space: encode only if at end of line
        if (isLastChar) {
          encoded += '=' + charCode.toString(16).toUpperCase().padStart(2, '0');
        } else {
          encoded += char;
        }
      } else if (charCode >= 33 && charCode <= 126) {
        // Printable ASCII (excluding space and =, which are handled above)
        encoded += char;
      } else {
        // Non-printable or non-ASCII: encode as =XX
        // Handle multi-byte characters by encoding each byte
        const buf = Buffer.from(char, 'utf8');
        for (const byte of buf) {
          encoded += '=' + byte.toString(16).toUpperCase().padStart(2, '0');
        }
      }
    }

    // Soft-wrap long lines at 76 characters (75 + soft break '=')
    const wrapped = softWrapLine(encoded);
    outputLines.push(wrapped);
  }

  return outputLines.join('\r\n');
}

/**
 * Soft-wraps a single encoded line at 76 characters using = continuation.
 * @param {string} line - The encoded line content
 * @returns {string} Line with soft breaks inserted
 */
function softWrapLine(line) {
  const maxLen = 76;

  if (line.length <= maxLen) {
    return line;
  }

  const parts = [];
  let pos = 0;

  while (pos < line.length) {
    // Last segment doesn't need a soft break
    if (line.length - pos <= maxLen) {
      parts.push(line.slice(pos));
      break;
    }

    // Leave room for the soft break '=' at position 75 (maxLen - 1)
    let breakAt = maxLen - 1; // 75 chars of content + '=' = 76 total

    // Don't break in the middle of an encoded sequence (=XX)
    // Check if position breakAt-1 or breakAt-2 starts an encoded triplet
    if (line[pos + breakAt - 1] === '=') {
      breakAt -= 1;
    } else if (line[pos + breakAt - 2] === '=') {
      breakAt -= 2;
    }

    parts.push(line.slice(pos, pos + breakAt) + '=');
    pos += breakAt;
  }

  return parts.join('\r\n');
}

/**
 * Generates a Content-Type header value with optional parameters.
 * @param {string} mimeType - The MIME type (e.g. "text/plain", "multipart/mixed")
 * @param {Object} [params] - Optional parameters (e.g. { charset: 'utf-8', boundary: '...' })
 * @returns {string} Formatted Content-Type header value
 */
function generateContentType(mimeType, params) {
  if (!mimeType || typeof mimeType !== 'string') {
    throw new Error('generateContentType requires a non-empty mimeType string');
  }

  let header = mimeType;

  if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        // Quote values that contain special characters
        const needsQuoting = /[()<>@,;:\\"\/\[\]?= \t]/.test(String(value));
        const formattedValue = needsQuoting ? `"${String(value)}"` : String(value);
        header += `;\r\n\t${key}=${formattedValue}`;
      }
    }
  }

  return header;
}

/**
 * Generates a unique Content-ID for inline images.
 * Format: <unique-id@email-handler-testing>
 * @returns {string} A unique Content-ID string enclosed in angle brackets
 */
function generateContentId() {
  const uniquePart = crypto.randomBytes(12).toString('hex');
  return `<${uniquePart}@email-handler-testing>`;
}

/**
 * Returns the MIME type for a given file extension.
 * Supports common document, image, and archive types.
 * @param {string} extension - File extension (with or without leading dot)
 * @returns {string} MIME type string, or 'application/octet-stream' for unknown types
 */
function getMimeType(extension) {
  if (!extension || typeof extension !== 'string') {
    return 'application/octet-stream';
  }

  // Normalize: remove leading dot, lowercase
  const ext = extension.replace(/^\./, '').toLowerCase();

  const mimeTypes = {
    // Text
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    csv: 'text/csv',
    xml: 'application/xml',
    json: 'application/json',

    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',

    // Archives
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',

    // Other
    p7s: 'application/pkcs7-signature',
    eml: 'message/rfc822',
    ics: 'text/calendar'
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = {
  generateBoundary,
  encodeBase64,
  encodeQuotedPrintable,
  generateContentType,
  generateContentId,
  getMimeType
};
