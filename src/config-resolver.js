'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Read and normalize the path from the pointer file.
 * Trims whitespace, trailing newlines, and resolves relative paths.
 *
 * @param {string} pointerFilePath - Absolute path to the .config-path file
 * @param {string} projectRoot - Project root for relative path resolution
 * @returns {{ path: string|null, error: string|null }}
 */
function readPointerFile(pointerFilePath, projectRoot) {
  try {
    if (!fs.existsSync(pointerFilePath)) {
      return { path: null, error: `Pointer file not found: ${pointerFilePath}` };
    }

    const raw = fs.readFileSync(pointerFilePath, 'utf8');
    // Trim whitespace and trailing newlines
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      return { path: null, error: 'The .config-path file is empty.' };
    }

    // Check for invalid characters (null bytes)
    if (trimmed.includes('\0')) {
      return { path: null, error: 'The path in .config-path contains invalid characters.' };
    }

    // Resolve absolute or relative path
    let resolved;
    if (path.isAbsolute(trimmed)) {
      resolved = trimmed;
    } else {
      resolved = path.resolve(projectRoot, trimmed);
    }

    return { path: resolved, error: null };
  } catch (err) {
    return { path: null, error: `Failed to read pointer file: ${err.message}` };
  }
}

/**
 * Write a new path to the pointer file.
 *
 * @param {string} pointerFilePath - Absolute path to the .config-path file
 * @param {string} configDirPath - The directory path to write
 * @returns {{ success: boolean, error: string|null }}
 */
function writePointerFile(pointerFilePath, configDirPath) {
  try {
    if (!configDirPath || typeof configDirPath !== 'string' || configDirPath.trim().length === 0) {
      return { success: false, error: 'Config directory path must be a non-empty string.' };
    }

    fs.writeFileSync(pointerFilePath, configDirPath.trim() + '\n', 'utf8');
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: `Failed to write pointer file: ${err.message}` };
  }
}

/**
 * Resolve the configuration directory path.
 * Priority: .config-path file -> repo root fallback.
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot] - Override project root (for testing)
 * @param {string} [options.pointerFile] - Override pointer filename (default: '.config-path')
 * @returns {{ configDir: string|null, source: 'pointer'|'fallback'|null, error: string|null }}
 */
function resolveConfigDir(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const pointerFileName = options.pointerFile || '.config-path';
  const pointerFilePath = path.resolve(projectRoot, pointerFileName);

  // Step 1: Check if pointer file exists
  if (fs.existsSync(pointerFilePath)) {
    // Read and resolve the pointer
    const result = readPointerFile(pointerFilePath, projectRoot);

    if (result.error) {
      return { configDir: null, source: null, error: result.error };
    }

    // Check if resolved directory exists and is accessible
    try {
      fs.accessSync(result.path, fs.constants.R_OK);
      const stat = fs.statSync(result.path);
      if (!stat.isDirectory()) {
        return {
          configDir: null,
          source: null,
          error: `Path in .config-path is not a directory: ${result.path}`,
        };
      }
    } catch (err) {
      if (err.code === 'EACCES') {
        return {
          configDir: null,
          source: null,
          error: `Permission denied reading ${result.path}.`,
        };
      }
      return {
        configDir: null,
        source: null,
        error: `External config directory not accessible: ${result.path}. Verify the volume is mounted.`,
      };
    }

    return { configDir: result.path, source: 'pointer', error: null };
  }

  // Step 2: Fallback to repo root
  const envConfigPath = path.join(projectRoot, 'env-config.json');
  const credentialsPath = path.join(projectRoot, 'credentials.json');
  const envConfigExists = fs.existsSync(envConfigPath);
  const credentialsExists = fs.existsSync(credentialsPath);

  if (envConfigExists && credentialsExists) {
    return { configDir: projectRoot, source: 'fallback', error: null };
  }

  if (!envConfigExists && !credentialsExists) {
    return {
      configDir: null,
      source: null,
      error: 'No .config-path file found and no configuration files exist at the project root. Create .config-path or place env-config.json and credentials.json at the project root.',
    };
  }

  // One exists but not the other
  const missing = !envConfigExists ? 'env-config.json' : 'credentials.json';
  return {
    configDir: null,
    source: null,
    error: `No .config-path file found. Fallback to project root failed: ${missing} is missing from ${projectRoot}.`,
  };
}

