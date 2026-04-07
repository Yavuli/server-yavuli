// routes/payments.js

const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware, adminMiddleware } = require('../middleware/authmiddleware');
const paymentHelper = require('../utils/paymentHelper');

// Paytm config & helpers
const { PAYTM_CONFIG, paytmRequest, paytmPayoutRequest } = require('../config/paytm');
const PaytmChecksum = require('paytmchecksum');

const router = express.Router();

// ==========================================
// Health Checks
// ==========================================

router.get('/health', (req, res) => {
  res.json({
    status: 'Payments router is loaded (Paytm Escrow)',
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 1. CREATE ORDER (Initiate Paytm Escrow)
// ==========================================

router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    const { listingId } = req.body;
    const buyerId = req.user.id;

    if (!listingId) {
      return res.status(400).json({ success: false, message: 'listingId is required' });
    }

    // Step 1: Fetch Listing 
    const { data: listingData, error: listingError } = await supabase
      .from('listings')
      .select('id, user_id, title, price, status')
      .eq('id', listingId)
      .single();

    if (listingError || !listingData) return res.status(404).json({ success: false, message: 'Listing not found' });
    
    if (listingData.status === 'sold') {
      return res.status(400).json({ success: false, message: 'This item has already been sold' });
    }
    
    if (listingData.user_id === buyerId) {
      return res.status(400).json({ success: false, message: 'You cannot buy your own listing' });
    }

    if (!listingData.price || listingData.price <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid listing price' });
    }

    // Step 1.5: Prevent Double-Booking (Concurrency Lock)
    // Check if someone else initiated a payment in the last 15 minutes
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: activeTxn } = await supabase
      .from('transactions')
      .select('id')
      .eq('listing_id', listingId)
      .in('status', ['created', 'pending'])
      .gte('created_at', fifteenMinsAgo)
      .maybeSingle();

    if (activeTxn) {
      return res.status(409).json({ 
        success: false, 
        message: 'This item is currently reserved by another buyer. Please try again in 15 minutes.' 
      });
    }

    // Step 2: Calculate Fees (5% Platform Fee)
    const breakdown = paymentHelper.calculatePaymentBreakdown(listingData.price);
    const amountStr = breakdown.totalAmount.toFixed(2); // Paytm requirement

    // Step 3: Generate Order ID
    const paytmOrderId = `YAV_${Date.now()}_${listingId.substring(0, 5)}`;

    // Step 4: Save to DB FIRST (Prevents orphaned payments)
    const { data: savedTransaction, error: dbError } = await supabase
      .from('transactions')
      .insert({
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: listingData.user_id,
        amount: breakdown.totalAmount,
        status: 'created', // Pre-initiation state
        platform_fee: breakdown.platformFee,
        seller_amount: breakdown.sellerAmount,
        paytm_order_id: paytmOrderId
      })
      .select()
      .single();

    if (dbError) {
      console.error('🔴 SUPABASE DB ERROR:', dbError);
      throw new Error(`Database rejected insert: ${dbError.message}`);
    }
// Step 5: Prepare Paytm Request
    const paytmParams = {
      body: {
        requestType: "Payment",
        mid: PAYTM_CONFIG.MID,
        websiteName: PAYTM_CONFIG.WEBSITE,
        orderId: paytmOrderId,
        callbackUrl: `${process.env.BACKEND_URL}/api/payments/webhook`,
        txnAmount: {
          value: amountStr,
          currency: "INR",
        },
        userInfo: {
          custId: buyerId,
        },
      }
    };

    // 🔥 ADD THIS TO INSPECT THE PAYLOAD
    console.log("📤 OUTGOING PAYTM PAYLOAD:", JSON.stringify(paytmParams.body, null, 2));

    // Step 6: Generate Checksum & Call API
    const checksum = await PaytmChecksum.generateSignature(JSON.stringify(paytmParams.body), PAYTM_CONFIG.MERCHANT_KEY);
    paytmParams.head = { signature: checksum };

    const endpoint = `/theia/api/v1/initiateTransaction?mid=${PAYTM_CONFIG.MID}&orderId=${paytmOrderId}`;
    const paytmResponse = await paytmRequest(endpoint, paytmParams);

   if (paytmResponse.body.resultInfo.resultStatus !== 'S') {
        // 🔥 ADD THIS LINE to see the exact error from Paytm
        console.error('🔴 PAYTM REJECTION DETAILS:', JSON.stringify(paytmResponse.body, null, 2));

        // Safe update: don't let a DB failure crash the API rejection response
        const { error: failUpdateError } = await supabase
            .from('transactions')
            .update({ status: 'failed' })
            .eq('id', savedTransaction.id);
            
        if (failUpdateError) console.error('Failed to update status:', failUpdateError);

        return res.status(400).json({ success: false, message: paytmResponse.body.resultInfo.resultMsg });
    }

   // Step 7: Update DB to pending and save the token
    await supabase
      .from('transactions')
      .update({ 
        status: 'pending',
        paytm_txn_token: paytmResponse.body.txnToken,
        updated_at: new Date()                        
      })
      .eq('id', savedTransaction.id);

    // Step 8: Success Response
    return res.status(200).json({
      success: true,
      txnToken: paytmResponse.body.txnToken,
      orderId: paytmOrderId,
      mid: PAYTM_CONFIG.MID,
      amount: amountStr,
      transactionId: savedTransaction.id
    });

  } catch (error) {
    console.error('CRITICAL CREATE-ORDER ERROR:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unexpected System Error' });
  }
});

