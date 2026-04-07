// config/paytm.js

const axios = require('axios');

const PAYTM_CONFIG = {
  // Collection (Gateway) Credentials
  MID: process.env.PAYTM_MID,
  MERCHANT_KEY: process.env.PAYTM_MERCHANT_KEY,
  
  // Payout Credentials (Crucial: Usually different from Gateway)
  PAYOUT_MID: process.env.PAYTM_PAYOUT_MID || process.env.PAYTM_MID,
  PAYOUT_KEY: process.env.PAYTM_PAYOUT_KEY || process.env.PAYTM_MERCHANT_KEY,

  WEBSITE: process.env.PAYTM_WEBSITE || 'WEBSTAGING',
  INDUSTRY_TYPE_ID: process.env.PAYTM_INDUSTRY_TYPE || 'Retail',
  CHANNEL_ID: process.env.PAYTM_CHANNEL_ID || 'WEB',
  
  BASE_URL: process.env.PAYTM_ENV === 'production'
    ? 'https://securegw.paytm.in'
    : 'https://securegw-stage.paytm.in',
    
  PAYOUT_BASE_URL: process.env.PAYTM_ENV === 'production'
    ? 'https://payout.paytm.com'
    : 'https://payout-staging.paytm.com',
};

// Startup validation
if (!PAYTM_CONFIG.MID || !PAYTM_CONFIG.PAYOUT_MID) {
  console.warn('⚠️ Paytm Credentials missing in .env');
} else {
  console.log(`✅ Paytm PG & Payouts configured | ENV: ${process.env.PAYTM_ENV || 'staging'}`);
}

/**
 * Centralized Paytm API request helper (For Collections)
 */
async function paytmRequest(endpoint, body) {
  const url = `${PAYTM_CONFIG.BASE_URL}${endpoint}`;
  try {
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    return response.data;
  } catch (error) {
    const errMsg = error.response?.data?.body?.resultInfo?.resultMsg || error.message;
    console.error(`🔴 Paytm API Error [${error.response?.status || 'NET'}]: ${errMsg}`);
    throw error;
  }
}

/**
 * Paytm Payouts API request helper
 */
async function paytmPayoutRequest(endpoint, body) {
  const url = `${PAYTM_CONFIG.PAYOUT_BASE_URL}${endpoint}`;
  try {
    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'x-mid': PAYTM_CONFIG.PAYOUT_MID // Paytm Payouts often expects x-mid header
      },
      timeout: 30000
    });
    return response.data;
  } catch (error) {
    const errMsg = error.response?.data?.body?.resultInfo?.resultMsg || error.message;
    console.error(`🔴 Paytm Payout API Error [${error.response?.status || 'NET'}]: ${errMsg}`);
    throw error;
  }
}

module.exports = { PAYTM_CONFIG, paytmRequest, paytmPayoutRequest };