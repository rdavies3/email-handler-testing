'use strict';

/**
 * Validates environment configuration, credentials, and timing settings.
 * Returns structured error objects with field paths and messages.
 */

/**
 * Creates a validation result object.
 * @param {Array<{field: string, message: string}>} errors
 * @returns {{valid: boolean, errors: Array<{field: string, message: string}>}}
 */
function result(errors) {
  return { valid: errors.length === 0, errors };
}

/**
 * Validates the full env-config structure.
 * Checks for required top-level fields: environments, timing, categories.
 * @param {*} config - The parsed env-config object
 * @returns {{valid: boolean, errors: Array<{field: string, message: string}>}}
 */
function validateEnvConfig(config) {
  const errors = [];

  if (config === null || config === undefined || typeof config !== 'object' || Array.isArray(config)) {
    errors.push({ field: 'config', message: 'Configuration must be a non-null object' });
    return result(errors);
  }

  // Required top-level fields
  if (!config.environments || typeof config.environments !== 'object' || Array.isArray(config.environments)) {
    errors.push({ field: 'environments', message: 'Missing or invalid "environments" object' });
  } else if (Object.keys(config.environments).length === 0) {
    errors.push({ field: 'environments', message: '"environments" must contain at least one environment' });
  } else {
    // Validate each environment entry
    for (const [envName, envConfig] of Object.entries(config.environments)) {
      const envErrors = validateEnvironmentEntry(envConfig, envName);
      errors.push(...envErrors);
    }
  }

  if (!config.timing || typeof config.timing !== 'object' || Array.isArray(config.timing)) {
    errors.push({ field: 'timing', message: 'Missing or invalid "timing" object' });
  } else {
    const timingResult = validateTiming(config.timing);
    errors.push(...timingResult.errors);
  }

  if (!config.categories || typeof config.categories !== 'object' || Array.isArray(config.categories)) {
    errors.push({ field: 'categories', message: 'Missing or invalid "categories" object' });
  }

  return result(errors);
}

/**
 * Validates a single environment entry's required fields.
 * @param {*} envConfig - The environment configuration object
 * @param {string} envName - The environment name (e.g. "DEV")
 * @returns {Array<{field: string, message: string}>}
 */
function validateEnvironmentEntry(envConfig, envName) {
  const errors = [];
  const prefix = `environments.${envName}`;

  if (!envConfig || typeof envConfig !== 'object' || Array.isArray(envConfig)) {
    errors.push({ field: prefix, message: `Environment "${envName}" must be an object` });
    return errors;
  }

  // emailAddresses
  if (!envConfig.emailAddresses || typeof envConfig.emailAddresses !== 'object' || Array.isArray(envConfig.emailAddresses)) {
    errors.push({ field: `${prefix}.emailAddresses`, message: `Missing or invalid "emailAddresses" in environment "${envName}"` });
  } else {
    for (const key of ['primary', 'secondary', 'tertiary']) {
      if (!envConfig.emailAddresses[key] || typeof envConfig.emailAddresses[key] !== 'string') {
        errors.push({ field: `${prefix}.emailAddresses.${key}`, message: `Missing or invalid "${key}" email address in environment "${envName}"` });
      }
    }
  }

  // orgAlias
  if (!envConfig.orgAlias || typeof envConfig.orgAlias !== 'string') {
    errors.push({ field: `${prefix}.orgAlias`, message: `Missing or invalid "orgAlias" in environment "${envName}"` });
  }

  // orgWideEmailAddress
  if (!envConfig.orgWideEmailAddress || typeof envConfig.orgWideEmailAddress !== 'string') {
    errors.push({ field: `${prefix}.orgWideEmailAddress`, message: `Missing or invalid "orgWideEmailAddress" in environment "${envName}"` });
  }

  // acceptedAttachmentTypes
  if (!Array.isArray(envConfig.acceptedAttachmentTypes) || envConfig.acceptedAttachmentTypes.length === 0) {
    errors.push({ field: `${prefix}.acceptedAttachmentTypes`, message: `Missing or empty "acceptedAttachmentTypes" in environment "${envName}"` });
  }

  // spamFilterTerms
  if (!Array.isArray(envConfig.spamFilterTerms)) {
    errors.push({ field: `${prefix}.spamFilterTerms`, message: `Missing "spamFilterTerms" in environment "${envName}"` });
  }

  return errors;
}

/**
 * Validates credentials structure.
 * Each SMTP section must have: host, port, username, password.
 * @param {*} credentials - The parsed credentials object
 * @returns {{valid: boolean, errors: Array<{field: string, message: string}>}}
 */
function validateCredentials(credentials) {
  const errors = [];

  if (credentials === null || credentials === undefined || typeof credentials !== 'object' || Array.isArray(credentials)) {
    errors.push({ field: 'credentials', message: 'Credentials must be a non-null object' });
    return result(errors);
  }

  // Validate manipulatedSmtp section
  if (!credentials.manipulatedSmtp || typeof credentials.manipulatedSmtp !== 'object' || Array.isArray(credentials.manipulatedSmtp)) {
    errors.push({ field: 'credentials.manipulatedSmtp', message: 'Missing or invalid "manipulatedSmtp" section' });
  } else {
    const smtpErrors = validateSmtpSection(credentials.manipulatedSmtp, 'credentials.manipulatedSmtp');
    errors.push(...smtpErrors);
  }

  return result(errors);
}

/**
 * Validates a single SMTP section for required fields.
 * @param {*} smtp - The SMTP configuration object
 * @param {string} prefix - Field path prefix for error messages
 * @returns {Array<{field: string, message: string}>}
 */
