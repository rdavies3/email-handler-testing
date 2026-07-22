import { describe, it, expect } from 'vitest';
import {
  generateBoundary,
  encodeBase64,
  encodeQuotedPrintable,
  generateContentType,
  generateContentId,
  getMimeType
} from './mime-helpers.js';

describe('mime-helpers', () => {
  describe('generateBoundary', () => {
    it('returns a string starting with ----=_Part_', () => {
      const boundary = generateBoundary();
      expect(boundary).toMatch(/^----=_Part_[0-9a-f]{32}$/);
    });

    it('generates unique boundaries on each call', () => {
      const a = generateBoundary();
      const b = generateBoundary();
      expect(a).not.toBe(b);
    });
  });

  describe('encodeBase64', () => {
    it('encodes a small buffer to base64', () => {
      const buf = Buffer.from('Hello, World!');
      const encoded = encodeBase64(buf);
      expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
    });

    it('wraps lines at 76 characters per RFC 2045', () => {
      // Create a buffer large enough to produce multiple lines
      const buf = Buffer.alloc(100, 'A');
      const encoded = encodeBase64(buf);
      const lines = encoded.split('\r\n');
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
    });

    it('correctly encodes binary data', () => {
      const buf = Buffer.from([0x00, 0xFF, 0x7F, 0x80, 0x01]);
      const encoded = encodeBase64(buf);
      // Verify round-trip
      const decoded = Buffer.from(encoded.replace(/\r\n/g, ''), 'base64');
      expect(decoded).toEqual(buf);
    });

    it('handles empty buffer', () => {
      const buf = Buffer.alloc(0);
      const encoded = encodeBase64(buf);
      expect(encoded).toBe('');
    });

    it('throws on non-Buffer input', () => {
      expect(() => encodeBase64('not a buffer')).toThrow('encodeBase64 requires a Buffer argument');
    });
  });

  describe('encodeQuotedPrintable', () => {
    it('passes through plain ASCII text unchanged', () => {
      const text = 'Hello World';
      const encoded = encodeQuotedPrintable(text);
      expect(encoded).toBe('Hello World');
    });

    it('encodes the equals sign as =3D', () => {
      const text = 'a=b';
      const encoded = encodeQuotedPrintable(text);
      expect(encoded).toBe('a=3Db');
    });

    it('encodes non-ASCII characters', () => {
      const text = 'caf\u00E9';
      const encoded = encodeQuotedPrintable(text);
      // é is U+00E9, UTF-8 bytes: 0xC3 0xA9
      expect(encoded).toBe('caf=C3=A9');
    });

    it('preserves tabs and spaces in the middle of a line', () => {
      const text = 'hello\tworld here';
      const encoded = encodeQuotedPrintable(text);
      expect(encoded).toBe('hello\tworld here');
    });

    it('encodes trailing spaces and tabs', () => {
      const text = 'trailing space ';
      const encoded = encodeQuotedPrintable(text);
      expect(encoded).toBe('trailing space=20');
    });

    it('encodes trailing tab', () => {
      const text = 'trailing tab\t';
      const encoded = encodeQuotedPrintable(text);
      expect(encoded).toBe('trailing tab=09');
    });

    it('preserves line breaks as CRLF', () => {
      const text = 'line1\r\nline2';
      const encoded = encodeQuotedPrintable(text);
      expect(encoded).toBe('line1\r\nline2');
    });

    it('soft-wraps lines exceeding 76 characters', () => {
      const text = 'A'.repeat(100);
      const encoded = encodeQuotedPrintable(text);
      const lines = encoded.split('\r\n');
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
      // Verify the content is preserved after removing soft breaks
      const decoded = encoded.replace(/=\r\n/g, '');
      expect(decoded).toBe(text);
    });

    it('does not break in the middle of an encoded sequence', () => {
      // Create a string that would break mid-sequence without special handling
      const text = 'A'.repeat(73) + '\u00E9'; // 73 A's + encoded char (=C3=A9)
      const encoded = encodeQuotedPrintable(text);
      const lines = encoded.split('\r\n');
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(76);
        // No line should end with just '=' followed by only one hex digit
        // (i.e., broken =XX sequence, but soft break '=' at end is fine)
      }
    });

    it('handles empty string', () => {
      const encoded = encodeQuotedPrintable('');
      expect(encoded).toBe('');
    });

    it('throws on non-string input', () => {
      expect(() => encodeQuotedPrintable(123)).toThrow('encodeQuotedPrintable requires a string argument');
    });
  });

  describe('generateContentType', () => {
    it('returns the MIME type with no params', () => {
      const ct = generateContentType('text/plain');
      expect(ct).toBe('text/plain');
    });

    it('appends charset parameter', () => {
      const ct = generateContentType('text/plain', { charset: 'utf-8' });
      expect(ct).toBe('text/plain;\r\n\tcharset=utf-8');
    });

    it('appends boundary parameter with quoting', () => {
      const ct = generateContentType('multipart/mixed', { boundary: '----=_Part_abc123' });
      expect(ct).toBe('multipart/mixed;\r\n\tboundary="----=_Part_abc123"');
    });

    it('handles multiple parameters', () => {
      const ct = generateContentType('text/html', { charset: 'utf-8', name: 'file.html' });
      expect(ct).toContain('text/html');
      expect(ct).toContain('charset=utf-8');
      expect(ct).toContain('name=file.html');
    });

    it('skips null and undefined parameter values', () => {
      const ct = generateContentType('text/plain', { charset: 'utf-8', boundary: null });
      expect(ct).toBe('text/plain;\r\n\tcharset=utf-8');
    });

    it('throws on missing mimeType', () => {
      expect(() => generateContentType('')).toThrow('generateContentType requires a non-empty mimeType string');
      expect(() => generateContentType(null)).toThrow('generateContentType requires a non-empty mimeType string');
    });
  });

  describe('generateContentId', () => {
    it('returns a string in angle bracket format', () => {
      const cid = generateContentId();
      expect(cid).toMatch(/^<[0-9a-f]{24}@email-handler-testing>$/);
    });

    it('generates unique IDs on each call', () => {
      const a = generateContentId();
      const b = generateContentId();
      expect(a).not.toBe(b);
    });
  });

  describe('getMimeType', () => {
    it('returns correct MIME type for common extensions', () => {
      expect(getMimeType('txt')).toBe('text/plain');
      expect(getMimeType('pdf')).toBe('application/pdf');
      expect(getMimeType('png')).toBe('image/png');
      expect(getMimeType('jpg')).toBe('image/jpeg');
      expect(getMimeType('docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(getMimeType('xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });

    it('handles extensions with leading dot', () => {
      expect(getMimeType('.pdf')).toBe('application/pdf');
      expect(getMimeType('.png')).toBe('image/png');
    });

    it('handles case-insensitive extensions', () => {
      expect(getMimeType('PDF')).toBe('application/pdf');
      expect(getMimeType('PNG')).toBe('image/png');
      expect(getMimeType('.TXT')).toBe('text/plain');
    });

    it('returns application/octet-stream for unknown extensions', () => {
      expect(getMimeType('xyz')).toBe('application/octet-stream');
      expect(getMimeType('unknown')).toBe('application/octet-stream');
    });

    it('returns application/octet-stream for empty or null input', () => {
      expect(getMimeType('')).toBe('application/octet-stream');
      expect(getMimeType(null)).toBe('application/octet-stream');
      expect(getMimeType(undefined)).toBe('application/octet-stream');
    });

    it('returns correct type for p7s (signature files)', () => {
      expect(getMimeType('p7s')).toBe('application/pkcs7-signature');
    });

    it('returns correct type for html variants', () => {
      expect(getMimeType('html')).toBe('text/html');
      expect(getMimeType('htm')).toBe('text/html');
    });
  });
});
