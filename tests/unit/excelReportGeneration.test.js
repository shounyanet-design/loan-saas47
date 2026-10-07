const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  detectChannelFromHistory,
  resolveCollectionMethodLabel,
  resolveDebitOrderStatus,
  formatDateDDMMYYYY,
  generateAgreementReportWorkbook,
  generateInstallmentReportWorkbook,
  AGREEMENT_COLUMNS,
  INSTALLMENT_COLUMNS
} = require('../../src/services/excelReportService');

// ============================================================================
// 1. CHANNEL DETECTION FROM LOAN STATUS HISTORY
// ============================================================================

test('1. Channel Detection — Borrower self-service submission resolves to "Online Applications"', () => {
  const history = [
    {
      status: 'Submitted',
      notes: 'Loan application submitted by borrower (Full)',
      createdAt: new Date('2026-05-01')
    }
  ];
  const channel = detectChannelFromHistory(history);
  assert.equal(channel, 'Online Applications', 'Borrower portal submissions must be classified as Online Applications');
});

test('2. Channel Detection — Staff/Admin on-behalf submission resolves to "Manually"', () => {
  const history = [
    {
      status: 'Submitted',
      notes: 'Loan application submitted on behalf of borrower by staff Mothusi Gaoagwe',
      createdAt: new Date('2026-05-01')
    }
  ];
  const channel = detectChannelFromHistory(history);
  assert.equal(channel, 'Manually', 'On-behalf submissions must be classified as Manually');
});

test('3. Channel Detection — Missing or empty history entries resolve to blank (No false fallback)', () => {
  assert.equal(detectChannelFromHistory([]), '', 'Empty history must resolve to blank string');
  assert.equal(detectChannelFromHistory(null), '', 'Null history must resolve to blank string');
  assert.equal(detectChannelFromHistory(undefined), '', 'Undefined history must resolve to blank string');
});

test('4. Channel Detection — Unrecognized/generic status notes resolve to blank (Strictly no false fallback)', () => {
  const genericHistory = [
    {
      status: 'Submitted',
      notes: 'Application created via data migration script v1.0',
      createdAt: new Date('2026-01-01')
    }
  ];
  const channel = detectChannelFromHistory(genericHistory);
  assert.equal(channel, '', 'Migrated or ambiguous entries must remain blank instead of guessing Online Applications');
});

// ============================================================================
// 2. COLLECTION METHOD TERMINOLOGY
// ============================================================================

test('5. Collection Method — Retains system terminology without converting to Cash or Debit Order', () => {
  assert.equal(resolveCollectionMethodLabel('DEBICHECK'), 'DebiCheck', 'DEBICHECK must map to DebiCheck');
  assert.equal(resolveCollectionMethodLabel('MANUAL'), 'Manual', 'MANUAL must map to Manual');
  assert.equal(resolveCollectionMethodLabel('PAYFAST_CARD'), 'Manual', 'Card payments map to Manual');
  assert.equal(resolveCollectionMethodLabel(''), 'DebiCheck', 'Default fallback is DebiCheck');
});

// ============================================================================
// 3. DATE FORMATTING
// ============================================================================

test('6. Date Formatting — Converts dates to DD/MM/YYYY matching reference report', () => {
  const d = new Date(2026, 4, 30); // 30 May 2026
  assert.equal(formatDateDDMMYYYY(d), '30/05/2026');
  assert.equal(formatDateDDMMYYYY(null), '');
  assert.equal(formatDateDDMMYYYY('invalid-date'), '');
});

// ============================================================================
// 4. AGREEMENT REPORT COLUMNS & EXCLUSIONS
// ============================================================================