function validateSmtpSection(smtp, prefix) {
  const errors = [];

  if (!smtp.host || typeof smtp.host !== 'string') {
    errors.push({ field: `${prefix}.host`, message: 'Missing or invalid "host" (must be a non-empty string)' });
  }

  if (smtp.port === undefined || smtp.port === null || typeof smtp.port !== 'number' || !Number.isFinite(smtp.port)) {
    errors.push({ field: `${prefix}.port`, message: 'Missing or invalid "port" (must be a number)' });
  }

  // username and password can be nested in auth or at top level
  const auth = smtp.auth || smtp;
  const authPrefix = smtp.auth ? `${prefix}.auth` : prefix;

  if (!auth.username || typeof auth.username !== 'string') {
    errors.push({ field: `${authPrefix}.username`, message: 'Missing or invalid "username" (must be a non-empty string)' });
  }

  if (!auth.password || typeof auth.password !== 'string') {
    errors.push({ field: `${authPrefix}.password`, message: 'Missing or invalid "password" (must be a non-empty string)' });
  }

  return errors;
}

/**
 * Validates timing configuration.
 * Checks: non-negative, minimum thresholds (initialDelay >= 5, retryInterval >= 2, maxRetries <= 20).
 * @param {*} timing - The timing configuration object
 * @returns {{valid: boolean, errors: Array<{field: string, message: string}>}}
 */
function validateTiming(timing) {
  const errors = [];

  if (timing === null || timing === undefined || typeof timing !== 'object' || Array.isArray(timing)) {
    errors.push({ field: 'timing', message: 'Timing must be a non-null object' });
    return result(errors);
  }

  // initialDelay: must be a number >= 5
  if (timing.initialDelay === undefined || timing.initialDelay === null) {
    errors.push({ field: 'timing.initialDelay', message: 'Missing "initialDelay"' });
  } else if (typeof timing.initialDelay !== 'number' || !Number.isFinite(timing.initialDelay)) {
    errors.push({ field: 'timing.initialDelay', message: '"initialDelay" must be a valid number' });
  } else if (timing.initialDelay < 0) {
    errors.push({ field: 'timing.initialDelay', message: '"initialDelay" must not be negative' });
  } else if (timing.initialDelay < 5) {
    errors.push({ field: 'timing.initialDelay', message: '"initialDelay" must be at least 5 seconds' });
  }

  // retryInterval: must be a number >= 2
  if (timing.retryInterval === undefined || timing.retryInterval === null) {
    errors.push({ field: 'timing.retryInterval', message: 'Missing "retryInterval"' });
  } else if (typeof timing.retryInterval !== 'number' || !Number.isFinite(timing.retryInterval)) {
    errors.push({ field: 'timing.retryInterval', message: '"retryInterval" must be a valid number' });
  } else if (timing.retryInterval < 0) {
    errors.push({ field: 'timing.retryInterval', message: '"retryInterval" must not be negative' });
  } else if (timing.retryInterval < 2) {
    errors.push({ field: 'timing.retryInterval', message: '"retryInterval" must be at least 2 seconds' });
  }

  // maxRetries: must be an integer >= 1 and <= 20
  if (timing.maxRetries === undefined || timing.maxRetries === null) {
    errors.push({ field: 'timing.maxRetries', message: 'Missing "maxRetries"' });
  } else if (typeof timing.maxRetries !== 'number' || !Number.isFinite(timing.maxRetries)) {
    errors.push({ field: 'timing.maxRetries', message: '"maxRetries" must be a valid number' });
  } else if (timing.maxRetries < 0) {
    errors.push({ field: 'timing.maxRetries', message: '"maxRetries" must not be negative' });
  } else if (timing.maxRetries < 1) {
    errors.push({ field: 'timing.maxRetries', message: '"maxRetries" must be at least 1' });
  } else if (timing.maxRetries > 20) {
    errors.push({ field: 'timing.maxRetries', message: '"maxRetries" must not exceed 20' });
  }

  return result(errors);
}

/**
 * Validates that a specific environment exists in the config and has required fields.
 * @param {*} envConfig - The full env-config object
 * @param {string} envName - The environment name to validate (e.g. "DEV", "QA", "UAT")
 * @returns {{valid: boolean, errors: Array<{field: string, message: string}>}}
 */
function validateEnvironment(envConfig, envName) {
  const errors = [];

  if (!envConfig || typeof envConfig !== 'object' || Array.isArray(envConfig)) {
    errors.push({ field: 'config', message: 'Configuration must be a non-null object' });
    return result(errors);
  }

  if (!envConfig.environments || typeof envConfig.environments !== 'object' || Array.isArray(envConfig.environments)) {
    errors.push({ field: 'environments', message: 'Missing or invalid "environments" object' });
    return result(errors);
  }

  if (!envName || typeof envName !== 'string') {
    errors.push({ field: 'envName', message: 'Environment name must be a non-empty string' });
    return result(errors);
  }

  if (!envConfig.environments[envName]) {
    const validEnvs = Object.keys(envConfig.environments).join(', ');
    errors.push({
      field: `environments.${envName}`,
      message: `Environment "${envName}" not found. Valid environments: ${validEnvs}`
    });
    return result(errors);
  }

  // Validate the specific environment's fields
  const envErrors = validateEnvironmentEntry(envConfig.environments[envName], envName);
  errors.push(...envErrors);

  return result(errors);
}

module.exports = {
  validateEnvConfig,
  validateCredentials,
  validateTiming,
  validateEnvironment
};
