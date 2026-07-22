import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the CommonJS module - vitest handles CJS interop
import configLoader from './config-loader.js';
const {
  loadJsonFile,
  validateEnvConfig,
  validateCredentials,
  resolveConfig,
  parseArgs,
} = configLoader;

// Helper to create a temp directory with test files
function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-loader-test-'));
}

function writeJson(dir, filename, data) {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

// Valid test fixtures
const validEnvConfig = {
  environments: {
    DEV: {
      emailAddresses: {
        primary: 'dev-cases@example.com',
        secondary: 'dev-cases-alt@example.com',
        tertiary: 'dev-cases-third@example.com',
      },
      orgAlias: 'DevSandbox',
      orgWideEmailAddress: 'noreply-dev@example.com',
      acceptedAttachmentTypes: ['.txt', '.pdf', '.png'],
      spamFilterTerms: ['UNSUBSCRIBE', 'FREE OFFER'],
    },
    QA: {
      emailAddresses: {
        primary: 'qa-cases@example.com',
        secondary: 'qa-cases-alt@example.com',
        tertiary: 'qa-cases-third@example.com',
      },
      orgAlias: 'QaSandbox',
      orgWideEmailAddress: 'noreply-qa@example.com',
      acceptedAttachmentTypes: ['.txt', '.pdf'],
      spamFilterTerms: ['SPAM'],
    },
    UAT: {
      emailAddresses: {
        primary: 'uat-cases@example.com',
        secondary: 'uat-cases-alt@example.com',
        tertiary: 'uat-cases-third@example.com',
      },
      orgAlias: 'UatSandbox',
      orgWideEmailAddress: 'noreply-uat@example.com',
      acceptedAttachmentTypes: ['.txt'],
      spamFilterTerms: [],
    },
  },
  timing: {
    initialDelay: 30,
    maxRetries: 5,
    retryInterval: 10,
  },
  categories: {
    'basic-creation': ['02', '03', '04'],
  },
};

const validCredentials = {
  manipulatedSmtp: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: {
      username: 'test-user',
      password: 'secret',
    },
  },
};

describe('loadJsonFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads and parses a valid JSON file', () => {
    const filePath = writeJson(tmpDir, 'test.json', { key: 'value' });
    const result = loadJsonFile(filePath);
    expect(result.data).toEqual({ key: 'value' });
    expect(result.error).toBeNull();
  });

  it('returns error when file does not exist', () => {
    const result = loadJsonFile(path.join(tmpDir, 'nonexistent.json'));
    expect(result.data).toBeNull();
    expect(result.error).toContain('File not found');
  });

  it('returns error for malformed JSON', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, '{ invalid json }');
    const result = loadJsonFile(filePath);
    expect(result.data).toBeNull();
    expect(result.error).toContain('Failed to parse JSON');
  });
});

