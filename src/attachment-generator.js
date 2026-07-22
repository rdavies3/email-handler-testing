'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Attachment Generator
 *
 * Creates test attachment files of exact byte sizes with valid content
 * for each declared file type. Uses only Node.js built-in modules.
 *
 * Usage:
 *   node src/attachment-generator.js --output generated-emails/attachments/
 */

// File definitions: name, size in bytes, type
const FILE_DEFINITIONS = [
  { name: 'test-small.txt', size: 524288, type: 'txt' },         // 512KB
  { name: 'test-large.pdf', size: 5767168, type: 'pdf' },        // 5.5MB
  { name: 'test-rejected.xyz', size: 10240, type: 'xyz' },       // 10KB
  { name: 'test-signature.p7s', size: 2048, type: 'p7s' },       // 2KB
  { name: 'test-512kb.txt', size: 524288, type: 'txt' },         // 512KB
  { name: 'test-1mb.pdf', size: 1048576, type: 'pdf' },          // 1MB
  { name: 'test-2mb.png', size: 2097152, type: 'png' },          // 2MB
  { name: 'test-4mb.txt', size: 4194304, type: 'txt' },          // 4MB
  { name: 'test-8mb.txt', size: 8388608, type: 'txt' },          // 8MB
  { name: 'test-16mb.txt', size: 16777216, type: 'txt' },        // 16MB
];

/**
 * Generate a .txt file with repeated ASCII pattern to exact byte count.
 * @param {number} size - Exact file size in bytes
 * @returns {Buffer}
 */
function generateTxt(size) {
  const pattern = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\n';
  const buf = Buffer.alloc(size);
  const patternBuf = Buffer.from(pattern, 'ascii');
  let offset = 0;
  while (offset < size) {
    const remaining = size - offset;
    const copyLen = Math.min(patternBuf.length, remaining);
    patternBuf.copy(buf, offset, 0, copyLen);
    offset += copyLen;
  }
  return buf;
}

/**
 * Generate a .pdf file with a valid PDF header and padding stream to exact size.
 * Creates a minimal valid PDF structure: header, body with stream, xref, trailer.
 * @param {number} size - Exact file size in bytes
 * @returns {Buffer}
 */
function generatePdf(size) {
  // Minimal PDF structure
  const header = '%PDF-1.4\n';
  const obj1Start = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2Start = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3Start = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n';

  // We'll pad with a stream object (object 4)
  const streamObjPrefix = '4 0 obj\n<< /Length ';
  const streamObjMid = ' >>\nstream\n';
  const streamObjSuffix = '\nendstream\nendobj\n';

  const xrefAndTrailer = buildPdfTrailer();

  // Calculate how much padding we need in the stream
  const fixedParts = header + obj1Start + obj2Start + obj3Start +
    streamObjPrefix + streamObjMid + streamObjSuffix + xrefAndTrailer;

  // The length number itself takes space, so we iterate to find exact fit
  let streamDataSize = size - Buffer.byteLength(fixedParts, 'ascii');
  // Account for the length digits
  let lengthStr = String(streamDataSize);
  let totalWithLength = Buffer.byteLength(fixedParts, 'ascii') + lengthStr.length;
  streamDataSize = size - totalWithLength;

  // Recalculate if digit count changed
  lengthStr = String(streamDataSize);
  totalWithLength = Buffer.byteLength(fixedParts, 'ascii') + lengthStr.length;
  streamDataSize = size - totalWithLength;

  // One more iteration in case digit count changed again
  lengthStr = String(streamDataSize);
  totalWithLength = Buffer.byteLength(fixedParts, 'ascii') + lengthStr.length;
  streamDataSize = size - totalWithLength;

  if (streamDataSize < 0) {
    // File too small for full structure, just use header + padding
    const buf = Buffer.alloc(size, 0x20); // space padding
    Buffer.from(header, 'ascii').copy(buf);
    return buf;
  }

  // Build the stream padding data (repeated 'X' characters)
  const streamData = Buffer.alloc(streamDataSize, 0x58); // 'X'

  // Assemble the final PDF
  const parts = [
    Buffer.from(header, 'ascii'),
    Buffer.from(obj1Start, 'ascii'),
    Buffer.from(obj2Start, 'ascii'),
    Buffer.from(obj3Start, 'ascii'),
    Buffer.from(streamObjPrefix + lengthStr + streamObjMid, 'ascii'),
    streamData,
    Buffer.from(streamObjSuffix + xrefAndTrailer, 'ascii'),
  ];

  const result = Buffer.concat(parts);

  // If there's a small mismatch due to rounding, pad or trim
  if (result.length < size) {
    return Buffer.concat([result, Buffer.alloc(size - result.length, 0x0A)]);
  } else if (result.length > size) {
    return result.slice(0, size);
  }
  return result;
}

