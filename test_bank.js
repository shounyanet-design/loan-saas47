require('dotenv').config();
const datanamixAxiosClient = require('./src/services/datanamix/datanamixClient');

async function checkBank() {
  const payload = {
    EnvironmentType: 'SANDBOX',
    OutputFormat: 'JSON_AND_PDF',
    PDFEncryptionPassword: '8001015009087',
    ClientReference: 'TEST',
    Initials: 'JD',
    FirstName: 'John',
    Surname: 'Doe',
    IdentityType: 'IDNumber',
    IdentityNumber: '8001015009087',
    BankAccountNumber: '123456789',
    BankBranchCode: '000205',
    BankAccountType: 'Current',
  };

  try {
    const response = await datanamixAxiosClient.post('/v1/bank/account-verification-advanced', payload);
    console.log(JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.log("Error:", err.message, err.response?.data);
  }
}

checkBank();
