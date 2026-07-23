'use strict';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import path from 'path';
import fs from 'fs';
import os from 'os';

import configResolver from './config-resolver.js';
const { readPointerFile, writePointerFile, resolveConfigPaths } = configResolver;

/**
 * Feature: interactive-agent-config
 * Property 3: Relative path resolution determinism
 * **Validates: Requirements 7.5**
 *
 * For any relative path R and project root P, resolving R relative to P
 * produces the same result as `path.resolve(P, R)`.
 */
describe('Feature: interactive-agent-config, Property 3: Relative path resolution determinism', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pbt-relpath-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  /**
   * Arbitrary that generates valid relative path segments.
   * Produces paths like 'foo/bar', './baz', '../qux', 'a/b/c'.
   */
  const validPathSegment = fc.stringOf(
    fc.constantFrom(
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
      'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
      'u', 'v', 'w', 'x', 'y', 'z',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      '-', '_'
    ),
    { minLength: 1, maxLength: 10 }
  );

  const relativePathArb = fc.tuple(
    fc.constantFrom('', './', '../'),
    fc.array(validPathSegment, { minLength: 1, maxLength: 4 })
  ).map(([prefix, segments]) => prefix + segments.join('/'));

  it('readPointerFile resolves relative paths identically to path.resolve(projectRoot, relativePath)', () => {
    fc.assert(
      fc.property(relativePathArb, (relativePath) => {
        // Write the relative path to a temp pointer file
        const pointerFilePath = path.join(projectRoot, '.config-path');
        fs.writeFileSync(pointerFilePath, relativePath + '\n', 'utf8');

        // Call readPointerFile
        const result = readPointerFile(pointerFilePath, projectRoot);

        // The result should equal path.resolve(projectRoot, relativePath)
        const expected = path.resolve(projectRoot, relativePath);

        expect(result.error).toBeNull();
        expect(result.path).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Helper to create a temporary directory structure for testing.
 */
function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-resolver-pbt-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('Feature: interactive-agent-config, Property 5: Missing file identification', () => {
  /**
   * **Validates: Requirements 1.6, 1.7**
   *
   * For any config directory missing one or both files, `missingFiles` array
   * lists exactly the missing filenames.
   */

  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      removeTempDir(dir);
    }
    tempDirs.length = 0;
  });

  it('missingFiles lists exactly the missing filenames for any combination of absent config files', () => {
    fc.assert(
      fc.property(
        // Generate a boolean pair where at least one is false
        fc.tuple(fc.boolean(), fc.boolean()).filter(([a, b]) => !a || !b),
        ([hasEnvConfig, hasCredentials]) => {
          // Create project root temp dir
          const projectRoot = createTempDir();
          tempDirs.push(projectRoot);

          // Create external config dir
          const externalDir = createTempDir();
          tempDirs.push(externalDir);

          // Write .config-path pointing to the external dir
          fs.writeFileSync(
            path.join(projectRoot, '.config-path'),
            externalDir + '\n',
            'utf8'
          );

          // Optionally create env-config.json
          if (hasEnvConfig) {
            fs.writeFileSync(path.join(externalDir, 'env-config.json'), '{}', 'utf8');
          }

          // Optionally create credentials.json
          if (hasCredentials) {
            fs.writeFileSync(path.join(externalDir, 'credentials.json'), '{}', 'utf8');
          }

          // Call resolveConfigPaths
          const result = resolveConfigPaths({ projectRoot });

          // Verify missingFiles contains 'env-config.json' iff hasEnvConfig is false
          if (!hasEnvConfig) {
            expect(result.missingFiles).toContain('env-config.json');
          } else {
            expect(result.missingFiles).not.toContain('env-config.json');
          }

          // Verify missingFiles contains 'credentials.json' iff hasCredentials is false
          if (!hasCredentials) {
            expect(result.missingFiles).toContain('credentials.json');
          } else {
            expect(result.missingFiles).not.toContain('credentials.json');
          }

          // Verify missingFiles.length equals the count of false booleans
          const expectedMissingCount = (!hasEnvConfig ? 1 : 0) + (!hasCredentials ? 1 : 0);
          expect(result.missingFiles.length).toBe(expectedMissingCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: interactive-agent-config, Property 4: Fallback only when pointer absent', () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * When `.config-path` exists with a valid accessible path, source is always
   * 'pointer' and never falls back.
   */

  const { resolveConfigDir } = configResolver;
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      removeTempDir(dir);
    }
    tempDirs.length = 0;
  });

  it('resolveConfigDir returns source "pointer" when .config-path points to a valid accessible directory, even when fallback files exist', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (iteration) => {
        // Create a temp projectRoot directory
        const projectRoot = createTempDir();
        tempDirs.push(projectRoot);

        // Create a temp external config directory (accessible)
        const externalDir = createTempDir();
        tempDirs.push(externalDir);

        // Write the external dir path to `.config-path` in the projectRoot
        fs.writeFileSync(
          path.join(projectRoot, '.config-path'),
          externalDir + '\n',
          'utf8'
        );

        // Also place `env-config.json` and `credentials.json` in the projectRoot
        // so that fallback WOULD be possible if the pointer wasn't used
        fs.writeFileSync(
          path.join(projectRoot, 'env-config.json'),
          JSON.stringify({ env: 'test' }),
          'utf8'
        );
        fs.writeFileSync(
          path.join(projectRoot, 'credentials.json'),
          JSON.stringify({ creds: 'test' }),
          'utf8'
        );

        // Call resolveConfigDir and verify source is always 'pointer'
        const result = resolveConfigDir({ projectRoot });

        expect(result.source).toBe('pointer');
        expect(result.configDir).toBe(externalDir);
        expect(result.error).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});


describe('Feature: interactive-agent-config, Property 1: Path resolution round-trip', () => {
  /**
   * **Validates: Requirements 1.2, 7.1, 7.4**
   *
   * For any valid absolute path written to a temp pointer file,
   * `readPointerFile` returns the same normalized path.
   */

  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbt-round-trip-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Generator for valid absolute paths on macOS/Linux.
   * Produces paths starting with `/`, containing only valid filename characters
   * (alphanumeric, hyphens, underscores, dots, spaces), no null bytes,
   * and between 1 and 5 path segments.
   */
  const validAbsolutePathArb = fc
    .array(
      fc.stringOf(
        fc.oneof(
          fc.char().filter((c) => /[a-zA-Z0-9\-_. ]/.test(c) && c !== '\0'),
          fc.constant('-'),
          fc.constant('_'),
          fc.constant('.')
        ),
        { minLength: 1, maxLength: 20 }
      ).filter((s) => s.trim().length > 0 && !s.startsWith('.') && !s.endsWith('.')),
      { minLength: 1, maxLength: 5 }
    )
    .map((segments) => '/' + segments.join('/'));

  it('readPointerFile returns the same absolute path that was written via writePointerFile', () => {
    fc.assert(
      fc.property(validAbsolutePathArb, (absPath) => {
        const pointerFilePath = path.join(tempDir, '.config-path');

        // Write the path to a pointer file
        const writeResult = writePointerFile(pointerFilePath, absPath);
        expect(writeResult.success).toBe(true);

        // Read it back via readPointerFile
        const readResult = readPointerFile(pointerFilePath, tempDir);

        // Should succeed without error
        expect(readResult.error).toBeNull();

        // The returned path should equal the normalized (trimmed) input path
        expect(readResult.path).toBe(absPath.trim());
      }),
      { numRuns: 100 }
    );
  });

  it('readPointerFile returns normalized path regardless of surrounding whitespace in the file', () => {
    // Generator for paths that are already in canonical (trimmed) form
    // - no leading/trailing whitespace in the overall path string
    const canonicalAbsPathArb = fc
      .array(
        fc.stringOf(
          fc.oneof(
            fc.char().filter((c) => /[a-zA-Z0-9\-_.]/.test(c) && c !== '\0'),
            fc.constant('-'),
            fc.constant('_'),
            fc.constant('.')
          ),
          { minLength: 1, maxLength: 20 }
        ).filter((s) => s.trim().length > 0 && s === s.trim() && !s.startsWith('.') && !s.endsWith('.')),
        { minLength: 1, maxLength: 5 }
      )
      .map((segments) => '/' + segments.join('/'));

    fc.assert(
      fc.property(
        canonicalAbsPathArb,
        fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 5 }),
        fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 5 }),
        (absPath, leadingWS, trailingWS) => {
          const pointerFilePath = path.join(tempDir, '.config-path');

          // Write raw content with surrounding whitespace directly to file
          fs.writeFileSync(pointerFilePath, leadingWS + absPath + trailingWS, 'utf8');

          // Read it back via readPointerFile
          const readResult = readPointerFile(pointerFilePath, tempDir);

          // Should succeed without error
          expect(readResult.error).toBeNull();

          // The returned path should equal the canonical absolute path (trimming removed only surrounding WS)
          expect(readResult.path).toBe(absPath);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: interactive-agent-config, Property 2: Whitespace trimming preserves path content', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any valid path surrounded by arbitrary whitespace/newlines,
   * Config Resolver resolves to the same directory as the untrimmed path.
   */

  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      removeTempDir(dir);
    }
    tempDirs.length = 0;
  });

  it('readPointerFile resolves whitespace-padded paths to the same result as bare paths', () => {
    // Generate valid absolute path segments (alphanumeric + common filename chars)
    const pathSegmentArb = fc.stringOf(
      fc.constantFrom(
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
        'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        '-', '_', '.'
      ),
      { minLength: 1, maxLength: 10 }
    );

    // Generate absolute paths with 1-4 segments
    const absolutePathArb = fc
      .array(pathSegmentArb, { minLength: 1, maxLength: 4 })
      .map((segments) => '/' + segments.join('/'));

    // Generate whitespace strings containing spaces, tabs, newlines
    const whitespaceArb = fc.stringOf(
      fc.constantFrom(' ', '\t', '\n', '\r\n', '\r'),
      { minLength: 1, maxLength: 5 }
    );

    fc.assert(
      fc.property(
        absolutePathArb,
        whitespaceArb,
        whitespaceArb,
        (absPath, leadingWs, trailingWs) => {
          const tempDir = createTempDir();
          tempDirs.push(tempDir);

          const pointerFile = path.join(tempDir, '.config-path');

          // Write path WITHOUT whitespace and read result
          fs.writeFileSync(pointerFile, absPath, 'utf8');
          const bareResult = readPointerFile(pointerFile, tempDir);

          // Write path WITH surrounding whitespace and read result
          fs.writeFileSync(pointerFile, leadingWs + absPath + trailingWs, 'utf8');
          const paddedResult = readPointerFile(pointerFile, tempDir);

          // Both should resolve without error
          expect(bareResult.error).toBeNull();
          expect(paddedResult.error).toBeNull();

          // Both should resolve to the same path
          expect(paddedResult.path).toBe(bareResult.path);

          // And both should equal the original absolute path
          expect(paddedResult.path).toBe(absPath);
        }
      ),
      { numRuns: 100 }
    );
  });
});
