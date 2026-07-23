import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Import the CommonJS module - vitest handles CJS interop
import configResolver from './config-resolver.js';
const {
  readPointerFile,
  writePointerFile,
  resolveConfigDir,
  resolveConfigPaths,
} = configResolver;

/**
 * Helper to create a temporary directory with optional files.
 */
function createTempDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-resolver-test-'));
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return dir;
}

/**
 * Helper to remove temp directory recursively.
 */
function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('readPointerFile', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns error when pointer file does not exist', () => {
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBeNull();
    expect(result.error).toContain('Pointer file not found');
  });

  it('returns error when pointer file is empty', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), '', 'utf8');
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBeNull();
    expect(result.error).toBe('The .config-path file is empty.');
  });

  it('returns error when pointer file contains only whitespace', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), '   \n  \n  ', 'utf8');
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBeNull();
    expect(result.error).toBe('The .config-path file is empty.');
  });

  it('returns error when path contains null bytes', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), '/some/path\0bad', 'utf8');
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBeNull();
    expect(result.error).toBe('The path in .config-path contains invalid characters.');
  });

  it('returns absolute path as-is', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), '/usr/local/configs\n', 'utf8');
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBe('/usr/local/configs');
    expect(result.error).toBeNull();
  });

  it('trims whitespace and newlines from the path', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), '  /usr/local/configs  \n\n', 'utf8');
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBe('/usr/local/configs');
    expect(result.error).toBeNull();
  });

  it('resolves relative path against projectRoot', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), 'config/external', 'utf8');
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBe(path.resolve(tempDir, 'config/external'));
    expect(result.error).toBeNull();
  });

  it('resolves dot-relative path against projectRoot', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), './my-config', 'utf8');
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBe(path.resolve(tempDir, './my-config'));
    expect(result.error).toBeNull();
  });

  it('resolves parent-relative path against projectRoot', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), '../sibling-dir', 'utf8');
    const result = readPointerFile(path.join(tempDir, '.config-path'), tempDir);
    expect(result.path).toBe(path.resolve(tempDir, '../sibling-dir'));
    expect(result.error).toBeNull();
  });
});

describe('writePointerFile', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('writes the path to the pointer file with trailing newline', () => {
    const pointerPath = path.join(tempDir, '.config-path');
    const result = writePointerFile(pointerPath, '/Volumes/Keybase/private/user/');
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();

    const content = fs.readFileSync(pointerPath, 'utf8');
    expect(content).toBe('/Volumes/Keybase/private/user/\n');
  });

  it('trims whitespace before writing', () => {
    const pointerPath = path.join(tempDir, '.config-path');
    const result = writePointerFile(pointerPath, '  /some/path  ');
    expect(result.success).toBe(true);

    const content = fs.readFileSync(pointerPath, 'utf8');
    expect(content).toBe('/some/path\n');
  });

  it('returns error for empty string', () => {
    const pointerPath = path.join(tempDir, '.config-path');
    const result = writePointerFile(pointerPath, '');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Config directory path must be a non-empty string.');
  });

  it('returns error for whitespace-only string', () => {
    const pointerPath = path.join(tempDir, '.config-path');
    const result = writePointerFile(pointerPath, '   ');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Config directory path must be a non-empty string.');
  });

  it('returns error for null input', () => {
    const pointerPath = path.join(tempDir, '.config-path');
    const result = writePointerFile(pointerPath, null);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Config directory path must be a non-empty string.');
  });

  it('overwrites existing pointer file', () => {
    const pointerPath = path.join(tempDir, '.config-path');
    fs.writeFileSync(pointerPath, '/old/path\n', 'utf8');

    const result = writePointerFile(pointerPath, '/new/path');
    expect(result.success).toBe(true);

    const content = fs.readFileSync(pointerPath, 'utf8');
    expect(content).toBe('/new/path\n');
  });
});

