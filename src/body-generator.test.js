import { describe, it, expect } from 'vitest';

// Import the CommonJS module - vitest handles CJS interop
import bodyGenerator from './body-generator.js';
const { generateLongBody, generateSizedBody, parseArgs } = bodyGenerator;

describe('body-generator', () => {
  describe('generateLongBody', () => {
    it('generates content of exactly 34000 characters', () => {
      const result = generateLongBody(34000);
      expect(result.length).toBe(34000);
    });

    it('generates content of exactly 0 characters', () => {
      const result = generateLongBody(0);
      expect(result.length).toBe(0);
      expect(result).toBe('');
    });

    it('generates content of exactly 1 character', () => {
      const result = generateLongBody(1);
      expect(result.length).toBe(1);
    });

    it('generates content of exactly 100 characters', () => {
      const result = generateLongBody(100);
      expect(result.length).toBe(100);
    });

    it('generates human-readable text (not random bytes)', () => {
      const result = generateLongBody(500);
      // Should contain common English words
      expect(result).toMatch(/[a-zA-Z]/);
      // Should not contain non-printable characters
      expect(result).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    });

    it('generates consistent output for the same input', () => {
      const result1 = generateLongBody(1000);
      const result2 = generateLongBody(1000);
      expect(result1).toBe(result2);
    });

    it('generates plain ASCII text suitable for email body', () => {
      const result = generateLongBody(5000);
      // All characters should be printable ASCII (space through tilde)
      for (let i = 0; i < result.length; i++) {
        const code = result.charCodeAt(i);
        expect(code).toBeGreaterThanOrEqual(32);
        expect(code).toBeLessThanOrEqual(126);
      }
    });

    it('throws for negative charCount', () => {
      expect(() => generateLongBody(-1)).toThrow();
    });

    it('throws for non-numeric charCount', () => {
      expect(() => generateLongBody('abc')).toThrow();
    });

    it('throws for Infinity', () => {
      expect(() => generateLongBody(Infinity)).toThrow();
    });
  });

  describe('generateSizedBody', () => {
    it('generates content of approximately 512KB', () => {
      const targetBytes = 524288; // 512KB
      const result = generateSizedBody(targetBytes);
      const actualBytes = Buffer.byteLength(result, 'utf8');
      const lowerBound = targetBytes * 0.9;
      const upperBound = targetBytes * 1.1;
      expect(actualBytes).toBeGreaterThanOrEqual(lowerBound);
      expect(actualBytes).toBeLessThanOrEqual(upperBound);
    });

    it('generates content of approximately 1MB', () => {
      const targetBytes = 1048576; // 1MB
      const result = generateSizedBody(targetBytes);
      const actualBytes = Buffer.byteLength(result, 'utf8');
      const lowerBound = targetBytes * 0.9;
      const upperBound = targetBytes * 1.1;
      expect(actualBytes).toBeGreaterThanOrEqual(lowerBound);
      expect(actualBytes).toBeLessThanOrEqual(upperBound);
    });

    it('generates content of approximately 2MB', () => {
      const targetBytes = 2097152; // 2MB
      const result = generateSizedBody(targetBytes);
      const actualBytes = Buffer.byteLength(result, 'utf8');
      const lowerBound = targetBytes * 0.9;
      const upperBound = targetBytes * 1.1;
      expect(actualBytes).toBeGreaterThanOrEqual(lowerBound);
      expect(actualBytes).toBeLessThanOrEqual(upperBound);
    });

    it('generates content of approximately 4MB', () => {
      const targetBytes = 4194304; // 4MB
      const result = generateSizedBody(targetBytes);
      const actualBytes = Buffer.byteLength(result, 'utf8');
      const lowerBound = targetBytes * 0.9;
      const upperBound = targetBytes * 1.1;
      expect(actualBytes).toBeGreaterThanOrEqual(lowerBound);
      expect(actualBytes).toBeLessThanOrEqual(upperBound);
    });

    it('generates content of approximately 8MB', () => {
      const targetBytes = 8388608; // 8MB
      const result = generateSizedBody(targetBytes);
      const actualBytes = Buffer.byteLength(result, 'utf8');
      const lowerBound = targetBytes * 0.9;
      const upperBound = targetBytes * 1.1;
      expect(actualBytes).toBeGreaterThanOrEqual(lowerBound);
      expect(actualBytes).toBeLessThanOrEqual(upperBound);
    });

    it('generates content of approximately 16MB', () => {
      const targetBytes = 16777216; // 16MB
      const result = generateSizedBody(targetBytes);
      const actualBytes = Buffer.byteLength(result, 'utf8');
      const lowerBound = targetBytes * 0.9;
      const upperBound = targetBytes * 1.1;
      expect(actualBytes).toBeGreaterThanOrEqual(lowerBound);
      expect(actualBytes).toBeLessThanOrEqual(upperBound);
    });

    it('throws for negative sizeBytes', () => {
      expect(() => generateSizedBody(-1)).toThrow();
    });

    it('throws for non-numeric sizeBytes', () => {
      expect(() => generateSizedBody('abc')).toThrow();
    });
  });

  describe('parseArgs', () => {
    it('parses --chars argument', () => {
      const result = parseArgs(['--chars', '34000']);
      expect(result.chars).toBe(34000);
      expect(result.size).toBeNull();
      expect(result.output).toBeNull();
    });

    it('parses --size argument', () => {
      const result = parseArgs(['--size', '524288']);
      expect(result.size).toBe(524288);
      expect(result.chars).toBeNull();
    });

    it('parses --output argument', () => {
      const result = parseArgs(['--size', '524288', '--output', 'test.txt']);
      expect(result.size).toBe(524288);
      expect(result.output).toBe('test.txt');
    });

    it('returns nulls for empty args', () => {
      const result = parseArgs([]);
      expect(result.chars).toBeNull();
      expect(result.size).toBeNull();
      expect(result.output).toBeNull();
    });
  });
});
