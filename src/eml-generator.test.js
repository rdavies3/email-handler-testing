import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
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
} from './eml-generator.js';

// ─── Template Resolution Tests ────────────────────────────────────────────────

describe('resolveTemplateVars', () => {
  const envConfig = {
    emailAddresses: {
      primary: 'dev-cases@example.com',
      secondary: 'dev-alt@example.com',
      tertiary: 'dev-third@example.com',
    },
  };

  it('resolves {{primary_email}}', () => {
    const result = resolveTemplateVars('Send to {{primary_email}}', envConfig, '12345');
    expect(result).toBe('Send to dev-cases@example.com');
  });

  it('resolves {{secondary_email}}', () => {
    const result = resolveTemplateVars('{{secondary_email}}', envConfig, '12345');
    expect(result).toBe('dev-alt@example.com');
  });

  it('resolves {{tertiary_email}}', () => {
    const result = resolveTemplateVars('{{tertiary_email}}', envConfig, '12345');
    expect(result).toBe('dev-third@example.com');
  });

  it('resolves {{timestamp}}', () => {
    const result = resolveTemplateVars('Test-04-{{timestamp}}', envConfig, '1700000000');
    expect(result).toBe('Test-04-1700000000');
  });

  it('resolves multiple variables in one string', () => {
    const result = resolveTemplateVars(
      '{{primary_email}} at {{timestamp}}',
      envConfig,
      '99999'
    );
    expect(result).toBe('dev-cases@example.com at 99999');
  });

  it('returns input unchanged when no variables present', () => {
    const result = resolveTemplateVars('plain text', envConfig, '12345');
    expect(result).toBe('plain text');
  });

  it('handles null/undefined input gracefully', () => {
    expect(resolveTemplateVars(null, envConfig, '12345')).toBeNull();
    expect(resolveTemplateVars(undefined, envConfig, '12345')).toBeUndefined();
  });
});

describe('resolveEmailProperties', () => {
  const envConfig = {
    emailAddresses: {
      primary: 'dev@example.com',
      secondary: 'alt@example.com',
      tertiary: 'third@example.com',
    },
  };

  it('resolves string properties', () => {
    const props = { to: '{{primary_email}}', subject: 'Test-{{timestamp}}' };
    const result = resolveEmailProperties(props, envConfig, '999');
    expect(result.to).toBe('dev@example.com');
    expect(result.subject).toBe('Test-999');
  });

  it('resolves arrays of strings', () => {
    const props = { attachments: ['{{primary_email}}', 'literal'] };
    const result = resolveEmailProperties(props, envConfig, '111');
    expect(result.attachments).toEqual(['dev@example.com', 'literal']);
  });

  it('resolves arrays of objects', () => {
    const props = {
      attachments: [{ filename: '{{timestamp}}.txt', path: '/tmp/file' }],
    };
    const result = resolveEmailProperties(props, envConfig, '555');
    expect(result.attachments[0].filename).toBe('555.txt');
    expect(result.attachments[0].path).toBe('/tmp/file');
  });

  it('passes through non-string, non-array values', () => {
    const props = { count: 5, flag: true };
    const result = resolveEmailProperties(props, envConfig, '000');
    expect(result.count).toBe(5);
    expect(result.flag).toBe(true);
  });
});

// ─── Header Generation Tests ──────────────────────────────────────────────────

describe('generateMessageId', () => {
  it('returns a string in angle brackets', () => {
    const id = generateMessageId();
    expect(id).toMatch(/^<[a-f0-9]+@email-handler-testing\.local>$/);
  });

  it('generates unique IDs', () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    expect(id1).not.toBe(id2);
  });
});

describe('formatRfc5322Date', () => {
  it('formats a known date correctly', () => {
    const date = new Date('2024-01-15T10:30:45Z');
    const result = formatRfc5322Date(date);
    expect(result).toBe('Mon, 15 Jan 2024 10:30:45 +0000');
  });

  it('zero-pads single-digit day and time components', () => {
    const date = new Date('2024-03-01T01:02:03Z');
    const result = formatRfc5322Date(date);
    expect(result).toBe('Fri, 01 Mar 2024 01:02:03 +0000');
  });
});