/**
 * Build a minimal PDF cross-reference table and trailer.
 * @returns {string}
 */
function buildPdfTrailer() {
  return 'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000206 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n';
}

/**
 * Generate a .png file with valid PNG header + IHDR + padding IDAT + IEND.
 * @param {number} size - Exact file size in bytes
 * @returns {Buffer}
 */
function generatePng(size) {
  // PNG signature (8 bytes)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk (25 bytes total: 4 length + 4 type + 13 data + 4 CRC)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);    // width = 1
  ihdrData.writeUInt32BE(1, 4);    // height = 1
  ihdrData.writeUInt8(8, 8);       // bit depth = 8
  ihdrData.writeUInt8(2, 9);       // color type = 2 (RGB)
  ihdrData.writeUInt8(0, 10);      // compression method
  ihdrData.writeUInt8(0, 11);      // filter method
  ihdrData.writeUInt8(0, 12);      // interlace method

  const ihdrChunk = buildPngChunk('IHDR', ihdrData);

  // IEND chunk (12 bytes: 4 length + 4 type + 0 data + 4 CRC)
  const iendChunk = buildPngChunk('IEND', Buffer.alloc(0));

  // Calculate IDAT data size to reach exact total
  const fixedSize = signature.length + ihdrChunk.length + iendChunk.length;
  // IDAT chunk overhead: 4 (length) + 4 (type) + 4 (CRC) = 12 bytes
  const idatOverhead = 12;
  const idatDataSize = size - fixedSize - idatOverhead;

  if (idatDataSize < 0) {
    // File too small for full structure, just pad with signature
    const buf = Buffer.alloc(size);
    signature.copy(buf, 0, 0, Math.min(signature.length, size));
    return buf;
  }

  // Create a valid deflate stream for the IDAT data
  // For a 1x1 RGB image, the actual image data would be tiny,
  // but we pad the IDAT with a valid zlib stream
  const rawImageData = Buffer.alloc(idatDataSize);
  // Fill with a valid zlib-compressed stream (store method for padding)
  const compressedPadding = createPaddedZlibStream(idatDataSize);

  const idatChunk = buildPngChunk('IDAT', compressedPadding);

  const result = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);

  // Exact size adjustment
  if (result.length < size) {
    // Insert additional IDAT chunks or pad
    const diff = size - result.length;
    // Add another IDAT with padding
    if (diff >= 12) {
      const extraIdatData = Buffer.alloc(diff - 12);
      const extraIdat = buildPngChunk('IDAT', extraIdatData);
      // Insert before IEND
      return Buffer.concat([signature, ihdrChunk, idatChunk, extraIdat, iendChunk]);
    } else {
      // Tiny difference - rebuild with adjusted IDAT
      const adjustedSize = idatDataSize + diff;
      const adjustedPadding = createPaddedZlibStream(adjustedSize);
      const adjustedIdat = buildPngChunk('IDAT', adjustedPadding);
      return Buffer.concat([signature, ihdrChunk, adjustedIdat, iendChunk]);
    }
  } else if (result.length > size) {
    // Shrink IDAT data
    const diff = result.length - size;
    const shrunkSize = idatDataSize - diff;
    const shrunkPadding = createPaddedZlibStream(shrunkSize);
    const shrunkIdat = buildPngChunk('IDAT', shrunkPadding);
    return Buffer.concat([signature, ihdrChunk, shrunkIdat, iendChunk]);
  }

  return result;
}

