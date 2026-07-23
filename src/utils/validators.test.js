import { describe, it, expect } from 'vitest';
import {
  validateEnvConfig,
  validateCredentials,
  validateTiming,
  validateEnvironment
} from './validators.js';

// --- Helpers ---

function validEnvConfig() {
  return {
    environments: {
      DEV: {
        emailAddresses: {
          primary: 'dev@example.com',
          secondary: 'dev-alt@example.com',
          tertiary: 'dev-third@example.com'
        },
        orgAlias: 'DevSandbox',
        orgWideEmailAddress: 'noreply-dev@example.com',
        acceptedAttachmentTypes: ['.txt', '.pdf'],
        spamFilterTerms: ['UNSUBSCRIBE']
      }
    },
    timing: {
      initialDelay: 30,
      maxRetries: 5,
      retryInterval: 10
    },
    categories: {
      'basic-creation': ['02', '03']
    }
  };
}

function validCredentials() {
  return {
    manipulatedSmtp: {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        username: 'test-user',
        password: 'secret'
      }
    }
  };
}

// --- validateEnvConfig ---

describe('validateEnvConfig', () => {
  it('returns valid for a complete config', () => {
    const res = validateEnvConfig(validEnvConfig());
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('rejects null config', () => {
    const res = validateEnvConfig(null);
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('config');
  });

  it('rejects non-object config', () => {
    const res = validateEnvConfig('string');
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('config');
  });

  it('rejects array config', () => {
    const res = validateEnvConfig([]);
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('config');
  });

  it('rejects missing environments', () => {
    const config = validEnvConfig();
    delete config.environments;
    const res = validateEnvConfig(config);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'environments')).toBe(true);
  });

  it('rejects empty environments object', () => {
    const config = validEnvConfig();
    config.environments = {};
    const res = validateEnvConfig(config);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'environments')).toBe(true);
  });

  it('rejects missing timing', () => {
    const config = validEnvConfig();
    delete config.timing;
    const res = validateEnvConfig(config);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing')).toBe(true);
  });

  it('rejects missing categories', () => {
    const config = validEnvConfig();
    delete config.categories;
    const res = validateEnvConfig(config);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'categories')).toBe(true);
  });

  it('validates environment entries and reports nested errors', () => {
    const config = validEnvConfig();
    delete config.environments.DEV.orgAlias;
    const res = validateEnvConfig(config);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'environments.DEV.orgAlias')).toBe(true);
  });

  it('validates multiple environments', () => {
    const config = validEnvConfig();
    config.environments.QA = { ...config.environments.DEV };
    delete config.environments.QA.emailAddresses;
    const res = validateEnvConfig(config);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'environments.QA.emailAddresses')).toBe(true);
  });
});

// --- validateCredentials ---

describe('validateCredentials', () => {
  it('returns valid for complete credentials', () => {
    const res = validateCredentials(validCredentials());
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('rejects null credentials', () => {
    const res = validateCredentials(null);
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('credentials');
  });

  it('rejects missing manipulatedSmtp section', () => {
    const res = validateCredentials({});
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'credentials.manipulatedSmtp')).toBe(true);
  });

  it('rejects missing host', () => {
    const creds = validCredentials();
    delete creds.manipulatedSmtp.host;
    const res = validateCredentials(creds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'credentials.manipulatedSmtp.host')).toBe(true);
  });

  it('rejects missing port', () => {
    const creds = validCredentials();
    delete creds.manipulatedSmtp.port;
    const res = validateCredentials(creds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'credentials.manipulatedSmtp.port')).toBe(true);
  });

  it('rejects non-numeric port', () => {
    const creds = validCredentials();
    creds.manipulatedSmtp.port = 'abc';
    const res = validateCredentials(creds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'credentials.manipulatedSmtp.port')).toBe(true);
  });

  it('rejects missing username in auth', () => {
    const creds = validCredentials();
    delete creds.manipulatedSmtp.auth.username;
    const res = validateCredentials(creds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'credentials.manipulatedSmtp.auth.username')).toBe(true);
  });

  it('rejects missing password in auth', () => {
    const creds = validCredentials();
    delete creds.manipulatedSmtp.auth.password;
    const res = validateCredentials(creds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'credentials.manipulatedSmtp.auth.password')).toBe(true);
  });

  it('accepts credentials with username/password at top level (no auth wrapper)', () => {
    const creds = {
      manipulatedSmtp: {
        host: 'smtp.example.com',
        port: 587,
        username: 'user',
        password: 'pass'
      }
    };
    const res = validateCredentials(creds);
    expect(res.valid).toBe(true);
  });
});