describe('validateEnvConfig', () => {
  it('returns no errors for valid config with DEV environment', () => {
    const errors = validateEnvConfig(validEnvConfig, 'DEV');
    expect(errors).toEqual([]);
  });

  it('returns no errors for valid config with QA environment', () => {
    const errors = validateEnvConfig(validEnvConfig, 'QA');
    expect(errors).toEqual([]);
  });

  it('returns no errors for valid config with UAT environment', () => {
    const errors = validateEnvConfig(validEnvConfig, 'UAT');
    expect(errors).toEqual([]);
  });

  it('returns error when config is not an object', () => {
    const errors = validateEnvConfig(null, 'DEV');
    expect(errors).toContain('Configuration must be a JSON object');
  });

  it('returns error when environments field is missing', () => {
    const errors = validateEnvConfig({}, 'DEV');
    expect(errors).toContain('Missing required field: environments');
  });

  it('returns error when target environment is not found', () => {
    const errors = validateEnvConfig(validEnvConfig, 'STAGING');
    expect(errors[0]).toContain("Environment 'STAGING' not found");
    expect(errors[0]).toContain('DEV');
    expect(errors[0]).toContain('QA');
    expect(errors[0]).toContain('UAT');
  });

  it('returns error when emailAddresses is missing', () => {
    const config = {
      environments: {
        DEV: {
          orgAlias: 'DevSandbox',
          orgWideEmailAddress: 'noreply@example.com',
          acceptedAttachmentTypes: ['.txt'],
          spamFilterTerms: [],
        },
      },
    };
    const errors = validateEnvConfig(config, 'DEV');
    expect(errors.some(e => e.includes('emailAddresses'))).toBe(true);
  });

  it('returns error when primary email address is missing', () => {
    const config = {
      environments: {
        DEV: {
          emailAddresses: {
            secondary: 'sec@example.com',
            tertiary: 'ter@example.com',
          },
          orgAlias: 'DevSandbox',
          orgWideEmailAddress: 'noreply@example.com',
          acceptedAttachmentTypes: ['.txt'],
          spamFilterTerms: [],
        },
      },
    };
    const errors = validateEnvConfig(config, 'DEV');
    expect(errors.some(e => e.includes('primary'))).toBe(true);
  });

  it('returns error when orgAlias is missing', () => {
    const config = {
      environments: {
        DEV: {
          emailAddresses: {
            primary: 'p@example.com',
            secondary: 's@example.com',
            tertiary: 't@example.com',
          },
          orgWideEmailAddress: 'noreply@example.com',
          acceptedAttachmentTypes: ['.txt'],
          spamFilterTerms: [],
        },
      },
    };
    const errors = validateEnvConfig(config, 'DEV');
    expect(errors.some(e => e.includes('orgAlias'))).toBe(true);
  });

  it('returns error when timing.initialDelay is below minimum', () => {
    const config = { ...validEnvConfig, timing: { initialDelay: 2, maxRetries: 5, retryInterval: 10 } };
    const errors = validateEnvConfig(config, 'DEV');
    expect(errors.some(e => e.includes('initialDelay'))).toBe(true);
  });

  it('returns error when timing.maxRetries exceeds maximum', () => {
    const config = { ...validEnvConfig, timing: { initialDelay: 30, maxRetries: 25, retryInterval: 10 } };
    const errors = validateEnvConfig(config, 'DEV');
    expect(errors.some(e => e.includes('maxRetries'))).toBe(true);
  });

  it('returns error when timing.retryInterval is below minimum', () => {
    const config = { ...validEnvConfig, timing: { initialDelay: 30, maxRetries: 5, retryInterval: 1 } };
    const errors = validateEnvConfig(config, 'DEV');
    expect(errors.some(e => e.includes('retryInterval'))).toBe(true);
  });

  it('returns error when email address exceeds 256 characters', () => {
    const config = {
      environments: {
        DEV: {
          emailAddresses: {
            primary: 'a'.repeat(257),
            secondary: 's@example.com',
            tertiary: 't@example.com',
          },
          orgAlias: 'DevSandbox',
          orgWideEmailAddress: 'noreply@example.com',
          acceptedAttachmentTypes: ['.txt'],
          spamFilterTerms: [],
        },
      },
    };
    const errors = validateEnvConfig(config, 'DEV');
    expect(errors.some(e => e.includes('256 characters'))).toBe(true);
  });

  it('returns error when acceptedAttachmentTypes is empty', () => {
    const config = {
      environments: {
        DEV: {
          emailAddresses: {
            primary: 'p@example.com',
            secondary: 's@example.com',
            tertiary: 't@example.com',
          },
          orgAlias: 'DevSandbox',
          orgWideEmailAddress: 'noreply@example.com',
          acceptedAttachmentTypes: [],
          spamFilterTerms: [],
        },
      },
    };
    const errors = validateEnvConfig(config, 'DEV');
    expect(errors.some(e => e.includes('acceptedAttachmentTypes'))).toBe(true);
  });
});