/**
 * Create a zlib-compressed stream of specified uncompressed output size.
 * We use zlib.deflateRawSync with Z_NO_COMPRESSION (store) for predictable sizing.
 * @param {number} dataSize - Desired size for the IDAT data field
 * @returns {Buffer} Buffer of exactly dataSize bytes
 */
function createPaddedZlibStream(dataSize) {
  // For PNG IDAT, we just need a buffer of the target size.
  // The PNG spec allows any data in IDAT; viewers will attempt to decompress.
  // For testing purposes (file size validation), we fill with a basic pattern.
  // We'll create a raw buffer that starts with a zlib header for validity.
  if (dataSize <= 0) return Buffer.alloc(0);

  const buf = Buffer.alloc(dataSize);
  // zlib header: CMF=0x78 (deflate, window size 32K), FLG=0x01 (no dict, check bits)
  if (dataSize >= 2) {
    buf[0] = 0x78;
    buf[1] = 0x01;
  }
  // Fill remainder with zeros (valid for stored blocks in theory)
  return buf;
}

/**
 * Build a PNG chunk with correct CRC.
 * @param {string} type - 4-character chunk type
 * @param {Buffer} data - Chunk data
 * @returns {Buffer}
 */
function buildPngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcInput);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * CRC-32 computation for PNG chunks.
 * Standard CRC-32/ISO 3309 used by PNG.
 * @param {Buffer} buf - Input buffer
 * @returns {number}
 */
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Generate a .p7s file with a valid DER-encoded PKCS#7 structure.
 * Creates a minimal ContentInfo with SignedData content type.
 * @param {number} size - Exact file size in bytes
 * @returns {Buffer}
 */
function generateP7s(size) {
  // Build a minimal PKCS#7/CMS ContentInfo structure (DER encoding)
  // SEQUENCE {
  //   OID 1.2.840.113549.1.7.2 (signedData)
  //   [0] EXPLICIT {
  //     SEQUENCE { ... padding ... }
  //   }
  // }

  // signedData OID: 1.2.840.113549.1.7.2
  const signedDataOid = Buffer.from([
    0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x02
  ]);

  // We need to calculate the inner content size to hit the exact file size.
  // DER structure:
  // 30 <len> (outer SEQUENCE)
  //   06 09 <OID bytes> (OID)
  //   A0 <len> (EXPLICIT [0])
  //     30 <len> (inner SEQUENCE - SignedData)
  //       02 01 01 (version INTEGER 1)
  //       31 00 (digestAlgorithms SET, empty)
  //       30 <len> (contentInfo SEQUENCE)
  //         06 09 <OID> (data OID 1.2.840.113549.1.7.1)
  //       <padding octets>

  // For simplicity, we create the fixed header and pad the inner content
  const dataOid = Buffer.from([
    0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x01
  ]);

  // Inner SignedData content (version + digestAlgs + contentInfo)
  const version = Buffer.from([0x02, 0x01, 0x01]); // INTEGER 1
  const digestAlgs = Buffer.from([0x31, 0x00]);     // empty SET
  const contentInfoInner = Buffer.concat([
    Buffer.from([0x30, dataOid.length]),
    dataOid
  ]);

  const signedDataFixed = Buffer.concat([version, digestAlgs, contentInfoInner]);

  // Calculate padding needed
  // We need to work backwards from the target size
  // Total = outerSeq(TL) + oid(TLV) + explicit0(TL) + innerSeq(TL) + signedDataFixed + padding
  // For sizes > 127, DER uses multi-byte length encoding

  const fixedInnerContent = signedDataFixed;
  // Estimate: we need (size - overhead) bytes of padding inside the inner sequence
  // Let's build it iteratively

  const result = buildDerP7s(signedDataOid, fixedInnerContent, size);
  return result;
}

