const axios = require('axios');
require('dotenv').config();

async function main() {
  const clientId = process.env.DATANAMIX_CLIENT_ID;
  const clientSecret = process.env.DATANAMIX_CLIENT_SECRET;
  const baseUrl = process.env.DATANAMIX_BASE_URL || 'https://api.datanamix.com';

  console.log('Testing with credentials:');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Client ID: ${clientId}`);
  console.log(`Client Secret: ${clientSecret ? '***' : 'undefined'}`);

  const tokenUrl = `${baseUrl}/v1/oauth/token`;
  console.log(`Attempting OAuth to: ${tokenUrl}`);

  let token;
  try {
    const response = await axios.post(
      tokenUrl,
      {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      },
      {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 10000,
      }
    );
    token = response.data.access_token;
    console.log('OAuth SUCCESS. Token obtained:', token ? (token.substring(0, 15) + '...') : 'undefined');
  } catch (err) {
    console.error('OAuth FAILED:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', err.response.data);
    }
    return;
  }

  // Test ProfilePlusIDVerificationAndPhoto
  const kycEndpoint = `${baseUrl}/v1/id-verification/ProfilePlusIDVerificationAndPhoto`;
  console.log(`Testing KYC endpoint: ${kycEndpoint}`);
  try {
    const kycRes = await axios.post(kycEndpoint, {
      IDNumber: '7706065690088',
      ClientReference: 'TEST-REF',
      PDFEncryptionPassword: '0123456789',
      EnvironmentType: 'PRODUCTION',
      OutputFormat: 'JSON',
      CaptureImage: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      timeout: 10000
    });
    console.log('KYC Endpoint Response Status:', kycRes.status);
    console.log('KYC Endpoint Response Data:', kycRes.data);
  } catch (err) {
    console.error('KYC Endpoint FAILED:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', err.response.data);
    }
  }

  // Test address-plus-profile-idv
  const bureauEndpoint = `${baseUrl}/v1/kyc/address-plus-profile-idv`;
  console.log(`Testing Bureau endpoint: ${bureauEndpoint}`);
  try {
    const bureauRes = await axios.post(bureauEndpoint, {
      Surname: 'Shounyane',
      IDNumber: '8309135520085',
      PassportNumber: '',
      ClientReference: 'TEST-REF',
      OutputFormat: 'JSON_AND_PDF',
      PDFEncryptionPassword: '0123456789',
      EnvironmentType: 'PRODUCTION'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      timeout: 10000
    });
    console.log('Bureau Endpoint Response Status:', bureauRes.status);
    console.log('Bureau Endpoint Response Data:', bureauRes.data);
  } catch (err) {
    console.error('Bureau Endpoint FAILED:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', err.response.data);
    }
  }
}

main();
