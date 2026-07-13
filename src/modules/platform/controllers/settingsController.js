const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess } = require('../../../utils/responseHandler');
const GlobalSettings = require('../models/GlobalSettings');
const { recordAudit } = require('../utils/audit');

// @route GET /api/platform/settings
exports.get = asyncHandler(async (req, res) => {
  const settings = await GlobalSettings.getSingleton();
  return sendSuccess(res, 'Global settings', settings);
});

// @route PUT /api/platform/settings
exports.update = asyncHandler(async (req, res) => {
  const settings = await GlobalSettings.getSingleton();
  const before = settings.toObject();

  const editable = [
    'platformName', 'platformEmail', 'platformLogo', 'supportEmail', 'supportPhone',
    'timezone', 'currency', 'language', 'maintenanceMode', 'registrationEnabled',
    'defaultTrialDays', 'defaultStorageLimit', 'defaultBorrowerLimit', 'defaultUserLimit',
  ];
  editable.forEach((f) => { if (req.body[f] !== undefined) settings[f] = req.body[f]; });
  await settings.save();

  await recordAudit(req, { action: 'GLOBAL_SETTINGS_UPDATED', entity: 'GlobalSettings', entityId: settings._id, oldValues: before, newValues: settings.toObject() });
  return sendSuccess(res, 'Global settings updated', settings);
});