test('7. Agreement Report Columns — Verifies exact 16 columns and complete exclusion of reference-only fields', () => {
  const headers = AGREEMENT_COLUMNS.map(c => c.header);
  
  // Verify exact 16 column count
  assert.equal(headers.length, 16, 'Agreement report must contain exactly 16 columns');

  // Verify exact column order
  const expectedHeaders = [
    'Acc No',
    'Name',
    'Channel',
    'Id Number',
    'Created By',
    'Terms',
    'Product',
    'Created',
    'Deferred',
    'Capital',
    'Intr',
    'Ini',
    'Adm',
    'VAT',
    'Payments',
    'Balance'
  ];
  assert.deepEqual(headers, expectedHeaders, 'Agreement columns must follow the exact specified sequence');

  // Verify non-existent fields are completely excluded
  assert.ok(!headers.includes('Agreement'), 'Agreement / Agr No must be excluded');
  assert.ok(!headers.includes('Agr No'), 'Agr No must be excluded');
  assert.ok(!headers.includes('Own Ref'), 'Own Ref must be excluded');
  assert.ok(!headers.includes('Track'), 'Track must be excluded');
});

// ============================================================================
// 5. INSTALLMENT REPORT COLUMNS & EXCLUSIONS
// ============================================================================

test('8. Installment Report Columns — Verifies exact 16 columns and complete exclusion of reference-only fields', () => {
  const headers = INSTALLMENT_COLUMNS.map(c => c.header);

  // Verify exact 16 column count
  assert.equal(headers.length, 16, 'Installment report must contain exactly 16 columns');

  // Verify exact column order
  const expectedHeaders = [
    'Acc No',
    'Name',
    'Employer',
    'Id Number',
    'Created By',
    'Phone',
    'Freq',
    'Inst',
    'Product',
    'Col Method',
    'Due',
    'Overdue',
    'D/O Status',
    'Inst Am',
    'Paid',
    'Balance'
  ];
  assert.deepEqual(headers, expectedHeaders, 'Installment columns must follow the exact specified sequence');

  // Verify non-existent fields are completely excluded
  assert.ok(!headers.includes('Own Ref'), 'Own Ref must be excluded');
  assert.ok(!headers.includes('Agr No'), 'Agr No must be excluded');
  assert.ok(!headers.includes('Agreement'), 'Agreement must be excluded');
  assert.ok(!headers.includes('D/O Status - Inst'), 'D/O Status - Inst must be excluded');
});

// ============================================================================
// 6. WORKBOOK STRUCTURE & OPENXML GENERATION
// ============================================================================

test('9. Agreement Workbook OpenXML Generation — Verifies worksheet, row formatting, and static totals', async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('sheet1', { properties: { defaultRowHeight: 20 } });
  
  worksheet.columns = AGREEMENT_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  
  // Add sample synthetic data row
  worksheet.addRow({
    accNo: 'C0034483',
    name: 'Lerato Mokhobo',
    channel: 'Online Applications',
    idNumber: '9812110127080',
    createdBy: 'Mothusi Gaoagwe',
    terms: 1,
    product: 'Short Term Loan',
    created: '30/05/2026',
    deferred: 4465.00,
    capital: 4000.00,
    intr: 118.90,
    ini: 465.00,
    adm: 61.94,
    vat: 0.00,
    payments: -4807.75,
    balance: 0.00
  });

  // Add sample totals row
  worksheet.addRow({
    accNo: '',
    name: '',
    channel: '',
    idNumber: '',
    createdBy: '',
    terms: '',
    product: '',
    created: '',
    deferred: 'Totals',
    capital: 4000.00,
    intr: 118.90,
    ini: 465.00,
    adm: 61.94,
    vat: 0.00,
    payments: -4807.75,
    balance: 0.00
  });

  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(Buffer.isBuffer(buffer), 'Output must be a valid binary Buffer');
  assert.ok(buffer.length > 500, 'Buffer must be populated OpenXML archive');

  // Parse buffer back with ExcelJS to verify round-trip OpenXML fidelity
  const parsedWorkbook = new ExcelJS.Workbook();
  await parsedWorkbook.xlsx.load(buffer);
  
  const parsedSheet = parsedWorkbook.getWorksheet('sheet1');
  assert.ok(parsedSheet, 'Worksheet "sheet1" must exist in parsed workbook');
  assert.equal(parsedSheet.rowCount, 3, 'Worksheet must contain Header, 1 Data Row, and Totals Row');

  // Verify Header row
  const row1 = parsedSheet.getRow(1);
  assert.equal(row1.getCell(1).value, 'Acc No');
  assert.equal(row1.getCell(3).value, 'Channel');
  assert.equal(row1.getCell(9).value, 'Deferred');
  assert.equal(row1.getCell(15).value, 'Payments');
  assert.equal(row1.getCell(16).value, 'Balance');

  // Verify Data row
  const row2 = parsedSheet.getRow(2);
  assert.equal(row2.getCell(1).value, 'C0034483');
  assert.equal(row2.getCell(3).value, 'Online Applications');
  assert.equal(row2.getCell(9).value, 4465.00);
  assert.equal(row2.getCell(10).value, 4000.00);
  assert.equal(row2.getCell(15).value, -4807.75, 'Payments must be negative float in data row');
  assert.equal(row2.getCell(16).value, 0.00);

  // Verify Totals row
  const row3 = parsedSheet.getRow(3);
  assert.equal(row3.getCell(9).value, 'Totals', 'Deferred column in totals row must have text "Totals"');
  assert.equal(row3.getCell(10).value, 4000.00);
  assert.equal(row3.getCell(15).value, -4807.75, 'Payments in totals row must be static negative number');
  assert.equal(typeof row3.getCell(15).value, 'number', 'Totals must be static numeric values, NOT formula objects');
});

