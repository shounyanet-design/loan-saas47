const Joi = require('joi');

const dateYmd = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const money = Joi.string().pattern(/^\d{1,13}\.\d{2}$/);
const cardAcceptor = Joi.string().pattern(/^\d{15}$/);
const contractReference = Joi.string().max(14).pattern(/^[A-Za-z0-9]*$/).allow('');
const phone = Joi.string().pattern(/^\+\d{1,3}-\d{7,15}$/);

const frequencyLimits = {
  ADHO: 360,
  FRTN: 780,
  MIAN: 60,
  MNTH: 360,
  QURT: 120,
  WEEK: 1560,
  YEAR: 30
};

const collectionDayByFrequency = {
  ADHO: new Set(['01','02','03','04','05','06','07','08','09','10','11','12','14','99']),
  FRTN: new Set(Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, '0'))),
  MIAN: new Set([...Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0')), '99']),
  MNTH: new Set(Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0'))),
  QURT: new Set([...Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0')), '99']),
  WEEK: new Set(Array.from({ length: 7 }, (_, i) => String(i + 1).padStart(2, '0'))),
  YEAR: new Set([...Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0')), '99'])
};

const mandateInitiationSchema = Joi.object({
  cardAcceptor: cardAcceptor.optional(),
  frequency: Joi.string().valid(...Object.keys(frequencyLimits)).required(),
  collectionDay: Joi.string().required(),
  clientReference: Joi.string().max(35).required(),
  contractReference,
  debtorName: Joi.string().max(30).required(),
  debtorIdType: Joi.string().valid('1', '2', '3', '4').required(),
  debtorId: Joi.string().max(35).required(),
  debtorAccountNumber: Joi.string().max(19).pattern(/^\d+$/).required(),
  debtorAccountType: Joi.string().valid('01', '02', '03').required(),
  debtorBankId: Joi.string().valid('1','2','3','6','7','9','10','16','19','44','55','61','63','67').required(),
  debtorBranchNumber: Joi.string().length(6).pattern(/^\d{6}$/).required(),
  debtorIdUltimate: Joi.string().max(35).allow(''),
  debtorPhoneNumber: phone.required(),
  debtorEmail: Joi.string().email().max(90).allow(''),
  debtorAuthenticationRequired: Joi.string().valid('0227', '0230', '0997').required(),
  firstCollectionAmount: money.allow(''),
  firstCollectionDate: dateYmd.allow(''),
  instalmentAmount: money.required(),
  maxCollectionAmount: money.required(),
  adjustmentCategory: Joi.string().valid('N', 'Q', 'A', 'B', 'R').required(),
  adjustmentAmount: money.allow(''),
  adjustmentRate: Joi.string().pattern(/^\d{1,3}(\.\d{1,2})?$/).allow(''),
  startDate: dateYmd.required(),
  dateAdjustmentRule: Joi.string().valid('Y', 'N').required(),
  debitValueTypeId: Joi.string().valid('1', '2', '3').required(),
  instalments: Joi.number().integer().min(1).max(1560).required(),
  trackingIndicator: Joi.string().pattern(/^(0[0-9]|10)$/).required(),
  mac: Joi.string().allow(''),
  authenticationType: Joi.string().valid('REAL TIME', 'PREAUTH', 'BATCH').required(),
  entryClass: Joi.string().valid(
    '0021','0022','0023','0026','0028','0031','0032','0033','0034',
    '0035','0036','0037','0041','0042','0044','0046'
  ).required(),
  loadType: Joi.string().valid('0', '1').allow(''),
  nonWarehouseMandate: Joi.string().valid('0', '1').allow(''),
  smsOptIn: Joi.string().valid('Y', 'N').allow(''),
  employerCode: Joi.string().max(8).pattern(/^[A-Za-z0-9]*$/).allow(''),
  insuranceModelID: Joi.string().allow(''),
  insuranceAmount: money.allow('')
}).unknown(false).custom((value, helpers) => {
  const days = collectionDayByFrequency[value.frequency];
  if (!days || !days.has(value.collectionDay)) {
    return helpers.error('any.custom', { message: 'collectionDay is invalid for frequency' });
  }

  if (value.instalments > frequencyLimits[value.frequency]) {
    return helpers.error('any.custom', { message: 'instalments exceeds the frequency term limit' });
  }

  const firstAmount = value.firstCollectionAmount || '';
  const firstDate = value.firstCollectionDate || '';
  if (Boolean(firstAmount) !== Boolean(firstDate)) {
    return helpers.error('any.custom', { message: 'firstCollectionAmount and firstCollectionDate are co-dependent' });
  }

  const instalment = Number(value.instalmentAmount);
  const maximum = Number(value.maxCollectionAmount);
  if (maximum < instalment) {
    return helpers.error('any.custom', { message: 'maxCollectionAmount must be at least instalmentAmount' });
  }
  if (['1', '2'].includes(value.debitValueTypeId) && maximum > instalment * 1.5) {
    return helpers.error('any.custom', { message: 'maxCollectionAmount cannot exceed 1.5 times instalmentAmount' });
  }

  const amountSet = Boolean(value.adjustmentAmount);
  const rateSet = Boolean(value.adjustmentRate) && value.adjustmentRate !== '0';
  if (value.adjustmentCategory === 'N' && (amountSet || rateSet)) {
    return helpers.error('any.custom', { message: 'adjustment fields must be empty when adjustmentCategory is N' });
  }
  if (['Q', 'A', 'B'].includes(value.adjustmentCategory) && amountSet === rateSet) {
    return helpers.error('any.custom', { message: 'exactly one adjustment amount or rate is required' });
  }
  if (value.debitValueTypeId === '1' && value.adjustmentCategory !== 'N') {
    return helpers.error('any.custom', { message: 'FIXED mandates can only use adjustmentCategory N' });
  }

  if (value.insuranceModelID && !value.insuranceAmount) {
    return helpers.error('any.custom', { message: 'insuranceAmount is required when insuranceModelID is supplied' });
  }

  if (value.debtorAuthenticationRequired === '0227' && !['BATCH', 'REAL TIME'].includes(value.authenticationType)) {
    return helpers.error('any.custom', { message: '0227 requires BATCH or REAL TIME authentication' });
  }
  if (value.debtorAuthenticationRequired === '0230' && value.authenticationType !== 'REAL TIME') {
    return helpers.error('any.custom', { message: '0230 requires REAL TIME authentication' });
  }

  return value;
}, 'NuPay mandate cross-field validation');

const tt1RegistrationSchema = Joi.object({
  endpointUrl: Joi.string().uri({ scheme: ['https'] }).required(),
  registrationStatus: Joi.string().valid('Register', 'Deregister').required(),
  cardAcceptorEmail: Joi.string().email().required()
}).unknown(false);

const tt1CallbackSchema = Joi.object({
  requestId: Joi.string().required(),
  clientEndPointIp: Joi.string().required(),
  supportMail: Joi.string().email().required(),
  mandateId: Joi.string().required(),
  contractReference: Joi.string().required(),
  statusCode: Joi.string().pattern(/^\d{6}$/).required(),
  statusDescription: Joi.string().required()
}).unknown(false);

const mandateReportSchema = Joi.object({
  merchantNumber: cardAcceptor.optional(),
  accessLvl: Joi.string().valid('M', 'S', 'G').required(),
  username: Joi.string().required(),
  reportType: Joi.string().valid('01','02','03','04','05','06','07').required(),
  dateFrom: Joi.string().pattern(/^\d{8}$/).required(),
  dateTo: Joi.string().pattern(/^\d{8}$/).required(),
  filterType: Joi.string().allow(''),
  filterValue: Joi.string().allow(''),
  tokenID: Joi.string().allow(''),
  blockID: Joi.string().allow('')
}).unknown(false);

const instalmentReportSchema = mandateReportSchema.fork(
  ['reportType'],
  (schema) => schema.valid('01','02','03','04','05','06','07')
);

module.exports = {
  mandateInitiationSchema,
  tt1RegistrationSchema,
  tt1CallbackSchema,
  mandateReportSchema,
  instalmentReportSchema
};
