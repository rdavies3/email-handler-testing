import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Import the CommonJS module - vitest handles CJS interop
import smtpSender from './smtp-sender.js';
const {
  parseArgs,
  loadCredentials,
  loadTestCase,
  loadEnvConfig,
  resolveSenderAddress,
  resolveRecipientAddress,
  buildFromHeader,
  createTransport,
  sendEmail,
  classifyError,
} = smtpSender;

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-sender-test-'));
}

describe('smtp-sender', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseArgs', () => {
    it('parses all CLI arguments', () => {
      const args = ['--test-case', 'tests/cases/test-22a.json', '--env-config', 'env-config.json', '--credentials', 'creds.json', '--mode', 'manipulated', '--env', 'DEV'];
      const result = parseArgs(args);
      expect(result.testCase).toBe('tests/cases/test-22a.json');
      expect(result.envConfig).toBe('env-config.json');
      expect(result.credentials).toBe('creds.json');
      expect(result.mode).toBe('manipulated');
      expect(result.env).toBe('DEV');
    });

    it('returns null for missing arguments and defaults mode to standard', () => {
      const result = parseArgs([]);
      expect(result.testCase).toBeNull();
      expect(result.envConfig).toBeNull();
      expect(result.credentials).toBeNull();
      expect(result.mode).toBe('standard');
      expect(result.env).toBeNull();
    });

    it('handles partial arguments', () => {
      const result = parseArgs(['--test-case', 'test.json']);
      expect(result.testCase).toBe('test.json');
      expect(result.envConfig).toBeNull();
      expect(result.credentials).toBeNull();
      expect(result.mode).toBe('standard');
    });
  });

  describe('loadCredentials', () => {
    it('loads valid credentials in standard mode (default)', () => {
      const credPath = path.join(tmpDir, 'credentials.json');
      fs.writeFileSync(credPath, JSON.stringify({
        senderEmail: 'tester@example.com',
        standardSmtp: {
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
          auth: { username: 'user', password: 'pass' },
        },
      }));

      const result = loadCredentials(credPath);
      expect(result.error).toBeNull();
      expect(result.smtp.host).toBe('smtp.gmail.com');
      expect(result.smtp.port).toBe(587);
      expect(result.smtp.auth.username).toBe('user');
      expect(result.senderEmail).toBe('tester@example.com');
    });

    it('loads manipulated credentials when mode is manipulated', () => {
      const credPath = path.join(tmpDir, 'credentials.json');
      fs.writeFileSync(credPath, JSON.stringify({
        senderEmail: 'tester@example.com',
        standardSmtp: {
          host: 'smtp.gmail.com',
          port: 587,
          auth: { username: 'user', password: 'pass' },
        },
        manipulatedSmtp: {
          host: 'smtp.custom.com',
          port: 465,
          auth: { username: 'custom-user', password: 'custom-pass' },
        },
      }));

      const result = loadCredentials(credPath, 'manipulated');
      expect(result.error).toBeNull();
      expect(result.smtp.host).toBe('smtp.custom.com');
      expect(result.smtp.port).toBe(465);
    });

    it('returns error for missing file', () => {
      const result = loadCredentials('/nonexistent/path/creds.json');
      expect(result.error).toContain('File not found');
      expect(result.smtp).toBeNull();
    });

    it('returns error for missing standardSmtp section', () => {
      const credPath = path.join(tmpDir, 'credentials.json');
      fs.writeFileSync(credPath, JSON.stringify({ senderEmail: 'test@example.com' }));

      const result = loadCredentials(credPath);
      expect(result.error).toContain('Missing standardSmtp section');
      expect(result.smtp).toBeNull();
    });

    it('returns error for missing host in standardSmtp', () => {
      const credPath = path.join(tmpDir, 'credentials.json');
      fs.writeFileSync(credPath, JSON.stringify({
        senderEmail: 'test@example.com',
        standardSmtp: { port: 587, auth: { username: 'u', password: 'p' } },
      }));

      const result = loadCredentials(credPath);
      expect(result.error).toContain('host is required');
    });

    it('returns error for missing port in standardSmtp', () => {
      const credPath = path.join(tmpDir, 'credentials.json');
      fs.writeFileSync(credPath, JSON.stringify({
        senderEmail: 'test@example.com',
        standardSmtp: { host: 'smtp.gmail.com', auth: { username: 'u', password: 'p' } },
      }));

      const result = loadCredentials(credPath);
      expect(result.error).toContain('port is required');
    });

    it('returns error for missing auth in standardSmtp', () => {
      const credPath = path.join(tmpDir, 'credentials.json');
      fs.writeFileSync(credPath, JSON.stringify({
        senderEmail: 'test@example.com',
        standardSmtp: { host: 'smtp.gmail.com', port: 587 },
      }));

      const result = loadCredentials(credPath);
      expect(result.error).toContain('auth with username and password is required');
    });
  });

  describe('loadTestCase', () => {
    it('loads a valid test case', () => {
      const tcPath = path.join(tmpDir, 'test-case.json');
      fs.writeFileSync(tcPath, JSON.stringify({
        id: '22A',
        name: 'From name match',
        emailProperties: { subject: 'Test', fromNameOverride: 'Custom Name' },
      }));

      const result = loadTestCase(tcPath);
      expect(result.error).toBeNull();
      expect(result.testCase.id).toBe('22A');
    });

    it('returns error for missing file', () => {
      const result = loadTestCase('/nonexistent/test.json');
      expect(result.error).toContain('File not found');
      expect(result.testCase).toBeNull();
    });
  });

  describe('loadEnvConfig', () => {
    it('loads a valid env-config', () => {
      const cfgPath = path.join(tmpDir, 'env-config.json');
      fs.writeFileSync(cfgPath, JSON.stringify({
        environments: {
          DEV: {
            emailAddresses: { primary: 'dev@example.com' },
          },
        },
      }));

      const result = loadEnvConfig(cfgPath);
      expect(result.error).toBeNull();
      expect(result.config.environments.DEV.emailAddresses.primary).toBe('dev@example.com');
    });

    it('returns error for missing file', () => {
      const result = loadEnvConfig('/nonexistent/config.json');
      expect(result.error).toContain('File not found');
    });
  });

  describe('resolveSenderAddress', () => {
    it('prefers senderEmail from credentials when provided', () => {
      const config = {
        environments: {
          DEV: { emailAddresses: { primary: 'dev-cases@example.com' } },
        },
      };
      expect(resolveSenderAddress(config, 'me@example.com')).toBe('me@example.com');
    });

    it('falls back to primary email from first environment when no senderEmail', () => {
      const config = {
        environments: {
          DEV: { emailAddresses: { primary: 'dev-cases@example.com' } },
          QA: { emailAddresses: { primary: 'qa-cases@example.com' } },
        },
      };
      expect(resolveSenderAddress(config, null)).toBe('dev-cases@example.com');
    });

    it('returns fallback when no environments exist', () => {
      expect(resolveSenderAddress({}, null)).toBe('test-sender@example.com');
      expect(resolveSenderAddress({ environments: {} }, null)).toBe('test-sender@example.com');
    });
  });

  describe('resolveRecipientAddress', () => {
    it('returns primary email from specified environment', () => {
      const config = {
        environments: {
          DEV: { emailAddresses: { primary: 'dev-cases@example.com' } },
          QA: { emailAddresses: { primary: 'qa-cases@example.com' } },
        },
      };
      expect(resolveRecipientAddress(config, 'QA')).toBe('qa-cases@example.com');
    });

    it('falls back to first environment when envName not specified', () => {
      const config = {
        environments: {
          DEV: { emailAddresses: { primary: 'dev-cases@example.com' } },
        },
      };
      expect(resolveRecipientAddress(config)).toBe('dev-cases@example.com');
    });

    it('returns fallback when no environments', () => {
      expect(resolveRecipientAddress({})).toBe('recipient@example.com');
    });
  });

  describe('buildFromHeader', () => {
    it('uses default sender name when fromNameOverride is null', () => {
      const result = buildFromHeader(null, 'user@example.com');
      expect(result).toBe('Test Sender <user@example.com>');
    });

    it('uses default sender name when fromNameOverride is undefined', () => {
      const result = buildFromHeader(undefined, 'user@example.com');
      expect(result).toBe('Test Sender <user@example.com>');
    });

    it('uses no display name when fromNameOverride is empty string', () => {
      const result = buildFromHeader('', 'user@example.com');
      expect(result).toBe('user@example.com');
    });

    it('uses custom display name when fromNameOverride has value', () => {
      const result = buildFromHeader('John Doe', 'user@example.com');
      expect(result).toBe('John Doe <user@example.com>');
    });

    it('truncates display name to 255 characters', () => {
      const longName = 'A'.repeat(300);
      const result = buildFromHeader(longName, 'user@example.com');
      expect(result).toBe('A'.repeat(255) + ' <user@example.com>');
    });

    it('handles single character display name', () => {
      const result = buildFromHeader('X', 'user@example.com');
      expect(result).toBe('X <user@example.com>');
    });
  });

  describe('createTransport', () => {
    it('creates transport with correct options', () => {
      const smtpConfig = {
        host: 'smtp.test.com',
        port: 587,
        secure: false,
        auth: { username: 'user', password: 'pass' },
      };

      const transport = createTransport(smtpConfig);
      expect(transport).toBeDefined();
      expect(transport.options.host).toBe('smtp.test.com');
      expect(transport.options.port).toBe(587);
      expect(transport.options.secure).toBe(false);
      transport.close();
    });

    it('creates secure transport', () => {
      const smtpConfig = {
        host: 'smtp.test.com',
        port: 465,
        secure: true,
        auth: { username: 'user', password: 'pass' },
      };

      const transport = createTransport(smtpConfig);
      expect(transport.options.secure).toBe(true);
      transport.close();
    });

    it('sets 30-second connection timeout', () => {
      const smtpConfig = {
        host: 'smtp.test.com',
        port: 587,
        secure: false,
        auth: { username: 'user', password: 'pass' },
      };

      const transport = createTransport(smtpConfig);
      expect(transport.options.connectionTimeout).toBe(30000);
      expect(transport.options.greetingTimeout).toBe(30000);
      expect(transport.options.socketTimeout).toBe(30000);
      transport.close();
    });
  });

  describe('classifyError', () => {
    it('classifies ETIMEDOUT as connection_timeout', () => {
      const err = new Error('Connection timed out');
      err.code = 'ETIMEDOUT';
      const result = classifyError(err);
      expect(result.errorType).toBe('connection_timeout');
      expect(result.exitCode).toBe(1);
    });

    it('classifies ESOCKET as connection_timeout', () => {
      const err = new Error('Socket error');
      err.code = 'ESOCKET';
      const result = classifyError(err);
      expect(result.errorType).toBe('connection_timeout');
      expect(result.exitCode).toBe(1);
    });

    it('classifies ECONNECTION as connection_timeout', () => {
      const err = new Error('Connection error');
      err.code = 'ECONNECTION';
      const result = classifyError(err);
      expect(result.errorType).toBe('connection_timeout');
      expect(result.exitCode).toBe(1);
    });

    it('classifies timeout in message as connection_timeout', () => {
      const err = new Error('Connection timeout after 30s');
      const result = classifyError(err);
      expect(result.errorType).toBe('connection_timeout');
      expect(result.exitCode).toBe(1);
    });

    it('classifies EAUTH as auth_failure', () => {
      const err = new Error('Invalid login');
      err.code = 'EAUTH';
      const result = classifyError(err);
      expect(result.errorType).toBe('auth_failure');
      expect(result.exitCode).toBe(2);
    });

    it('classifies 535 response as auth_failure', () => {
      const err = new Error('535 Authentication credentials invalid');
      const result = classifyError(err);
      expect(result.errorType).toBe('auth_failure');
      expect(result.exitCode).toBe(2);
    });

    it('classifies unknown errors as send_failure', () => {
      const err = new Error('Recipient rejected');
      const result = classifyError(err);
      expect(result.errorType).toBe('send_failure');
      expect(result.exitCode).toBe(3);
    });

    it('classifies error without message as send_failure', () => {
      const err = new Error();
      const result = classifyError(err);
      expect(result.errorType).toBe('send_failure');
      expect(result.exitCode).toBe(3);
    });
  });

  describe('JSON output format', () => {
    it('produces error JSON with success, error, and message fields for connection timeout', () => {
      const err = new Error('Connection timed out');
      err.code = 'ETIMEDOUT';
      const { errorType } = classifyError(err);
      const output = { success: false, error: errorType, message: err.message };
      expect(output).toEqual({
        success: false,
        error: 'connection_timeout',
        message: 'Connection timed out',
      });
    });

    it('produces error JSON with success, error, and message fields for auth failure', () => {
      const err = new Error('Invalid login credentials');
      err.code = 'EAUTH';
      const { errorType } = classifyError(err);
      const output = { success: false, error: errorType, message: err.message };
      expect(output).toEqual({
        success: false,
        error: 'auth_failure',
        message: 'Invalid login credentials',
      });
    });

    it('produces error JSON with success, error, and message fields for send failure', () => {
      const err = new Error('Recipient address rejected');
      const { errorType } = classifyError(err);
      const output = { success: false, error: errorType, message: err.message };
      expect(output).toEqual({
        success: false,
        error: 'send_failure',
        message: 'Recipient address rejected',
      });
    });

    it('produces success JSON with success and messageId fields', () => {
      // Simulates the shape returned by sendEmail on success
      const output = { success: true, messageId: '<abc123@smtp.test.com>' };
      expect(output.success).toBe(true);
      expect(output.messageId).toBeDefined();
      expect(typeof output.messageId).toBe('string');
      expect(output.error).toBeUndefined();
    });

    it('produces credential error JSON for missing credentials', () => {
      const credResult = loadCredentials('/nonexistent/creds.json');
      const output = { success: false, error: 'auth_failure', message: credResult.error };
      expect(output.success).toBe(false);
      expect(output.error).toBe('auth_failure');
      expect(output.message).toContain('File not found');
    });
  });

  describe('sendEmail', () => {
    it('rejects when connecting to an unreachable SMTP server', async () => {
      const smtpConfig = {
        host: '127.0.0.1',
        port: 19999, // unlikely to have SMTP running
        secure: false,
        auth: { username: 'user', password: 'pass' },
      };
      const testCase = {
        emailProperties: {
          subject: 'Test-{{timestamp}}',
          textBody: 'Hello',
          fromNameOverride: 'Custom Name',
        },
      };
      const envConfig = {
        environments: {
          DEV: { emailAddresses: { primary: 'dev@example.com' } },
        },
      };

      await expect(
        sendEmail({ smtpConfig, testCase, envConfig })
      ).rejects.toThrow();
    });
  });
});