describe('validateCredentials', () => {
  it('returns no errors for valid credentials', () => {
    const errors = validateCredentials(validCredentials);
    expect(errors).toEqual([]);
  });

  it('returns error when credentials is not an object', () => {
    const errors = validateCredentials(null);
    expect(errors).toContain('Credentials must be a JSON object');
  });

  it('returns error when manipulatedSmtp is missing', () => {
    const errors = validateCredentials({});
    expect(errors).toContain('Missing required field: manipulatedSmtp');
  });

  it('returns error when host is missing', () => {
    const errors = validateCredentials({
      manipulatedSmtp: { port: 587, auth: { username: 'u', password: 'p' } },
    });
    expect(errors.some(e => e.includes('host'))).toBe(true);
  });

  it('returns error when port is missing', () => {
    const errors = validateCredentials({
      manipulatedSmtp: { host: 'smtp.example.com', auth: { username: 'u', password: 'p' } },
    });
    expect(errors.some(e => e.includes('port'))).toBe(true);
  });

  it('returns error when auth section is missing', () => {
    const errors = validateCredentials({
      manipulatedSmtp: { host: 'smtp.example.com', port: 587 },
    });
    expect(errors.some(e => e.includes('auth'))).toBe(true);
  });

  it('returns error when auth.username is missing', () => {
    const errors = validateCredentials({
      manipulatedSmtp: { host: 'smtp.example.com', port: 587, auth: { password: 'p' } },
    });
    expect(errors.some(e => e.includes('username'))).toBe(true);
  });

  it('returns error when auth.password is missing', () => {
    const errors = validateCredentials({
      manipulatedSmtp: { host: 'smtp.example.com', port: 587, auth: { username: 'u' } },
    });
    expect(errors.some(e => e.includes('password'))).toBe(true);
  });
});

describe('resolveConfig', () => {
  it('resolves DEV environment correctly', () => {
    const resolved = resolveConfig(validEnvConfig, validCredentials, 'DEV');
    expect(resolved.environment).toBe('DEV');
    expect(resolved.emailAddresses.primary).toBe('dev-cases@example.com');
    expect(resolved.orgAlias).toBe('DevSandbox');
    expect(resolved.orgWideEmailAddress).toBe('noreply-dev@example.com');
    expect(resolved.timing.initialDelay).toBe(30);
    expect(resolved.timing.maxRetries).toBe(5);
    expect(resolved.timing.retryInterval).toBe(10);
    expect(resolved.smtp.manipulated.host).toBe('smtp.example.com');
  });

  it('resolves QA environment correctly', () => {
    const resolved = resolveConfig(validEnvConfig, validCredentials, 'QA');
    expect(resolved.environment).toBe('QA');
    expect(resolved.emailAddresses.primary).toBe('qa-cases@example.com');
    expect(resolved.orgAlias).toBe('QaSandbox');
  });

  it('uses default timing values when timing section is missing', () => {
    const configNoTiming = { ...validEnvConfig, timing: undefined };
    const resolved = resolveConfig(configNoTiming, validCredentials, 'DEV');
    expect(resolved.timing.initialDelay).toBe(30);
    expect(resolved.timing.maxRetries).toBe(5);
    expect(resolved.timing.retryInterval).toBe(10);
  });

  it('includes categories in resolved config', () => {
    const resolved = resolveConfig(validEnvConfig, validCredentials, 'DEV');
    expect(resolved.categories['basic-creation']).toEqual(['02', '03', '04']);
  });

  it('includes acceptedAttachmentTypes and spamFilterTerms', () => {
    const resolved = resolveConfig(validEnvConfig, validCredentials, 'DEV');
    expect(resolved.acceptedAttachmentTypes).toEqual(['.txt', '.pdf', '.png']);
    expect(resolved.spamFilterTerms).toEqual(['UNSUBSCRIBE', 'FREE OFFER']);
  });
});