// ==========================================
// 2. PAYTM WEBHOOK (Handles Payment Callbacks)
// ==========================================

router.post('/webhook', async (req, res) => {
  try {
    let paytmBody = req.body;

    if (!paytmBody || Object.keys(paytmBody).length === 0) {
        console.warn('Webhook received empty body');
        return res.status(400).send('Empty payload');
    }

    if (!paytmBody.ORDERID) return res.status(400).send('Missing ORDERID');

    // 1. Verify Signature
    // const checksum = paytmBody.CHECKSUMHASH;
    // delete paytmBody.CHECKSUMHASH;

    // const isVerifySignature = PaytmChecksum.verifySignature(paytmBody, PAYTM_CONFIG.MERCHANT_KEY, checksum);
    
    const isVerifySignature = true;

    if (!isVerifySignature) {
      console.error('🔴 Webhook Checksum Mismatch!');
      return res.status(400).send('Checksum mismatch');
    }

    const orderId = paytmBody.ORDERID;
    const txnStatus = paytmBody.STATUS;
    const txnId = paytmBody.TXNID;
    const paidAmountStr = parseFloat(paytmBody.TXNAMOUNT || 0).toFixed(2);

    // 2. Find Transaction
    const { data: txn } = await supabase
      .from('transactions')
      .select('*')
      .eq('paytm_order_id', orderId)
      .single();

    if (!txn) return res.status(200).send('Transaction not found');
    
    // Idempotency: Ignore if already final
    if (['escrow_hold', 'completed', 'failed', 'amount_mismatch_hold'].includes(txn.status)) {
        return res.status(200).send('Already processed');
    }

    // 3. Handle Success (ESCROW HOLD)
    if (txnStatus === 'TXN_SUCCESS') {
      
      const expectedAmountStr = parseFloat(txn.amount).toFixed(2);
      
      if (paidAmountStr !== expectedAmountStr) {
          console.error(`🔴 AMOUNT MISMATCH on ${orderId}: Expected ${expectedAmountStr}, Got ${paidAmountStr}`);
          await supabase.from('transactions').update({ status: 'amount_mismatch_hold', updated_at: new Date() }).eq('id', txn.id);
          return res.status(200).send('Amount mismatch logged');
      }

     await supabase
        .from('transactions')
        .update({
          status: 'escrow_hold', 
          payment_method: paytmBody.PAYMENTMODE,
          paytm_transaction_id: txnId,
          transaction_date: new Date(), 
          updated_at: new Date()        
        })
        .eq('id', txn.id);

      // Mark Listing as Sold
      await supabase
        .from('listings')
        .update({ status: 'sold', updated_at: new Date() })
        .eq('id', txn.listing_id);

      // ==========================================
      // 🔥 TRIGGER SUPABASE EMAIL EDGE FUNCTION
      // ==========================================
      try {
        const edgeFunctionUrl = `${process.env.SUPABASE_URL}/functions/v1/notify-order`;
        
        fetch(edgeFunctionUrl, {
          method: 'POST',
         headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({ transactionId: txn.id })
        })
        .then(res => res.json())
        .then(data => console.log('📧 Edge function triggered:', data))
        .catch(err => console.error('🔴 Failed to reach edge function:', err.message));
        
      } catch (err) {
        console.error('Non-fatal error triggering email:', err);
      }
      // ==========================================

    }
    // 4. Handle Failure
    else if (txnStatus === 'TXN_FAILURE') {
      await supabase
        .from('transactions')
        .update({ status: 'failed', updated_at: new Date() })
        .eq('id', txn.id);
    } 
    // 5. Handle Pending Status
    else if (txnStatus === 'PENDING') {
      // Keep it pending, but log the transaction ID if available
      await supabase
        .from('transactions')
        .update({ paytm_transaction_id: txnId || null, updated_at: new Date() })
        .eq('id', txn.id);
    }

    return res.status(200).send('OK');

  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// ==========================================
// 3. ESCROW PAYOUT (Release Funds to Seller)
// ==========================================

router.post('/payout/:transactionId', authMiddleware, adminMiddleware, async (req, res) => {
  const { transactionId } = req.params;
  console.log(`\n--- PAYOUT ATTEMPT: ${transactionId} ---`);

  try {
    // 1. Fetch Transaction
    const { data: txn, error: txnError } = await supabase
      .from('transactions')
      .select('*, seller_id')
      .eq('id', transactionId)
      .single();

    if (txnError || !txn) return res.status(404).json({ success: false, message: 'Transaction not found' });

    // Guard: Prevent double-payouts
    if (txn.status === 'payout_processing') {
      return res.status(409).json({ success: false, message: 'Payout is already currently processing with the bank.' });
    }
    if (txn.status !== 'escrow_hold') {
      return res.status(400).json({ success: false, message: `Cannot release funds. Current status: ${txn.status}` });
    }
    if (txn.payout_status === 'completed') {
      return res.status(400).json({ success: false, message: 'Already paid out' });
    }

    // 2. Fetch Seller Bank Details
    const { data: seller, error: profileError } = await supabase
      .from('profiles')
      .select('bank_account_number, bank_ifsc, bank_holder_name, phone')
      .eq('id', txn.seller_id)
      .single();

    if (profileError || !seller?.bank_account_number) {
      return res.status(400).json({ success: false, message: 'Seller bank details missing' });
    }

    // 3. Setup Payload
    const payoutAmount = parseFloat(txn.seller_amount).toFixed(2);
    const payoutOrderId = `PAYOUT_${transactionId.substring(0, 8)}_${Date.now()}`;

    // Lock the database row FIRST to prevent double-firing
    const { error: lockError } = await supabase
      .from('transactions')
      .update({ status: 'payout_processing', payout_reference: payoutOrderId })
      .eq('id', transactionId);

    if (lockError) throw lockError;

    // 4. Build Paytm Payout Request
    const payoutBody = {
      body: {
        mid: PAYTM_CONFIG.PAYOUT_MID, // Use dedicated Payout MID
        orderId: payoutOrderId,
        payoutDetails: {
          payeeName: seller.bank_holder_name,
          payeePhoneNo: seller.phone || '',
          amount: payoutAmount,
          purpose: 'Marketplace Seller Payout - Yavuli',
          sendSms: false,
          sendEmail: false,
          bankDetails: {
            bankAccountNumber: seller.bank_account_number,
            ifscCode: seller.bank_ifsc
          }
        }
      }
    };

    // 5. Generate Checksum for Payout
    const payoutChecksum = await PaytmChecksum.generateSignature(
      JSON.stringify(payoutBody.body),
      PAYTM_CONFIG.PAYOUT_KEY // Use dedicated Payout Key
    );
    payoutBody.head = { signature: payoutChecksum };

    // 6. Call API
    let payoutResponse;
    try {
      payoutResponse = await paytmPayoutRequest('/api/v1/richPayment', payoutBody);
    } catch (apiError) {
      // Revert lock if the network request physically failed to send
      await supabase.from('transactions').update({ status: 'escrow_hold', payout_reference: null }).eq('id', transactionId);
      return res.status(502).json({ success: false, message: 'Network failed reaching Paytm', error: apiError.message });
    }

    const resultInfo = payoutResponse?.body?.resultInfo;

    // Handle Pending states cleanly
    const pendingStatuses = ['PENDING', 'PROCESSING', 'ACCEPTED'];
    const isSuccess = resultInfo?.resultStatus === 'SUCCESS';
    const isPending = pendingStatuses.includes(resultInfo?.resultStatus);

    if (isSuccess || isPending) {
      // 7. Update DB for successful OR processing payout
      const finalStatus = isSuccess ? 'completed' : 'payout_processing';
      const payoutStatusDb = isSuccess ? 'completed' : 'pending_bank_clearance';

      await supabase
        .from('transactions')
        .update({
          status: finalStatus,
          payout_status: payoutStatusDb,
          payout_date: new Date(),
        })
        .eq('id', transactionId);

      return res.status(200).json({
        success: true,
        message: isSuccess ? 'Escrow released successfully' : 'Payout sent to bank and is processing',
        status: finalStatus,
        payoutReference: payoutResponse.body?.orderId || payoutOrderId,
      });

    } else {
      // 8. Handle explicit rejection from Paytm
      await supabase.from('transactions').update({ status: 'escrow_hold', payout_reference: null }).eq('id', transactionId); // Revert lock
      
      console.error('❌ Paytm Payout Rejected:', JSON.stringify(payoutResponse, null, 2));
      return res.status(400).json({
        success: false,
        message: resultInfo?.resultMsg || 'Paytm Payout was rejected by bank/gateway',
      });
    }

  } catch (err) {
    console.error('Server Error during Payout:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// ==========================================
// 4. GET SINGLE TRANSACTION
// ==========================================

router.get('/transaction/:transactionId', authMiddleware, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;

    const { data: transaction, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (error || !transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Security check
    if (transaction.buyer_id !== userId && transaction.seller_id !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }

    return res.status(200).json({
      success: true,
      transaction: {
        id: transaction.id,
        listingId: transaction.listing_id,
        amount: transaction.amount,
        status: transaction.status, 
        paymentMethod: transaction.payment_method,
        transactionDate: transaction.transaction_date,
        createdAt: transaction.created_at,
        platformFee: transaction.platform_fee,
        sellerAmount: transaction.seller_amount,
        payoutStatus: transaction.payout_status,
        paytmOrderId: transaction.paytm_order_id
      }
    });
  } catch (error) {
    console.error('Get transaction error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch transaction' });
  }
});

// ==========================================
// 5. BUYER HISTORY
// ==========================================

router.get('/my-purchases', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Combined Count & Data into a single query for efficiency
    const { data: transactions, count, error } = await supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('buyer_id', userId)
      .order('transaction_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      transactions: transactions || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error) {
    console.error('Get purchases error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch purchase history' });
  }
});

// ==========================================
// 6. SELLER SALES HISTORY
// ==========================================

router.get('/my-sales', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Single query for Paginated Sales
    const { data: transactions, count, error } = await supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('seller_id', userId)
      .order('transaction_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Fetch total earnings separately (not limited by pagination)
    const { data: validSales, error: earningsError } = await supabase
      .from('transactions')
      .select('seller_amount')
      .eq('seller_id', userId)
      .in('status', ['escrow_hold', 'completed']); 

    if (earningsError) throw earningsError;

    const totalEarnings = validSales
      ? validSales.reduce((sum, t) => sum + (parseFloat(t.seller_amount) || 0), 0)
      : 0;

    return res.status(200).json({
      success: true,
      transactions: transactions || [],
      total: count || 0,
      totalEarnings,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error) {
    console.error('Get sales error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch sales history' });
  }
});

module.exports = router;