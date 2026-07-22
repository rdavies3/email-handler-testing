'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Collection of realistic email body sentences used to generate
 * human-readable content for large body tests.
 */
const SENTENCES = [
  'Thank you for reaching out to our support team regarding your recent inquiry.',
  'We have reviewed the details you provided and would like to offer the following update.',
  'Our team is actively working on resolving the issue you reported last week.',
  'Please find the requested information attached to this correspondence.',
  'We appreciate your patience while we investigate this matter further.',
  'The changes you requested have been implemented in the latest release.',
  'Could you please confirm whether the proposed solution meets your requirements?',
  'We wanted to follow up on our previous conversation about the project timeline.',
  'The quarterly report has been finalized and is ready for your review.',
  'Please let us know if you have any additional questions or concerns.',
  'Our engineering team has identified the root cause of the reported behavior.',
  'We are pleased to inform you that your request has been approved.',
  'The scheduled maintenance window has been confirmed for this weekend.',
  'Please review the attached documentation for the updated procedures.',
  'We would like to schedule a brief call to discuss the next steps.',
  'The configuration changes have been deployed to the staging environment.',
  'Your feedback has been shared with the product development team.',
  'We have escalated this issue to our senior engineering staff for resolution.',
  'The training materials you requested are now available in the shared folder.',
  'Please note that the deadline for submissions has been extended by one week.',
  'Our records indicate that your subscription renewal is due at the end of this month.',
  'The system performance metrics from last quarter show significant improvement.',
  'We recommend scheduling a follow-up meeting to review the implementation plan.',
  'The security audit has been completed and the findings are summarized below.',
  'Please ensure all team members have access to the updated project documentation.',
  'We have received your support ticket and assigned it priority level two.',
  'The integration testing phase is expected to begin next Monday morning.',
  'Your account settings have been updated according to your specifications.',
  'We are currently experiencing higher than normal volume and appreciate your patience.',
  'The backup restoration process has been verified and is functioning correctly.',
];

/**
 * Generate email body content of exactly the specified character count.
 * Produces human-readable text by cycling through realistic sentences.
 *
 * @param {number} charCount - Exact number of characters to generate
 * @returns {string} Text content of exactly charCount characters
 */
function generateLongBody(charCount) {
  if (typeof charCount !== 'number' || charCount < 0 || !Number.isFinite(charCount)) {
    throw new Error('charCount must be a non-negative finite number');
  }

  if (charCount === 0) {
    return '';
  }

  const result = [];
  let currentLength = 0;
  let sentenceIndex = 0;

  while (currentLength < charCount) {
    const sentence = SENTENCES[sentenceIndex % SENTENCES.length];
    const remaining = charCount - currentLength;

    if (remaining <= sentence.length + 1) {
      // Need to fill exactly the remaining characters
      // Use a substring of the current sentence, padded if needed
      if (remaining <= sentence.length) {
        result.push(sentence.substring(0, remaining));
        currentLength += remaining;
      } else {
        // remaining > sentence.length (by 1, the space)
        result.push(sentence + ' ');
        currentLength += sentence.length + 1;
      }
    } else {
      // Add full sentence followed by a space
      result.push(sentence + ' ');
      currentLength += sentence.length + 1;
    }

    sentenceIndex++;
  }

  const output = result.join('');

  // Ensure exact length (trim if join produced extra, though shouldn't happen)
  return output.substring(0, charCount);
}

/**
 * Generate text content of approximately the specified byte size (±10%).
 * For plain ASCII text, 1 character = 1 byte.
 *
 * @param {number} sizeBytes - Target size in bytes (±10% tolerance)
 * @returns {string} Text content of approximately sizeBytes length
 */
function generateSizedBody(sizeBytes) {
  if (typeof sizeBytes !== 'number' || sizeBytes < 0 || !Number.isFinite(sizeBytes)) {
    throw new Error('sizeBytes must be a non-negative finite number');
  }

  // For plain ASCII text, 1 char = 1 byte, so generate sizeBytes characters
  // The ±10% tolerance is inherent in the requirement, but we aim for exact
  return generateLongBody(sizeBytes);
}

/**
 * Parse CLI arguments for body-generator.
 * @param {string[]} args - Process argv (from index 2)
 * @returns {{ chars: number|null, size: number|null, output: string|null }}
 */
function parseArgs(args) {
  const result = { chars: null, size: null, output: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--chars':
        result.chars = parseInt(args[++i], 10) || null;
        break;
      case '--size':
        result.size = parseInt(args[++i], 10) || null;
        break;
      case '--output':
        result.output = args[++i] || null;
        break;
    }
  }
  return result;
}

/**
 * Main CLI entry point.
 * Supports:
 *   node src/body-generator.js --chars 34000
 *   node src/body-generator.js --size 524288 --output generated-emails/body-512kb.txt
 */
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.chars && !args.size) {
    process.stderr.write('ERROR: Either --chars <count> or --size <bytes> is required\n');
    process.stderr.write('Usage:\n');
    process.stderr.write('  node src/body-generator.js --chars 34000\n');
    process.stderr.write('  node src/body-generator.js --size 524288 --output path/to/file.txt\n');
    process.exit(1);
  }

  let content;

  if (args.chars) {
    content = generateLongBody(args.chars);
  } else {
    content = generateSizedBody(args.size);
  }

  if (args.output) {
    const outputPath = path.resolve(args.output);
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, content, 'utf8');
    process.stdout.write(`Generated body content: ${outputPath} (${content.length} characters)\n`);
  } else {
    process.stdout.write(content);
  }
}

// Export functions for use as a module
module.exports = {
  generateLongBody,
  generateSizedBody,
  parseArgs,
};

// Run as CLI if invoked directly
if (require.main === module) {
  main();
}
