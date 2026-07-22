import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the CommonJS module - vitest handles CJS interop
import attachmentGenerator from './attachment-generator.js';
const {
  generateTxt,
  generatePdf,
  generatePng,
  generateP7s,
  generateXyz,
  generateFile,
  generateAll,
  FILE_DEFINITIONS,
  crc32,
  buildPngChunk,
} = attachmentGenerator;

describe('attachment-generator', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-gen-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateTxt', () => {
    it('produces exact byte size for 512KB', () => {
      const buf = generateTxt(524288);
      expect(buf.length).toBe(524288);
    });

    it('produces exact byte size for 1MB', () => {
      const buf = generateTxt(1048576);
      expect(buf.length).toBe(1048576);
    });

    it('produces exact byte size for 2MB', () => {
      const buf = generateTxt(2097152);
      expect(buf.length).toBe(2097152);
    });

    it('produces exact byte size for 4MB', () => {
      const buf = generateTxt(4194304);
      expect(buf.length).toBe(4194304);
    });

    it('produces exact byte size for 8MB', () => {
      const buf = generateTxt(8388608);
      expect(buf.length).toBe(8388608);
    });

    it('produces exact byte size for 16MB', () => {
      const buf = generateTxt(16777216);
      expect(buf.length).toBe(16777216);
    });

    it('contains only ASCII characters', () => {
      const buf = generateTxt(1000);
      for (let i = 0; i < buf.length; i++) {
        expect(buf[i]).toBeGreaterThanOrEqual(0x0A); // newline
        expect(buf[i]).toBeLessThanOrEqual(0x7A);    // 'z'
      }
    });

    it('produces exact size for small values', () => {
      const buf = generateTxt(1);
      expect(buf.length).toBe(1);
    });
  });

  describe('generatePdf', () => {
    it('produces exact byte size for 1MB', () => {
      const buf = generatePdf(1048576);
      expect(buf.length).toBe(1048576);
    });

    it('produces exact byte size for 4MB', () => {
      const buf = generatePdf(4194304);
      expect(buf.length).toBe(4194304);
    });

    it('produces exact byte size for 5.5MB', () => {
      const buf = generatePdf(5767168);
      expect(buf.length).toBe(5767168);
    });

    it('starts with valid PDF header', () => {
      const buf = generatePdf(1048576);
      const header = buf.slice(0, 9).toString('ascii');
      expect(header).toBe('%PDF-1.4\n');
    });

    it('contains PDF magic bytes', () => {
      const buf = generatePdf(10240);
      const headerStr = buf.slice(0, 5).toString('ascii');
      expect(headerStr).toBe('%PDF-');
    });
  });

  describe('generatePng', () => {
    it('produces exact byte size for 2MB', () => {
      const buf = generatePng(2097152);
      expect(buf.length).toBe(2097152);
    });

    it('produces exact byte size for 4MB', () => {
      const buf = generatePng(4194304);
      expect(buf.length).toBe(4194304);
    });

    it('starts with valid PNG signature', () => {
      const buf = generatePng(2097152);
      const expectedSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(Buffer.compare(buf.slice(0, 8), expectedSig)).toBe(0);
    });

    it('contains IHDR chunk after signature', () => {
      const buf = generatePng(2097152);
      // IHDR type at bytes 12-15
      const ihdrType = buf.slice(12, 16).toString('ascii');
      expect(ihdrType).toBe('IHDR');
    });

    it('ends with IEND chunk', () => {
      const buf = generatePng(2097152);
      // IEND is the last 12 bytes: length(4) + "IEND"(4) + CRC(4)
      const iendType = buf.slice(buf.length - 8, buf.length - 4).toString('ascii');
      expect(iendType).toBe('IEND');
    });

    it('has correct PNG 8-byte magic number', () => {
      const buf = generatePng(10000);
      // The full PNG magic: 89 50 4E 47 0D 0A 1A 0A
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50); // P
      expect(buf[2]).toBe(0x4E); // N
      expect(buf[3]).toBe(0x47); // G
      expect(buf[4]).toBe(0x0D); // CR
      expect(buf[5]).toBe(0x0A); // LF
      expect(buf[6]).toBe(0x1A); // EOF
      expect(buf[7]).toBe(0x0A); // LF
    });
  });

  describe('generateP7s', () => {
    it('produces exact byte size of 2048', () => {
      const buf = generateP7s(2048);
      expect(buf.length).toBe(2048);
    });

    it('starts with DER SEQUENCE tag', () => {
      const buf = generateP7s(2048);
      expect(buf[0]).toBe(0x30); // SEQUENCE tag
    });

    it('contains signedData OID', () => {
      const buf = generateP7s(2048);
      // signedData OID: 2a 86 48 86 f7 0d 01 07 02
      const oidBytes = Buffer.from([0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x02]);
      const found = buf.indexOf(oidBytes);
      expect(found).toBeGreaterThan(0);
    });

    it('is at least 2KB for p7s handling test', () => {
      const buf = generateP7s(2048);
      expect(buf.length).toBeGreaterThanOrEqual(2048);
    });
  });

  describe('generateXyz', () => {
    it('produces exact byte size', () => {
      const buf = generateXyz(10240);
      expect(buf.length).toBe(10240);
    });

    it('contains ASCII text content', () => {
      const buf = generateXyz(100);
      const text = buf.toString('ascii');
      expect(text).toMatch(/[A-Za-z0-9\n]+/);
    });
  });

  describe('generateFile', () => {
    it('dispatches to correct generator for txt', () => {
      const buf = generateFile({ name: 'test.txt', size: 100, type: 'txt' });
      expect(buf.length).toBe(100);
    });

    it('dispatches to correct generator for pdf', () => {
      const buf = generateFile({ name: 'test.pdf', size: 10000, type: 'pdf' });
      expect(buf.length).toBe(10000);
      expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('dispatches to correct generator for png', () => {
      const buf = generateFile({ name: 'test.png', size: 10000, type: 'png' });
      expect(buf.length).toBe(10000);
      const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(Buffer.compare(buf.slice(0, 8), sig)).toBe(0);
    });

    it('dispatches to correct generator for p7s', () => {
      const buf = generateFile({ name: 'test.p7s', size: 2048, type: 'p7s' });
      expect(buf.length).toBe(2048);
      expect(buf[0]).toBe(0x30);
    });

    it('dispatches to correct generator for xyz', () => {
      const buf = generateFile({ name: 'test.xyz', size: 500, type: 'xyz' });
      expect(buf.length).toBe(500);
    });

    it('throws for unknown type', () => {
      expect(() => generateFile({ name: 'test.zzz', size: 100, type: 'zzz' }))
        .toThrow('Unknown file type: zzz');
    });
  });

  describe('generateAll', () => {
    it('generates all defined files in output directory', () => {
      const outputDir = path.join(tmpDir, 'all-files');
      const result = generateAll(outputDir);

      expect(result.errors).toHaveLength(0);
      expect(result.generated).toHaveLength(FILE_DEFINITIONS.length);

      // Verify each file exists with correct size
      for (const fileDef of FILE_DEFINITIONS) {
        const filePath = path.join(outputDir, fileDef.name);
        expect(fs.existsSync(filePath)).toBe(true);
        const stats = fs.statSync(filePath);
        expect(stats.size).toBe(fileDef.size);
      }
    });

    it('creates output directory if it does not exist', () => {
      const outputDir = path.join(tmpDir, 'new-dir', 'nested');
      const result = generateAll(outputDir);

      expect(result.errors).toHaveLength(0);
      expect(fs.existsSync(outputDir)).toBe(true);
    });
  });

  describe('FILE_DEFINITIONS', () => {
    it('includes all required file types', () => {
      const types = FILE_DEFINITIONS.map(f => f.type);
      expect(types).toContain('txt');
      expect(types).toContain('pdf');
      expect(types).toContain('png');
      expect(types).toContain('p7s');
      expect(types).toContain('xyz');
    });

    it('includes all required sizes', () => {
      const sizes = FILE_DEFINITIONS.map(f => f.size);
      expect(sizes).toContain(524288);    // 512KB
      expect(sizes).toContain(1048576);   // 1MB
      expect(sizes).toContain(2097152);   // 2MB
      expect(sizes).toContain(4194304);   // 4MB
      expect(sizes).toContain(5767168);   // 5.5MB
      expect(sizes).toContain(8388608);   // 8MB
      expect(sizes).toContain(16777216);  // 16MB
    });

    it('has p7s file of at least 2KB', () => {
      const p7sDef = FILE_DEFINITIONS.find(f => f.type === 'p7s');
      expect(p7sDef).toBeDefined();
      expect(p7sDef.size).toBeGreaterThanOrEqual(2048);
    });
  });

  describe('crc32', () => {
    it('computes correct CRC for known input', () => {
      // CRC-32 of "IEND" is a well-known value
      const input = Buffer.from('IEND', 'ascii');
      const result = crc32(input);
      expect(result).toBe(0xAE426082);
    });
  });

  describe('buildPngChunk', () => {
    it('builds chunk with correct structure', () => {
      const data = Buffer.from([0x01, 0x02, 0x03]);
      const chunk = buildPngChunk('tEXt', data);
      // Length (4) + Type (4) + Data (3) + CRC (4) = 15 bytes
      expect(chunk.length).toBe(15);
      // Length field should be 3
      expect(chunk.readUInt32BE(0)).toBe(3);
      // Type should be 'tEXt'
      expect(chunk.slice(4, 8).toString('ascii')).toBe('tEXt');
      // Data should match
      expect(Buffer.compare(chunk.slice(8, 11), data)).toBe(0);
    });
  });
});