describe('generateHeaders', () => {
  it('includes all required RFC 5322 headers', () => {
    const headers = generateHeaders({
      to: 'recipient@example.com',
      subject: 'Test Subject',
      from: 'sender@example.com',
      contentType: 'multipart/alternative; boundary="test"',
    });

    expect(headers).toContain('From: sender@example.com');
    expect(headers).toContain('To: recipient@example.com');
    expect(headers).toContain('Subject: Test Subject');
    expect(headers).toContain('Date: ');
    expect(headers).toContain('Message-ID: <');
    expect(headers).toContain('MIME-Version: 1.0');
    expect(headers).toContain('Content-Type: multipart/alternative');
  });

  it('handles empty subject (header present, value empty)', () => {
    const headers = generateHeaders({
      to: 'recipient@example.com',
      subject: '',
      from: 'sender@example.com',
      contentType: 'text/plain',
    });

    // Subject line should be present with empty value
    expect(headers).toMatch(/Subject: \r\n/);
  });

  it('uses CRLF line endings', () => {
    const headers = generateHeaders({
      to: 'a@b.com',
      subject: 'test',
      from: 'c@d.com',
      contentType: 'text/plain',
    });

    const lines = headers.split('\r\n');
    expect(lines.length).toBeGreaterThan(5);
  });
});

// ─── MIME Part Tests ──────────────────────────────────────────────────────────

describe('createTextPart', () => {
  it('creates a text/plain part with quoted-printable encoding', () => {
    const part = createTextPart('Hello World');
    expect(part).toContain('Content-Type: text/plain');
    expect(part).toContain('charset=utf-8');
    expect(part).toContain('Content-Transfer-Encoding: quoted-printable');
    expect(part).toContain('Hello World');
  });

  it('handles empty text', () => {
    const part = createTextPart('');
    expect(part).toContain('Content-Type: text/plain');
    expect(part).toContain('Content-Transfer-Encoding: quoted-printable');
  });
});

describe('createHtmlPart', () => {
  it('creates a text/html part with quoted-printable encoding', () => {
    const part = createHtmlPart('<p>Hello</p>');
    expect(part).toContain('Content-Type: text/html');
    expect(part).toContain('charset=utf-8');
    expect(part).toContain('Content-Transfer-Encoding: quoted-printable');
    expect(part).toContain('<p>Hello</p>');
  });

  it('handles empty html', () => {
    const part = createHtmlPart('');
    expect(part).toContain('Content-Type: text/html');
  });
});

