'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load and parse a JSON file from disk.
 * @param {string} filePath - Absolute or relative path to the JSON file
 * @returns {{ data: object|null, error: string|null }}
 */
function loadJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { data: null, error: `File not found: ${resolved}` };
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const data = JSON.parse(raw);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: `Failed to parse JSON in ${resolved}: ${err.message}` };
  }
}

/**
 * Validate env-config structure against schema expectations.
 * @param {object} config - Parsed env-config object
 * @param {string} envName - Target environment name (DEV, QA, UAT)
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateEnvConfig(config, envName) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    errors.push('Configuration must be a JSON object');
    return errors;
  }

  // Check top-level required fields
  if (!config.environments || typeof config.environments !== 'object') {
    errors.push('Missing required field: environments');
    return errors;
  }

  // Check that target environment exists
  const validEnvs = Object.keys(config.environments);
  if (!config.environments[envName]) {
    errors.push(
      `Environment '${envName}' not found. Valid environments are: ${validEnvs.join(', ')}`
    );
    return errors;
  }

  const env = config.environments[envName];

  // Validate emailAddresses
  if (!env.emailAddresses || typeof env.emailAddresses !== 'object') {
    errors.push(`environments.${envName}.emailAddresses is required and must be an object`);
  } else {
    const requiredAddresses = ['primary', 'secondary', 'tertiary'];
    for (const addr of requiredAddresses) {
      if (!env.emailAddresses[addr] || typeof env.emailAddresses[addr] !== 'string') {
        errors.push(`environments.${envName}.emailAddresses.${addr} is required and must be a string`);
      } else if (env.emailAddresses[addr].length > 256) {
        errors.push(`environments.${envName}.emailAddresses.${addr} must be 256 characters or fewer`);
      }
    }
  }

  // Validate orgAlias
  if (!env.orgAlias || typeof env.orgAlias !== 'string') {
    errors.push(`environments.${envName}.orgAlias is required and must be a string`);
  } else if (env.orgAlias.length > 128) {
    errors.push(`environments.${envName}.orgAlias must be 128 characters or fewer`);
  }

  // Validate orgWideEmailAddress
  if (!env.orgWideEmailAddress || typeof env.orgWideEmailAddress !== 'string') {
    errors.push(`environments.${envName}.orgWideEmailAddress is required and must be a string`);
  }

  // Validate acceptedAttachmentTypes
  if (!Array.isArray(env.acceptedAttachmentTypes) || env.acceptedAttachmentTypes.length === 0) {
    errors.push(`environments.${envName}.acceptedAttachmentTypes is required and must be a non-empty array`);
  }

  // Validate spamFilterTerms
  if (!Array.isArray(env.spamFilterTerms)) {
    errors.push(`environments.${envName}.spamFilterTerms is required and must be an array`);
  }

  // Validate timing section
  if (config.timing) {
    if (typeof config.timing !== 'object') {
      errors.push('timing must be an object');
    } else {
      if (config.timing.initialDelay !== undefined) {
        if (typeof config.timing.initialDelay !== 'number' || config.timing.initialDelay < 5) {
          errors.push('timing.initialDelay must be a number >= 5');
        }
      }
      if (config.timing.maxRetries !== undefined) {
        if (!Number.isInteger(config.timing.maxRetries) || config.timing.maxRetries < 1 || config.timing.maxRetries > 20) {
          errors.push('timing.maxRetries must be an integer between 1 and 20');
        }
      }
      if (config.timing.retryInterval !== undefined) {
        if (typeof config.timing.retryInterval !== 'number' || config.timing.retryInterval < 2) {
          errors.push('timing.retryInterval must be a number >= 2');
        }
      }
    }
  }

  return errors;
}

/**
 * Validate credentials structure.
 * @param {object} credentials - Parsed credentials object
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateCredentials(credentials) {
  const errors = [];

  if (!credentials || typeof credentials !== 'object') {
    errors.push('Credentials must be a JSON object');
    return errors;
  }

  if (!credentials.manipulatedSmtp || typeof credentials.manipulatedSmtp !== 'object') {
    errors.push('Missing required field: manipulatedSmtp');
    return errors;
  }

  const smtp = credentials.manipulatedSmtp;
  const requiredFields = ['host', 'port'];

  for (const field of requiredFields) {
    if (smtp[field] === undefined || smtp[field] === null) {
      errors.push(`manipulatedSmtp.${field} is required`);
    }
  }

  if (smtp.host !== undefined && typeof smtp.host !== 'string') {
    errors.push('manipulatedSmtp.host must be a string');
  }

  if (smtp.port !== undefined && typeof smtp.port !== 'number') {
    errors.push('manipulatedSmtp.port must be a number');
  }

  // Validate auth section
  if (!smtp.auth || typeof smtp.auth !== 'object') {
    errors.push('manipulatedSmtp.auth is required and must be an object');
  } else {
    if (!smtp.auth.username || typeof smtp.auth.username !== 'string') {
      errors.push('manipulatedSmtp.auth.username is required and must be a string');
    }
    if (!smtp.auth.password || typeof smtp.auth.password !== 'string') {
      errors.push('manipulatedSmtp.auth.password is required and must be a string');
    }
  }

  return errors;
}

/**
 * Resolve the full configuration for a target environment.
 * Merges environment settings with timing and credentials.
 * @param {object} config - Parsed env-config object
 * @param {object} credentials - Parsed credentials object
 * @param {string} envName - Target environment name
 * @returns {object} Resolved configuration object
 */