describe('parseArgs', () => {
  it('parses --env argument', () => {
    const result = parseArgs(['--env', 'DEV']);
    expect(result.env).toBe('DEV');
  });

  it('parses --config argument', () => {
    const result = parseArgs(['--config', 'my-config.json']);
    expect(result.config).toBe('my-config.json');
  });

  it('parses --credentials argument', () => {
    const result = parseArgs(['--credentials', 'my-creds.json']);
    expect(result.credentials).toBe('my-creds.json');
  });

  it('parses all arguments together', () => {
    const result = parseArgs(['--env', 'QA', '--config', 'c.json', '--credentials', 'cr.json']);
    expect(result.env).toBe('QA');
    expect(result.config).toBe('c.json');
    expect(result.credentials).toBe('cr.json');
  });

  it('returns null for missing arguments', () => {
    const result = parseArgs([]);
    expect(result.env).toBeNull();
    expect(result.config).toBeNull();
    expect(result.credentials).toBeNull();
  });
});

describe('CLI integration', () => {
  let tmpDir;
  const configLoaderPath = path.resolve(__dirname, 'config-loader.js');

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('outputs resolved config JSON to stdout on success', () => {
    writeJson(tmpDir, 'env-config.json', validEnvConfig);
    writeJson(tmpDir, 'credentials.json', validCredentials);

    const result = execFileSync('node', [
      configLoaderPath,
      '--env', 'DEV',
      '--config', path.join(tmpDir, 'env-config.json'),
      '--credentials', path.join(tmpDir, 'credentials.json'),
    ], { encoding: 'utf8' });

    const parsed = JSON.parse(result);
    expect(parsed.environment).toBe('DEV');
    expect(parsed.emailAddresses.primary).toBe('dev-cases@example.com');
  });

  it('exits with non-zero code when --env is missing', () => {
    expect(() => {
      execFileSync('node', [configLoaderPath], { encoding: 'utf8', stdio: 'pipe' });
    }).toThrow();
  });

  it('exits with non-zero code when config file is missing', () => {
    writeJson(tmpDir, 'credentials.json', validCredentials);
    expect(() => {
      execFileSync('node', [
        configLoaderPath,
        '--env', 'DEV',
        '--config', path.join(tmpDir, 'missing.json'),
        '--credentials', path.join(tmpDir, 'credentials.json'),
      ], { encoding: 'utf8', stdio: 'pipe' });
    }).toThrow();
  });

  it('exits with non-zero code when credentials file is missing', () => {
    writeJson(tmpDir, 'env-config.json', validEnvConfig);
    expect(() => {
      execFileSync('node', [
        configLoaderPath,
        '--env', 'DEV',
        '--config', path.join(tmpDir, 'env-config.json'),
        '--credentials', path.join(tmpDir, 'missing-creds.json'),
      ], { encoding: 'utf8', stdio: 'pipe' });
    }).toThrow();
  });

  it('exits with non-zero code for invalid environment name', () => {
    writeJson(tmpDir, 'env-config.json', validEnvConfig);
    writeJson(tmpDir, 'credentials.json', validCredentials);
    expect(() => {
      execFileSync('node', [
        configLoaderPath,
        '--env', 'STAGING',
        '--config', path.join(tmpDir, 'env-config.json'),
        '--credentials', path.join(tmpDir, 'credentials.json'),
      ], { encoding: 'utf8', stdio: 'pipe' });
    }).toThrow();
  });

  it('exits with non-zero code for malformed JSON config', () => {
    const badJsonPath = path.join(tmpDir, 'bad-config.json');
    fs.writeFileSync(badJsonPath, '{ not valid json }');
    writeJson(tmpDir, 'credentials.json', validCredentials);
    expect(() => {
      execFileSync('node', [
        configLoaderPath,
        '--env', 'DEV',
        '--config', badJsonPath,
        '--credentials', path.join(tmpDir, 'credentials.json'),
      ], { encoding: 'utf8', stdio: 'pipe' });
    }).toThrow();
  });
});
