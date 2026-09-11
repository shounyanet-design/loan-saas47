const loanCollectionService = require('./loanCollectionService');
const payFastTokenizationService = require('./payFastTokenizationService');
const collectionRules = require('./collectionRules');
const collectionReconciliation = require('./collectionReconciliation');
const collectionDispatcher = require('./collectionDispatcher');
const collectionWorker = require('./collectionWorker');
const realPayCollectionProvider = require('./providers/realPayCollectionProvider');
const payFastLoanFallbackProvider = require('./providers/payFastLoanFallbackProvider');

module.exports = {
  loanCollectionService,
  payFastTokenizationService,
  collectionRules,
  collectionReconciliation,
  collectionDispatcher,
  collectionWorker,
  realPayCollectionProvider,
  payFastLoanFallbackProvider
};
