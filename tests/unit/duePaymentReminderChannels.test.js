const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DuePayment = require('../../src/models/DuePayment');

test('Due Payment Reminder Channels Suite', async (t) => {
  await t.test('1. DuePayment reminderHistory accepts Email, SMS, SMS+Email, and Both in type enum', () => {
    const validTypes = ['Email', 'SMS', 'SMS+Email', 'Both', 'System'];
    const typeField = DuePayment.schema.path('reminderHistory').schema.path('type');

    assert.ok(typeField, 'reminderHistory.type must exist');
    for (const type of validTypes) {
      assert.ok(
        typeField.enumValues.includes(type),
        `Enum values must include "${type}". Actual: ${typeField.enumValues.join(', ')}`
      );
    }
  });

  await t.test('2. DuePayment document validates reminder history item with SMS+Email', () => {
    const duePaymentDoc = new DuePayment({
      loanId: new mongoose.Types.ObjectId(),
      loanCode: 'LN-TEST-001',
      totalDueAmount: 1500,
      dueStatus: 'Due Today',
      borrowerName: 'Test Borrower',
      borrowerEmail: 'test@example.com',
      borrowerPhone: '0821234567',
      reminderHistory: [
        {
          date: new Date(),
          type: 'SMS+Email',
          status: 'Sent',
          senderName: 'Admin Officer',
          message: 'Payment reminder for test loan'
        }
      ]
    });

    const error = duePaymentDoc.validateSync(['reminderHistory']);
    assert.equal(error, undefined, 'reminderHistory with SMS+Email should validate without error');
  });

  await t.test('3. DuePayment document validates reminder history item with SMS', () => {
    const duePaymentDoc = new DuePayment({
      loanId: new mongoose.Types.ObjectId(),
      loanCode: 'LN-TEST-002',
      totalDueAmount: 2000,
      dueStatus: 'Overdue',
      borrowerName: 'Test Borrower 2',
      borrowerEmail: 'test2@example.com',
      borrowerPhone: '0839876543',
      reminderHistory: [
        {
          date: new Date(),
          type: 'SMS',
          status: 'Sent',
          senderName: 'Admin Officer',
          message: 'SMS Payment reminder'
        }
      ]
    });

    const error = duePaymentDoc.validateSync(['reminderHistory']);
    assert.equal(error, undefined, 'reminderHistory with SMS should validate without error');
  });
});