describe('createAttachmentPart', () => {
  it('creates a base64-encoded attachment part with Content-Disposition', () => {
    const content = Buffer.from('test file content');
    const part = createAttachmentPart({ filename: 'test.txt', content });

    expect(part).toContain('Content-Type: text/plain');
    expect(part).toContain('name="test.txt"');
    expect(part).toContain('Content-Transfer-Encoding: base64');
    expect(part).toContain('Content-Disposition: attachment');
    expect(part).toContain('filename="test.txt"');
  });

  it('determines MIME type from extension', () => {
    const content = Buffer.from('PDF content');
    const part = createAttachmentPart({ filename: 'doc.pdf', content });
    expect(part).toContain('Content-Type: application/pdf');
  });

  it('reads from file path when content not provided', () => {
    const tmpFile = path.join(os.tmpdir(), 'eml-test-attachment.txt');
    fs.writeFileSync(tmpFile, 'file on disk');
    try {
      const part = createAttachmentPart({ path: tmpFile, filename: 'disk.txt' });
      expect(part).toContain('Content-Transfer-Encoding: base64');
      expect(part).toContain('filename="disk.txt"');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('createInlineImagePart', () => {
  it('creates an inline image part with Content-ID', () => {
    const content = Buffer.from('PNG data');
    const { part, contentId } = createInlineImagePart({
      filename: 'logo.png',
      content,
    });

    expect(part).toContain('Content-Type: image/png');
    expect(part).toContain('Content-Transfer-Encoding: base64');
    expect(part).toContain('Content-Disposition: inline');
    expect(part).toContain('Content-ID: ');
    expect(contentId).toMatch(/^<[a-f0-9]+@email-handler-testing>$/);
  });

  it('uses provided contentId when given', () => {
    const content = Buffer.from('JPG data');
    const { part, contentId } = createInlineImagePart({
      filename: 'photo.jpg',
      content,
      contentId: '<custom-id@test>',
    });

    expect(part).toContain('Content-ID: <custom-id@test>');
    expect(contentId).toBe('<custom-id@test>');
  });
});

describe('assembleMultipart', () => {
  it('wraps parts with boundary delimiters', () => {
    const boundary = 'test-boundary';
    const result = assembleMultipart(boundary, ['Part 1', 'Part 2']);

    expect(result).toContain('--test-boundary\r\nPart 1');
    expect(result).toContain('--test-boundary\r\nPart 2');
    expect(result).toContain('--test-boundary--');
  });

  it('terminates with closing boundary', () => {
    const result = assembleMultipart('B', ['single part']);
    expect(result).toMatch(/--B--$/);
  });
});

// ─── MIME Structure Determination ─────────────────────────────────────────────

describe('determineMimeStructure', () => {
  it('returns "alternative" when no attachments or inline images', () => {
    expect(determineMimeStructure({ textBody: 'hi', htmlBody: '<p>hi</p>' })).toBe('alternative');
  });

  it('returns "alternative" when attachments/inlineImages are empty arrays', () => {
    expect(
      determineMimeStructure({ textBody: 'x', attachments: [], inlineImages: [] })
    ).toBe('alternative');
  });

  it('returns "mixed" when attachments present, no inline images', () => {
    expect(
      determineMimeStructure({
        textBody: 'x',
        attachments: [{ filename: 'a.txt' }],
        inlineImages: [],
      })
    ).toBe('mixed');
  });

  it('returns "related" when inline images present, no attachments', () => {
    expect(
      determineMimeStructure({
        textBody: 'x',
        attachments: [],
        inlineImages: [{ filename: 'img.png' }],
      })
    ).toBe('related');
  });

  it('returns "mixed-related" when both attachments and inline images present', () => {
    expect(
      determineMimeStructure({
        textBody: 'x',
        attachments: [{ filename: 'a.txt' }],
        inlineImages: [{ filename: 'img.png' }],
      })
    ).toBe('mixed-related');
  });
});

// ─── Full EML Generation Tests ────────────────────────────────────────────────

describe('generateEml', () => {
  it('generates a multipart/alternative email for text + html only', () => {
    const eml = generateEml({
      to: 'test@example.com',
      subject: 'Test Subject',
      textBody: 'Hello plain',
      htmlBody: '<p>Hello html</p>',
    });

    expect(eml).toContain('From: test-sender@email-handler-testing.local');
    expect(eml).toContain('To: test@example.com');
    expect(eml).toContain('Subject: Test Subject');
    expect(eml).toContain('MIME-Version: 1.0');
    expect(eml).toContain('Content-Type: multipart/alternative');
    expect(eml).toContain('text/plain');
    expect(eml).toContain('text/html');
    expect(eml).toContain('Hello plain');
    expect(eml).toContain('<p>Hello html</p>');
  });

  it('handles empty subject (header present with empty value)', () => {
    const eml = generateEml({
      to: 'test@example.com',
      subject: '',
      textBody: 'Body content',
      htmlBody: '',
    });

    // Subject header present but empty
    expect(eml).toMatch(/Subject: \r\n/);
  });

  it('handles empty body (both text and html empty)', () => {
    const eml = generateEml({
      to: 'test@example.com',
      subject: 'Has Subject',
      textBody: '',
      htmlBody: '',
    });

    expect(eml).toContain('Subject: Has Subject');
    expect(eml).toContain('Content-Type: multipart/alternative');
    expect(eml).toContain('text/plain');
    expect(eml).toContain('text/html');
  });

  it('generates multipart/mixed when attachments provided', () => {
    const eml = generateEml({
      to: 'test@example.com',
      subject: 'With Attachment',
      textBody: 'See attached',
      htmlBody: '<p>See attached</p>',
      attachments: [{ filename: 'doc.pdf', content: Buffer.from('pdf bytes') }],
      inlineImages: [],
    });

    expect(eml).toContain('Content-Type: multipart/mixed');
    expect(eml).toContain('multipart/alternative');
    expect(eml).toContain('application/pdf');
    expect(eml).toContain('filename="doc.pdf"');
  });

  it('generates multipart/related when inline images provided', () => {
    const eml = generateEml({
      to: 'test@example.com',
      subject: 'With Image',
      textBody: 'See image',
      htmlBody: '<img src="cid:img1">',
      attachments: [],
      inlineImages: [{ filename: 'photo.png', content: Buffer.from('png data'), contentId: '<img1@test>' }],
    });

    expect(eml).toContain('Content-Type: multipart/related');
    expect(eml).toContain('multipart/alternative');
    expect(eml).toContain('image/png');
    expect(eml).toContain('Content-ID: <img1@test>');
  });

  it('generates multipart/mixed > multipart/related when both present', () => {
    const eml = generateEml({
      to: 'test@example.com',
      subject: 'Both',
      textBody: 'text',
      htmlBody: '<img src="cid:i1">',
      attachments: [{ filename: 'file.txt', content: Buffer.from('txt') }],
      inlineImages: [{ filename: 'i.png', content: Buffer.from('png'), contentId: '<i1@t>' }],
    });

    expect(eml).toContain('Content-Type: multipart/mixed');
    expect(eml).toContain('multipart/related');
    expect(eml).toContain('multipart/alternative');
    expect(eml).toContain('Content-ID: <i1@t>');
    expect(eml).toContain('filename="file.txt"');
  });

  it('generates valid multipart/alternative with text body only (empty html)', () => {
    const eml = generateEml({
      to: 'test@example.com',
      subject: 'Plain Text Only',
      textBody: 'Only plain text content here',
      htmlBody: '',
    });

    expect(eml).toContain('Content-Type: multipart/alternative');
    expect(eml).toContain('text/plain');
    expect(eml).toContain('text/html');
    expect(eml).toContain('Only plain text content here');
  });

  it('includes all RFC 5322 required header fields in correct format', () => {
    const eml = generateEml({
      to: 'recipient@example.com',
      subject: 'RFC Compliance Test',
      textBody: 'body',
      htmlBody: '<p>body</p>',
    });

    // Validate header field structure: "Field-Name: value\r\n"
    expect(eml).toMatch(/^From: .+\r\n/m);
    expect(eml).toMatch(/^To: recipient@example\.com\r\n/m);
    expect(eml).toMatch(/^Subject: RFC Compliance Test\r\n/m);
    // Date header follows RFC 5322: "day, DD Mon YYYY HH:MM:SS +0000"
    expect(eml).toMatch(/^Date: (Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} \+0000\r\n/m);
    // Message-ID in angle brackets with proper domain
    expect(eml).toMatch(/^Message-ID: <[a-f0-9]+@email-handler-testing\.local>\r\n/m);
    expect(eml).toMatch(/^MIME-Version: 1\.0\r\n/m);
  });

  it('uses custom from address when provided', () => {
    const eml = generateEml(
      { to: 'a@b.com', subject: 'x', textBody: 'y', htmlBody: '' },
      { from: 'custom@sender.com' }
    );
    expect(eml).toContain('From: custom@sender.com');
  });

  it('uses CRLF line endings throughout', () => {
    const eml = generateEml({
      to: 'a@b.com',
      subject: 'test',
      textBody: 'body',
      htmlBody: '',
    });

    // Every newline should be part of CRLF
    expect(eml).not.toMatch(/[^\r]\n/);
  });
});

// ─── CLI Argument Parsing ─────────────────────────────────────────────────────

describe('parseCliArgs', () => {
  it('parses all three arguments', () => {
    const result = parseCliArgs([
      '--test-case', 'tests/cases/test-04.json',
      '--env-config', 'env-config.json',
      '--output', 'generated-emails/',
    ]);
    expect(result.testCase).toBe('tests/cases/test-04.json');
    expect(result.envConfig).toBe('env-config.json');
    expect(result.output).toBe('generated-emails/');
  });

  it('returns null for missing arguments', () => {
    const result = parseCliArgs(['--output', '/tmp/out']);
    expect(result.testCase).toBeNull();
    expect(result.envConfig).toBeNull();
    expect(result.output).toBe('/tmp/out');
  });
});