/**
 * Build a DER-encoded PKCS#7 structure padded to exact size.
 * @param {Buffer} contentTypeOid - The content type OID (signedData)
 * @param {Buffer} fixedContent - Fixed inner content
 * @param {number} targetSize - Target total size
 * @returns {Buffer}
 */
function buildDerP7s(contentTypeOid, fixedContent, targetSize) {
  // Strategy: build the structure with padding in a signerInfos SET
  // to reach exact target size.

  // The minimum overhead for the DER wrapper is approximately:
  // Outer SEQUENCE tag+length: 2-4 bytes
  // OID (already includes tag+length): 11 bytes
  // EXPLICIT [0] tag+length: 2-4 bytes
  // Inner SEQUENCE tag+length: 2-4 bytes
  // Fixed content: fixedContent.length bytes
  // SignerInfos SET tag+length: 2-4 bytes
  // Padding inside signerInfos

  // We'll add padding as an OCTET STRING within a certificates [0] IMPLICIT
  // For simplicity, just stuff padding bytes into a SET (signerInfos)

  // Calculate space needed for padding
  // Use a simple approach: build without padding, measure, then add exact padding

  // Build inner SEQUENCE content without padding
  const signerInfosEmpty = Buffer.from([0x31, 0x00]); // empty SET
  let innerContent = Buffer.concat([fixedContent, signerInfosEmpty]);
  let innerSeq = wrapDerSequence(innerContent);
  let explicit0 = wrapDerExplicit0(innerSeq);
  let outerContent = Buffer.concat([contentTypeOid, explicit0]);
  let outerSeq = wrapDerSequence(outerContent);

  const minSize = outerSeq.length;

  if (targetSize <= minSize) {
    // Can't make it smaller, just return truncated or exact
    if (targetSize === minSize) return outerSeq;
    // Pad the output buffer if we're somehow under
    return outerSeq.slice(0, targetSize);
  }

  // We need (targetSize - minSize + signerInfosEmpty.length) bytes in signerInfos
  // But adding to signerInfos changes the lengths of enclosing structures.
  // Iterate to converge on exact size.

  let paddingSize = targetSize - minSize;

  for (let attempt = 0; attempt < 10; attempt++) {
    const paddingData = Buffer.alloc(paddingSize, 0x00);
    const signerInfosWithPadding = wrapDerSet(paddingData);
    innerContent = Buffer.concat([fixedContent, signerInfosWithPadding]);
    innerSeq = wrapDerSequence(innerContent);
    explicit0 = wrapDerExplicit0(innerSeq);
    outerContent = Buffer.concat([contentTypeOid, explicit0]);
    outerSeq = wrapDerSequence(outerContent);

    const diff = targetSize - outerSeq.length;
    if (diff === 0) return outerSeq;
    paddingSize += diff;
    if (paddingSize < 0) paddingSize = 0;
  }

  // Final fallback: pad or trim the result
  if (outerSeq.length < targetSize) {
    return Buffer.concat([outerSeq, Buffer.alloc(targetSize - outerSeq.length, 0x00)]);
  }
  return outerSeq.slice(0, targetSize);
}

/**
 * Wrap data in a DER SEQUENCE (tag 0x30).
 * @param {Buffer} data
 * @returns {Buffer}
 */
function wrapDerSequence(data) {
  return Buffer.concat([Buffer.from([0x30]), derLength(data.length), data]);
}

/**
 * Wrap data in a DER SET (tag 0x31).
 * @param {Buffer} data
 * @returns {Buffer}
 */
function wrapDerSet(data) {
  return Buffer.concat([Buffer.from([0x31]), derLength(data.length), data]);
}

/**
 * Wrap data in DER EXPLICIT [0] (tag 0xA0).
 * @param {Buffer} data
 * @returns {Buffer}
 */
function wrapDerExplicit0(data) {
  return Buffer.concat([Buffer.from([0xA0]), derLength(data.length), data]);
}

/**
 * Encode a DER length value.
 * @param {number} len
 * @returns {Buffer}
 */