describe('resolveConfigDir', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns pointer source when .config-path points to accessible directory', () => {
    const externalDir = createTempDir();
    try {
      fs.writeFileSync(path.join(tempDir, '.config-path'), externalDir, 'utf8');
      const result = resolveConfigDir({ projectRoot: tempDir });
      expect(result.configDir).toBe(externalDir);
      expect(result.source).toBe('pointer');
      expect(result.error).toBeNull();
    } finally {
      removeTempDir(externalDir);
    }
  });

  it('returns error when .config-path points to non-existent directory', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), '/nonexistent/path/xyz', 'utf8');
    const result = resolveConfigDir({ projectRoot: tempDir });
    expect(result.configDir).toBeNull();
    expect(result.source).toBeNull();
    expect(result.error).toContain('not accessible');
    expect(result.error).toContain('Verify the volume is mounted');
  });

  it('returns error when .config-path points to a file instead of directory', () => {
    const filePath = path.join(tempDir, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'content', 'utf8');
    fs.writeFileSync(path.join(tempDir, '.config-path'), filePath, 'utf8');
    const result = resolveConfigDir({ projectRoot: tempDir });
    expect(result.configDir).toBeNull();
    expect(result.error).toContain('not a directory');
  });

  it('falls back to project root when both config files exist', () => {
    fs.writeFileSync(path.join(tempDir, 'env-config.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'credentials.json'), '{}', 'utf8');
    const result = resolveConfigDir({ projectRoot: tempDir });
    expect(result.configDir).toBe(tempDir);
    expect(result.source).toBe('fallback');
    expect(result.error).toBeNull();
  });

  it('returns error when no pointer and no config files exist', () => {
    const result = resolveConfigDir({ projectRoot: tempDir });
    expect(result.configDir).toBeNull();
    expect(result.error).toContain('No .config-path file found');
    expect(result.error).toContain('Create .config-path');
  });

  it('returns error when no pointer and only env-config.json exists', () => {
    fs.writeFileSync(path.join(tempDir, 'env-config.json'), '{}', 'utf8');
    const result = resolveConfigDir({ projectRoot: tempDir });
    expect(result.configDir).toBeNull();
    expect(result.error).toContain('credentials.json is missing');
  });

  it('returns error when no pointer and only credentials.json exists', () => {
    fs.writeFileSync(path.join(tempDir, 'credentials.json'), '{}', 'utf8');
    const result = resolveConfigDir({ projectRoot: tempDir });
    expect(result.configDir).toBeNull();
    expect(result.error).toContain('env-config.json is missing');
  });

  it('uses custom pointer file name', () => {
    const externalDir = createTempDir();
    try {
      fs.writeFileSync(path.join(tempDir, '.my-config'), externalDir, 'utf8');
      const result = resolveConfigDir({ projectRoot: tempDir, pointerFile: '.my-config' });
      expect(result.configDir).toBe(externalDir);
      expect(result.source).toBe('pointer');
    } finally {
      removeTempDir(externalDir);
    }
  });

  it('resolves relative path in pointer file', () => {
    const subDir = path.join(tempDir, 'sub', 'config');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.config-path'), 'sub/config', 'utf8');
    const result = resolveConfigDir({ projectRoot: tempDir });
    expect(result.configDir).toBe(subDir);
    expect(result.source).toBe('pointer');
  });
});

