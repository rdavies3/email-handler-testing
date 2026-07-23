'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Parse CLI arguments for report-generator.
 * @param {string[]} args - Process argv (from index 2)
 * @returns {{ input: string|null, output: string|null }}
 */
function parseArgs(args) {
  const result = { input: null, output: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input':
        result.input = args[++i] || null;
        break;
      case '--output':
        result.output = args[++i] || null;
        break;
    }
  }
  return result;
}

/**
 * Status color mapping for PDF rendering.
 */
const STATUS_COLORS = {
  PASS: [34, 139, 34],   // Forest green
  FAIL: [220, 20, 60],   // Crimson
  ERROR: [255, 140, 0],  // Dark orange
};

/**
 * Build a clickable Salesforce Case URL from instanceUrl and caseId.
 * @param {string} instanceUrl - e.g. "https://asu--dev.sandbox.lightning.force.com"
 * @param {string} caseId - 18-char Salesforce record ID
 * @returns {string} Full URL to the Case record
 */
function buildCaseUrl(instanceUrl, caseId) {
  if (!instanceUrl || !caseId) return null;
  // Ensure no trailing slash
  const base = instanceUrl.replace(/\/$/, '');
  return `${base}/lightning/r/Case/${caseId}/view`;
}

/**
 * Generate a formatted PDF report from test session results.
 * @param {object} sessionData - The session results object
 * @param {string} outputPath - Path to write the PDF file
 */