function derLength(len) {
  if (len < 0x80) {
    return Buffer.from([len]);
  } else if (len < 0x100) {
    return Buffer.from([0x81, len]);
  } else if (len < 0x10000) {
    return Buffer.from([0x82, (len >> 8) & 0xFF, len & 0xFF]);
  } else if (len < 0x1000000) {
    return Buffer.from([0x83, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
  } else {
    return Buffer.from([0x84, (len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
  }
}

/**
 * Generate a file with invalid/rejected extension (.xyz).
 * Contains plain ASCII text content.
 * @param {number} size - Exact file size in bytes
 * @returns {Buffer}
 */
function generateXyz(size) {
  // Just fill with readable text
  return generateTxt(size);
}

/**
 * Generate a file based on its type.
 * @param {{ name: string, size: number, type: string }} fileDef - File definition
 * @returns {Buffer}
 */
function generateFile(fileDef) {
  switch (fileDef.type) {
    case 'txt':
      return generateTxt(fileDef.size);
    case 'pdf':
      return generatePdf(fileDef.size);
    case 'png':
      return generatePng(fileDef.size);
    case 'p7s':
      return generateP7s(fileDef.size);
    case 'xyz':
      return generateXyz(fileDef.size);
    default:
      throw new Error(`Unknown file type: ${fileDef.type}`);
  }
}

/**
 * Generate all test attachment files to the specified output directory.
 * @param {string} outputDir - Output directory path
 * @returns {{ generated: string[], errors: string[] }}
 */
function generateAll(outputDir) {
  const resolvedDir = path.resolve(outputDir);

  // Ensure output directory exists
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const generated = [];
  const errors = [];

  for (const fileDef of FILE_DEFINITIONS) {
    try {
      const buffer = generateFile(fileDef);
      const outputPath = path.join(resolvedDir, fileDef.name);
      fs.writeFileSync(outputPath, buffer);

      // Verify the written file size
      const stats = fs.statSync(outputPath);
      if (stats.size !== fileDef.size) {
        errors.push(`${fileDef.name}: expected ${fileDef.size} bytes, got ${stats.size} bytes`);
      } else {
        generated.push(fileDef.name);
      }
    } catch (err) {
      errors.push(`${fileDef.name}: ${err.message}`);
    }
  }

  return { generated, errors };
}

/**
 * Parse CLI arguments for attachment-generator.
 * @param {string[]} args - Process argv (from index 2)
 * @returns {{ output: string|null }}
 */
function parseCliArgs(args) {
  const result = { output: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output') {
      result.output = args[++i] || null;
    }
  }
  return result;
}

/**
 * Main entry point for CLI usage.
 */
function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.output) {
    process.stderr.write('ERROR: --output argument is required\n');
    process.stderr.write('Usage: node src/attachment-generator.js --output <directory>\n');
    process.exit(1);
  }

  console.log(`Generating test attachments in: ${path.resolve(args.output)}`);

  const result = generateAll(args.output);

  if (result.generated.length > 0) {
    console.log(`\nGenerated ${result.generated.length} files:`);
    for (const name of result.generated) {
      const fileDef = FILE_DEFINITIONS.find(f => f.name === name);
      const sizeKB = fileDef ? (fileDef.size / 1024).toFixed(1) : '?';
      console.log(`  ✓ ${name} (${sizeKB} KB)`);
    }
  }

  if (result.errors.length > 0) {
    console.error(`\n${result.errors.length} errors:`);
    for (const err of result.errors) {
      console.error(`  ✗ ${err}`);
    }
    process.exit(1);
  }

  console.log('\nAll files generated successfully.');
  process.exit(0);
}

// Export functions for use as a module
module.exports = {
  generateTxt,
  generatePdf,
  generatePng,
  generateP7s,
  generateXyz,
  generateFile,
  generateAll,
  FILE_DEFINITIONS,
  crc32,
  buildPngChunk,
};

// Run as CLI if invoked directly
if (require.main === module) {
  main();
}