describe('resolveConfigPaths', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns full paths when both config files exist in external dir', () => {
    const externalDir = createTempDir({
      'env-config.json': '{}',
      'credentials.json': '{}',
    });
    try {
      fs.writeFileSync(path.join(tempDir, '.config-path'), externalDir, 'utf8');
      const result = resolveConfigPaths({ projectRoot: tempDir });
      expect(result.configPath).toBe(path.join(externalDir, 'env-config.json'));
      expect(result.credentialsPath).toBe(path.join(externalDir, 'credentials.json'));
      expect(result.configDir).toBe(externalDir);
      expect(result.source).toBe('pointer');
      expect(result.error).toBeNull();
      expect(result.missingFiles).toEqual([]);
    } finally {
      removeTempDir(externalDir);
    }
  });

  it('reports missing env-config.json', () => {
    const externalDir = createTempDir({
      'credentials.json': '{}',
    });
    try {
      fs.writeFileSync(path.join(tempDir, '.config-path'), externalDir, 'utf8');
      const result = resolveConfigPaths({ projectRoot: tempDir });
      expect(result.configPath).toBeNull();
      expect(result.credentialsPath).toBe(path.join(externalDir, 'credentials.json'));
      expect(result.missingFiles).toEqual(['env-config.json']);
      expect(result.error).toContain('env-config.json');
      expect(result.error).toContain('template available');
    } finally {
      removeTempDir(externalDir);
    }
  });

  it('reports missing credentials.json', () => {
    const externalDir = createTempDir({
      'env-config.json': '{}',
    });
    try {
      fs.writeFileSync(path.join(tempDir, '.config-path'), externalDir, 'utf8');
      const result = resolveConfigPaths({ projectRoot: tempDir });
      expect(result.configPath).toBe(path.join(externalDir, 'env-config.json'));
      expect(result.credentialsPath).toBeNull();
      expect(result.missingFiles).toEqual(['credentials.json']);
      expect(result.error).toContain('credentials.json');
    } finally {
      removeTempDir(externalDir);
    }
  });

  it('reports both files missing', () => {
    const externalDir = createTempDir();
    try {
      fs.writeFileSync(path.join(tempDir, '.config-path'), externalDir, 'utf8');
      const result = resolveConfigPaths({ projectRoot: tempDir });
      expect(result.configPath).toBeNull();
      expect(result.credentialsPath).toBeNull();
      expect(result.missingFiles).toEqual(['env-config.json', 'credentials.json']);
      expect(result.error).toContain('Missing configuration files');
    } finally {
      removeTempDir(externalDir);
    }
  });

  it('propagates resolveConfigDir error', () => {
    fs.writeFileSync(path.join(tempDir, '.config-path'), '/nonexistent/dir', 'utf8');
    const result = resolveConfigPaths({ projectRoot: tempDir });
    expect(result.configPath).toBeNull();
    expect(result.credentialsPath).toBeNull();
    expect(result.configDir).toBeNull();
    expect(result.source).toBeNull();
    expect(result.error).toContain('not accessible');
    expect(result.missingFiles).toEqual([]);
  });

  it('works with fallback to project root', () => {
    fs.writeFileSync(path.join(tempDir, 'env-config.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'credentials.json'), '{}', 'utf8');
    const result = resolveConfigPaths({ projectRoot: tempDir });
    expect(result.configPath).toBe(path.join(tempDir, 'env-config.json'));
    expect(result.credentialsPath).toBe(path.join(tempDir, 'credentials.json'));
    expect(result.configDir).toBe(tempDir);
    expect(result.source).toBe('fallback');
    expect(result.error).toBeNull();
    expect(result.missingFiles).toEqual([]);
  });
});

describe('CLI --paths', () => {
  let tempDir;
  const resolverPath = path.resolve(__dirname, 'config-resolver.js');

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('outputs valid JSON with expected keys when config is available', () => {
    // Create config files in tempDir so fallback works
    fs.writeFileSync(path.join(tempDir, 'env-config.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'credentials.json'), '{}', 'utf8');

    const output = execFileSync('node', [resolverPath, '--paths'], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    // On macOS, process.cwd() resolves symlinks (e.g. /var -> /private/var)
    const realTempDir = fs.realpathSync(tempDir);

    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('configDir');
    expect(parsed).toHaveProperty('configPath');
    expect(parsed).toHaveProperty('credentialsPath');
    expect(parsed).toHaveProperty('source');
    expect(parsed.configDir).toBe(realTempDir);
    expect(parsed.configPath).toBe(path.join(realTempDir, 'env-config.json'));
    expect(parsed.credentialsPath).toBe(path.join(realTempDir, 'credentials.json'));
    expect(parsed.source).toBe('fallback');
  });

  it('exits with non-zero and outputs JSON error to stderr when config is not available', () => {
    try {
      execFileSync('node', [resolverPath, '--paths'], {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Should not reach here
      expect.fail('Expected command to throw');
    } catch (err) {
      expect(err.status).not.toBe(0);
      const stderrOutput = err.stderr;
      const parsed = JSON.parse(stderrOutput);
      expect(parsed).toHaveProperty('error');
      expect(typeof parsed.error).toBe('string');
    }
  });
});

describe('CLI --set', () => {
  let tempDir;
  const resolverPath = path.resolve(__dirname, 'config-resolver.js');

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('writes the pointer file correctly and outputs success JSON', () => {
    const targetPath = '/Volumes/Keybase/private/user/';

    const output = execFileSync('node', [resolverPath, '--set', targetPath], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    // CLI should output valid JSON with success info
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(true);
    expect(parsed.path).toBe(targetPath);
    expect(parsed).toHaveProperty('pointerFile');

    // Verify the .config-path file was actually written
    const pointerContent = fs.readFileSync(path.join(tempDir, '.config-path'), 'utf8');
    expect(pointerContent).toBe(targetPath + '\n');
  });

  it('exits with non-zero when no path argument is provided', () => {
    try {
      execFileSync('node', [resolverPath, '--set'], {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect.fail('Expected command to throw');
    } catch (err) {
      expect(err.status).not.toBe(0);
      const stderrOutput = err.stderr;
      const parsed = JSON.parse(stderrOutput);
      expect(parsed).toHaveProperty('error');
      expect(parsed.error).toContain('Usage');
    }
  });
});