/**
 * Resolve full paths to both config files and validate their existence.
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot] - Override project root
 * @param {string} [options.pointerFile] - Override pointer filename
 * @returns {{
 *   configPath: string|null,
 *   credentialsPath: string|null,
 *   configDir: string|null,
 *   source: 'pointer'|'fallback'|null,
 *   error: string|null,
 *   missingFiles: string[]
 * }}
 */
function resolveConfigPaths(options = {}) {
  const dirResult = resolveConfigDir(options);

  if (dirResult.error) {
    return {
      configPath: null,
      credentialsPath: null,
      configDir: null,
      source: null,
      error: dirResult.error,
      missingFiles: [],
    };
  }

  const configDir = dirResult.configDir;
  const configPath = path.join(configDir, 'env-config.json');
  const credentialsPath = path.join(configDir, 'credentials.json');

  const missingFiles = [];
  if (!fs.existsSync(configPath)) {
    missingFiles.push('env-config.json');
  }
  if (!fs.existsSync(credentialsPath)) {
    missingFiles.push('credentials.json');
  }

  if (missingFiles.length > 0) {
    const templateHint = missingFiles
      .map((f) => {
        const templateName = f.replace('.json', '.template.json');
        return `${f} (template available at: ${templateName})`;
      })
      .join(', ');

    return {
      configPath: missingFiles.includes('env-config.json') ? null : configPath,
      credentialsPath: missingFiles.includes('credentials.json') ? null : credentialsPath,
      configDir,
      source: dirResult.source,
      error: `Missing configuration files in ${configDir}: ${templateHint}`,
      missingFiles,
    };
  }

  return {
    configPath,
    credentialsPath,
    configDir,
    source: dirResult.source,
    error: null,
    missingFiles: [],
  };
}

module.exports = {
  readPointerFile,
  writePointerFile,
  resolveConfigDir,
  resolveConfigPaths,
};

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  function outputSuccess(data) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    process.exit(0);
  }

  function outputError(message) {
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
    process.exit(1);
  }

  if (command === '--resolve') {
    const result = resolveConfigDir();
    if (result.error) {
      outputError(result.error);
    } else {
      outputSuccess({ configDir: result.configDir, source: result.source });
    }
  } else if (command === '--paths') {
    const result = resolveConfigPaths();
    if (result.error) {
      outputError(result.error);
    } else {
      outputSuccess({
        configDir: result.configDir,
        configPath: result.configPath,
        credentialsPath: result.credentialsPath,
        source: result.source,
      });
    }
  } else if (command === '--set') {
    const targetPath = args[1];
    if (!targetPath) {
      outputError('Usage: config-resolver.js --set <path>');
    } else {
      const pointerFilePath = path.resolve(process.cwd(), '.config-path');
      const result = writePointerFile(pointerFilePath, targetPath);
      if (result.error) {
        outputError(result.error);
      } else {
        outputSuccess({ success: true, path: targetPath.trim(), pointerFile: pointerFilePath });
      }
    }
  } else if (command === '--validate') {
    const result = resolveConfigPaths();
    if (result.error) {
      outputError(result.error);
    } else {
      outputSuccess({
        valid: true,
        configDir: result.configDir,
        configPath: result.configPath,
        credentialsPath: result.credentialsPath,
        source: result.source,
      });
    }
  } else {
    outputError(
      'Unknown command. Usage: config-resolver.js [--resolve | --paths | --set <path> | --validate]'
    );
  }
}
