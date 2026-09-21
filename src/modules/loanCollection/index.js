const loanCollectionService = require('./loanCollectionService');
const payFastTokenizationService = require('./payFastTokenizationService');
const collectionRules = require('./collectionRules');
const collectionReconciliation = require('./collectionReconciliation');
const collectionDispatcher = require('./collectionDispatcher');
const collectionWorker = require('./collectionWorker');
const debitOrderProvider = require('../../services/payments/debitOrderProvider');
const payFastLoanFallbackProvider = require('./providers/payFastLoanFallbackProvider');

module.exports = {
  loanCollectionService,
  payFastTokenizationService,
  collectionRules,
  collectionReconciliation,
  collectionDispatcher,
  collectionWorker,
  debitOrderProvider,
  payFastLoanFallbackProvider
};