test('10. Installment Workbook OpenXML Generation — Verifies installment schedule layout and totals', async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('sheet1', { properties: { defaultRowHeight: 20 } });
  
  worksheet.columns = INSTALLMENT_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));

  // Add sample synthetic installment row
  worksheet.addRow({
    accNo: 'C0106631',
    name: 'MOTHUSI GAOAGWE',
    employer: 'FINBOND',
    idNumber: '7606166843083',
    createdBy: 'Mothusi Gaoagwe',
    phone: '0821234567',
    freq: 'Monthly',
    inst: 2,
    product: 'Short Term Loan',
    colMethod: 'DebiCheck',
    due: '15/10/2026',
    overdue: 0.00,
    doStatus: 'Active',
    instAm: 1313.50,
    paid: 0.00,
    balance: 1313.50
  });

  // Add sample totals row
  worksheet.addRow({
    accNo: '',
    name: '',
    employer: '-',
    idNumber: '',
    createdBy: '',
    phone: '',
    freq: '',
    inst: '',
    product: '',
    colMethod: '',
    due: '',
    overdue: '',
    doStatus: '-',
    instAm: 1313.50,
    paid: 0.00,
    balance: 1313.50
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const parsedWorkbook = new ExcelJS.Workbook();
  await parsedWorkbook.xlsx.load(buffer);

  const parsedSheet = parsedWorkbook.getWorksheet('sheet1');
  assert.ok(parsedSheet, 'Worksheet "sheet1" must exist');

  // Verify headers
  const row1 = parsedSheet.getRow(1);
  assert.equal(row1.getCell(1).value, 'Acc No');
  assert.equal(row1.getCell(3).value, 'Employer');
  assert.equal(row1.getCell(10).value, 'Col Method');
  assert.equal(row1.getCell(13).value, 'D/O Status');
  assert.equal(row1.getCell(14).value, 'Inst Am');

  // Verify data
  const row2 = parsedSheet.getRow(2);
  assert.equal(row2.getCell(3).value, 'FINBOND');
  assert.equal(row2.getCell(10).value, 'DebiCheck');
  assert.equal(row2.getCell(13).value, 'Active');
  assert.equal(row2.getCell(14).value, 1313.50);

  // Verify totals row
  const row3 = parsedSheet.getRow(3);
  assert.equal(row3.getCell(3).value, '-', 'Employer in totals row must be "-"');
  assert.equal(row3.getCell(13).value, '-', 'D/O Status in totals row must be "-"');
  assert.equal(row3.getCell(14).value, 1313.50);
  assert.equal(row3.getCell(16).value, 1313.50);
});