function generateReport(sessionData, outputPath) {
  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    info: {
      Title: `Test Session Report - ${sessionData.environment}`,
      Author: 'Email Handler Testing Framework',
      Subject: 'Salesforce Email-to-Case Handler Test Results',
      CreatedDate: new Date(),
    },
  });

  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const pageWidth = 752; // letter landscape usable width (792 - 40 margins)
  const pageLeft = 40;

  // --- Header ---
  doc.fontSize(20).font('Helvetica-Bold')
    .text('Email-to-Case Handler Test Report', { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(10).font('Helvetica')
    .fillColor('#555555')
    .text(`Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}`, { align: 'center' });
  doc.moveDown(1);

  // --- Summary Box ---
  const summaryY = doc.y;
  doc.rect(pageLeft, summaryY, pageWidth, 80).lineWidth(1).strokeColor('#cccccc').stroke();

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
    .text('Session Summary', pageLeft + 15, summaryY + 10);
  doc.moveDown(0.2);

  doc.fontSize(10).font('Helvetica').fillColor('#333333');
  const col1X = pageLeft + 15;
  const col2X = pageLeft + 250;
  const col3X = pageLeft + 500;
  let infoY = doc.y;

  doc.text(`Environment: ${sessionData.environment}`, col1X, infoY);
  doc.text(`Org Alias: ${sessionData.orgAlias || 'N/A'}`, col2X, infoY);
  doc.text(`Instance: ${sessionData.instanceUrl || 'N/A'}`, col3X, infoY);
  infoY += 15;
  doc.text(`Date: ${sessionData.date || new Date().toISOString().split('T')[0]}`, col1X, infoY);
  doc.text(`Duration: ${sessionData.duration || 'N/A'}`, col2X, infoY);
  infoY += 15;

  // Result counts
  const passed = sessionData.results.filter(r => r.status === 'PASS').length;
  const failed = sessionData.results.filter(r => r.status === 'FAIL').length;
  const errors = sessionData.results.filter(r => r.status === 'ERROR').length;
  const total = sessionData.results.length;

  doc.font('Helvetica-Bold');
  doc.fillColor('#000000').text(`Total: ${total}`, col1X, infoY);
  doc.fillColor(...STATUS_COLORS.PASS).text(`Passed: ${passed}`, col1X + 80, infoY);
  doc.fillColor(...STATUS_COLORS.FAIL).text(`Failed: ${failed}`, col1X + 170, infoY);
  doc.fillColor(...STATUS_COLORS.ERROR).text(`Errors: ${errors}`, col1X + 260, infoY);
  doc.fillColor('#000000');

  doc.y = summaryY + 88;
  doc.moveDown(0.8);

  // --- Results Table ---
  doc.fontSize(13).font('Helvetica-Bold')
    .text('Test Results', pageLeft);
  doc.moveDown(0.4);

  // Column layout for landscape — includes Case Number and Case ID
  const tableX = pageLeft;
  const cols = {
    test: 35,
    name: 240,
    status: 45,
    caseNumber: 80,
    caseId: 155,
    note: pageWidth - 35 - 240 - 45 - 80 - 155, // remaining ~197
  };
  let tableY = doc.y;

  // Table header
  doc.rect(tableX, tableY, pageWidth, 16).fill('#2c3e50');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
  let colX = tableX + 4;
  doc.text('Test', colX, tableY + 4, { width: cols.test });
  colX += cols.test;
  doc.text('Name', colX, tableY + 4, { width: cols.name });
  colX += cols.name;
  doc.text('Result', colX, tableY + 4, { width: cols.status });
  colX += cols.status;
  doc.text('Case #', colX, tableY + 4, { width: cols.caseNumber });
  colX += cols.caseNumber;
  doc.text('Case ID (click to open)', colX, tableY + 4, { width: cols.caseId });
  colX += cols.caseId;
  doc.text('Notes', colX, tableY + 4, { width: cols.note });

  tableY += 16;
  doc.fillColor('#000000');

  // Table rows
  const instanceUrl = sessionData.instanceUrl || '';

  sessionData.results.forEach((result, index) => {
    // Check if we need a new page
    if (tableY > 540) {
      doc.addPage();
      tableY = 40;
    }

    const rowHeight = 15;
    const bgColor = index % 2 === 0 ? '#f8f9fa' : '#ffffff';
    doc.rect(tableX, tableY, pageWidth, rowHeight).fill(bgColor);

    let rx = tableX + 4;
    const textY = tableY + 3;

    // Test ID
    doc.fontSize(7.5).font('Helvetica').fillColor('#333333');
    doc.text(result.id, rx, textY, { width: cols.test, lineBreak: false });
    rx += cols.test;

    // Name
    doc.text(result.name, rx, textY, { width: cols.name, lineBreak: false });
    rx += cols.name;

    // Status with color
    const statusColor = STATUS_COLORS[result.status] || [0, 0, 0];
    doc.font('Helvetica-Bold').fillColor(...statusColor);
    doc.text(result.status, rx, textY, { width: cols.status, lineBreak: false });
    rx += cols.status;

    // Case Number
    doc.font('Helvetica').fillColor('#333333');
    const caseNum = result.caseNumber || '—';
    doc.text(caseNum, rx, textY, { width: cols.caseNumber, lineBreak: false });
    rx += cols.caseNumber;

    // Case ID as clickable link
    const caseId = result.caseId || '';
    if (caseId && instanceUrl) {
      const caseUrl = buildCaseUrl(instanceUrl, caseId);
      doc.fillColor('#1a73e8').font('Helvetica');
      // Render the case ID as a clickable link
      const idText = caseId.slice(0, 18);
      doc.text(idText, rx, textY, {
        width: cols.caseId,
        lineBreak: false,
        link: caseUrl,
        underline: true,
      });
    } else if (caseId) {
      doc.fillColor('#333333').font('Helvetica');
      doc.text(caseId, rx, textY, { width: cols.caseId, lineBreak: false });
    } else {
      doc.fillColor('#999999').font('Helvetica');
      doc.text('—', rx, textY, { width: cols.caseId, lineBreak: false });
    }
    rx += cols.caseId;

    // Notes
    doc.font('Helvetica').fillColor('#666666');
    const note = (result.note || '').slice(0, 35);
    doc.text(note, rx, textY, { width: cols.note, lineBreak: false });

    doc.fillColor('#000000');
    tableY += rowHeight;
  });

  // --- Root Causes Section ---
  if (sessionData.rootCauses && sessionData.rootCauses.length > 0) {
    if (tableY > 450) {
      doc.addPage();
      tableY = 40;
    }

    doc.y = tableY + 20;
    doc.fontSize(13).font('Helvetica-Bold')
      .text('Root Cause Analysis', pageLeft);
    doc.moveDown(0.4);

    sessionData.rootCauses.forEach((cause) => {
      if (doc.y > 520) doc.addPage();

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#2c3e50')
        .text(cause.category, pageLeft);
      doc.fontSize(9).font('Helvetica').fillColor('#333333')
        .text(cause.description, pageLeft + 15, doc.y, { width: pageWidth - 15 });
      doc.fontSize(8).font('Helvetica').fillColor('#666666')
        .text(`Affected tests: ${cause.tests}`, pageLeft + 15);
      doc.moveDown(0.4);
    });
  }

  // --- Footer on last page ---
  doc.fontSize(8).font('Helvetica').fillColor('#999999');
  doc.text(
    'Generated by email-handler-testing framework | Salesforce Email-to-Case Handler Tests',
    pageLeft, 560, { align: 'center', width: pageWidth }
  );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

/**
 * Main entry point for CLI usage.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input) {
    console.error('Usage: node src/report-generator.js --input <session-results.json> [--output <report.pdf>]');
    process.exit(1);
  }

  // Load session data
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const sessionData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  // Determine output path
  const outputPath = args.output
    ? path.resolve(args.output)
    : path.resolve('generated-emails', `test-report-${sessionData.environment}-${Date.now()}.pdf`);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await generateReport(sessionData, outputPath);
  console.log(JSON.stringify({ success: true, path: result }));
}

// Export for module use
module.exports = { generateReport, buildCaseUrl, parseArgs };

// Run as CLI if invoked directly
if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  });
}