// --- validateTiming ---

describe('validateTiming', () => {
  it('returns valid for correct timing', () => {
    const res = validateTiming({ initialDelay: 30, maxRetries: 5, retryInterval: 10 });
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('accepts minimum valid values', () => {
    const res = validateTiming({ initialDelay: 5, maxRetries: 1, retryInterval: 2 });
    expect(res.valid).toBe(true);
  });

  it('rejects null timing', () => {
    const res = validateTiming(null);
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('timing');
  });

  it('rejects missing initialDelay', () => {
    const res = validateTiming({ maxRetries: 5, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.initialDelay')).toBe(true);
  });

  it('rejects non-numeric initialDelay', () => {
    const res = validateTiming({ initialDelay: 'abc', maxRetries: 5, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.initialDelay')).toBe(true);
  });

  it('rejects negative initialDelay', () => {
    const res = validateTiming({ initialDelay: -1, maxRetries: 5, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.initialDelay' && e.message.includes('negative'))).toBe(true);
  });

  it('rejects initialDelay below minimum (5)', () => {
    const res = validateTiming({ initialDelay: 3, maxRetries: 5, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.initialDelay' && e.message.includes('at least 5'))).toBe(true);
  });

  it('rejects missing retryInterval', () => {
    const res = validateTiming({ initialDelay: 30, maxRetries: 5 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.retryInterval')).toBe(true);
  });

  it('rejects negative retryInterval', () => {
    const res = validateTiming({ initialDelay: 30, maxRetries: 5, retryInterval: -5 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.retryInterval' && e.message.includes('negative'))).toBe(true);
  });

  it('rejects retryInterval below minimum (2)', () => {
    const res = validateTiming({ initialDelay: 30, maxRetries: 5, retryInterval: 1 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.retryInterval' && e.message.includes('at least 2'))).toBe(true);
  });

  it('rejects missing maxRetries', () => {
    const res = validateTiming({ initialDelay: 30, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.maxRetries')).toBe(true);
  });

  it('rejects negative maxRetries', () => {
    const res = validateTiming({ initialDelay: 30, maxRetries: -1, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.maxRetries' && e.message.includes('negative'))).toBe(true);
  });

  it('rejects maxRetries exceeding 20', () => {
    const res = validateTiming({ initialDelay: 30, maxRetries: 25, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.maxRetries' && e.message.includes('exceed 20'))).toBe(true);
  });

  it('rejects maxRetries of 0', () => {
    const res = validateTiming({ initialDelay: 30, maxRetries: 0, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.maxRetries' && e.message.includes('at least 1'))).toBe(true);
  });

  it('rejects Infinity as initialDelay', () => {
    const res = validateTiming({ initialDelay: Infinity, maxRetries: 5, retryInterval: 10 });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.initialDelay')).toBe(true);
  });

  it('rejects NaN as retryInterval', () => {
    const res = validateTiming({ initialDelay: 30, maxRetries: 5, retryInterval: NaN });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'timing.retryInterval')).toBe(true);
  });
});

// --- validateEnvironment ---

describe('validateEnvironment', () => {
  it('returns valid when environment exists and has required fields', () => {
    const res = validateEnvironment(validEnvConfig(), 'DEV');
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('rejects null config', () => {
    const res = validateEnvironment(null, 'DEV');
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('config');
  });

  it('rejects config without environments key', () => {
    const res = validateEnvironment({}, 'DEV');
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'environments')).toBe(true);
  });

  it('rejects empty envName', () => {
    const res = validateEnvironment(validEnvConfig(), '');
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'envName')).toBe(true);
  });

  it('rejects non-existent environment and lists valid options', () => {
    const res = validateEnvironment(validEnvConfig(), 'STAGING');
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('environments.STAGING');
    expect(res.errors[0].message).toContain('DEV');
  });

  it('reports missing fields in existing environment', () => {
    const config = validEnvConfig();
    delete config.environments.DEV.orgAlias;
    const res = validateEnvironment(config, 'DEV');
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'environments.DEV.orgAlias')).toBe(true);
  });

  it('reports missing email addresses', () => {
    const config = validEnvConfig();
    delete config.environments.DEV.emailAddresses.secondary;
    const res = validateEnvironment(config, 'DEV');
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.field === 'environments.DEV.emailAddresses.secondary')).toBe(true);
  });
});