function resolveConfig(config, credentials, envName) {
  const env = config.environments[envName];
  return {
    environment: envName,
    emailAddresses: env.emailAddresses,
    orgAlias: env.orgAlias,
    orgWideEmailAddress: env.orgWideEmailAddress,
    acceptedAttachmentTypes: env.acceptedAttachmentTypes,
    spamFilterTerms: env.spamFilterTerms,
    timing: {
      initialDelay: (config.timing && config.timing.initialDelay) || 30,
      maxRetries: (config.timing && config.timing.maxRetries) || 5,
      retryInterval: (config.timing && config.timing.retryInterval) || 10,
    },
    categories: config.categories || {},
    smtp: {
      manipulated: credentials.manipulatedSmtp,
    },
  };
}

/**
 * Parse CLI arguments.
 * @param {string[]} args - Process argv (from index 2)
 * @returns {{ env: string|null, config: string|null, credentials: string|null }}
 */
function parseArgs(args) {
  const result = { env: null, config: null, credentials: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--env':
        result.env = args[++i] || null;
        break;
      case '--config':
        result.config = args[++i] || null;
        break;
      case '--credentials':
        result.credentials = args[++i] || null;
        break;
    }
  }
  return result;
}

/**
 * Main entry point for CLI usage.
 * Loads config and credentials, validates, resolves for target env, outputs JSON.
 */
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.env) {
    process.stderr.write('ERROR: --env argument is required (DEV, QA, or UAT)\n');
    process.exit(1);
  }

  const configPath = args.config || 'env-config.json';
  const credentialsPath = args.credentials || 'credentials.json';

  // Load env-config
  const configResult = loadJsonFile(configPath);
  if (configResult.error) {
    process.stderr.write(`ERROR: Configuration - ${configResult.error}\n`);
    process.stderr.write(`  Action: Create the file from env-config.template.json\n`);
    process.exit(1);
  }

  // Load credentials
  const credResult = loadJsonFile(credentialsPath);
  if (credResult.error) {
    process.stderr.write(`ERROR: Credentials - ${credResult.error}\n`);
    process.stderr.write(`  Action: Create the file from credentials.template.json\n`);
    process.exit(1);
  }

  // Validate env-config
  const configErrors = validateEnvConfig(configResult.data, args.env);
  if (configErrors.length > 0) {
    process.stderr.write(`ERROR: Configuration validation failed:\n`);
    for (const err of configErrors) {
      process.stderr.write(`  - ${err}\n`);
    }
    process.exit(1);
  }

  // Validate credentials
  const credErrors = validateCredentials(credResult.data);
  if (credErrors.length > 0) {
    process.stderr.write(`ERROR: Credentials validation failed:\n`);
    for (const err of credErrors) {
      process.stderr.write(`  - ${err}\n`);
    }
    process.exit(1);
  }

  // Resolve and output
  const resolved = resolveConfig(configResult.data, credResult.data, args.env);
  process.stdout.write(JSON.stringify(resolved, null, 2) + '\n');
  process.exit(0);
}

// Export functions for use as a module
module.exports = {
  loadJsonFile,
  validateEnvConfig,
  validateCredentials,
  resolveConfig,
  parseArgs,
};

// Run as CLI if invoked directly
if (require.main === module) {
  main();
}
