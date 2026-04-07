import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { transactionId } = await req.json();

    if (!transactionId) {
      throw new Error('Transaction ID is required');
    }

    console.log(`📧 Processing emails for transaction: ${transactionId}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch Transaction Data First
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) throw new Error('Transaction not found');

    // 2. Fetch Related Data in Parallel (Using college_email)
    const [buyerRes, sellerRes, listingRes] = await Promise.all([
      supabase.from('profiles').select('college_email, full_name, phone').eq('id', transaction.buyer_id).single(),
      supabase.from('profiles').select('college_email, full_name, phone').eq('id', transaction.seller_id).single(),
      supabase.from('listings').select('title, description, price').eq('id', transaction.listing_id).single()
    ]);

    if (buyerRes.error) console.error('🔴 Buyer DB Error:', buyerRes.error);
    if (sellerRes.error) console.error('🔴 Seller DB Error:', sellerRes.error);
    if (listingRes.error) console.error('🔴 Listing DB Error:', listingRes.error);

    // Map 'college_email' to 'email' so Resend and your HTML templates still work perfectly
    const buyer = buyerRes.data ? { ...buyerRes.data, email: buyerRes.data.college_email } : null;
    const seller = sellerRes.data ? { ...sellerRes.data, email: sellerRes.data.college_email } : null;
    const listing = listingRes.data;

    if (!buyer || !seller || !listing) {
      throw new Error(`Data missing -> Buyer exists: ${!!buyer} | Seller exists: ${!!seller} | Listing exists: ${!!listing}`);
    }
    // 3. Send Emails in Parallel
    const [buyerEmailResult, sellerEmailResult] = await Promise.all([
      sendEmailToBuyer({ transaction, buyer, listing }),
      sendEmailToSeller({ transaction, seller, buyer, listing })
    ]);

    console.log('✅ Email processing complete');

    return new Response(
      JSON.stringify({
        success: true,
        buyerEmailSent: buyerEmailResult.success,
        sellerEmailSent: sellerEmailResult.success,
        message: 'Email notifications processed',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Edge Function Error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================
// SEND BUYER EMAIL
// ============================================
async function sendEmailToBuyer({ transaction, buyer, listing }: any) {
  try {
    const html = generateBuyerHTML({ transaction, buyer, listing });
    
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [buyer.email],
        subject: `Order Confirmation - ${listing.title}`,
        html: html,
      }),
    });

    if (!res.ok) {
        const errorText = await res.text();
        console.error('❌ Resend API error (buyer):', errorText);
        return { success: false, error: errorText };
    }

    const result = await res.json();
    console.log('✅ Buyer email sent:', result.id);
    return { success: true, id: result.id };
  } catch (err: any) {
    console.error('❌ Buyer Email Error:', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================
// SEND SELLER EMAIL
// ============================================
async function sendEmailToSeller({ transaction, seller, buyer, listing }: any) {
  try {
    const html = generateSellerHTML({ transaction, seller, buyer, listing });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [seller.email],
        subject: `New Sale - ${listing.title}`,
        html: html,
      }),
    });

    if (!res.ok) {
        const errorText = await res.text();
        console.error('❌ Resend API error (seller):', errorText);
        return { success: false, error: errorText };
    }

    const result = await res.json();
    console.log('✅ Seller email sent:', result.id);
    return { success: true, id: result.id };
  } catch (err: any) {
    console.error('❌ Seller Email Error:', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================
// BUYER HTML TEMPLATE
// ============================================
function generateBuyerHTML({ transaction, buyer, listing }: any): string {
  const buyerName = buyer.full_name || buyer.email.split('@')[0];
  
  const dateStr = transaction.transaction_date 
    ? new Date(transaction.transaction_date).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
      })
    : new Date().toLocaleDateString('en-IN');

  return `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0;">
  <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background-color: #4CAF50; color: white; padding: 30px 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 28px;">🎉 Order Confirmed!</h1>
    </div>
    <div style="padding: 30px;">
      <h2>Hi ${buyerName},</h2>
      <p>Thank you for your purchase on <strong>Yavuli Marketplace</strong>! Your payment has been received successfully.</p>
      
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4CAF50;">
        <h3 style="margin-top: 0; color: #4CAF50;">📦 Order Details</h3>
        <p><strong>Item:</strong> ${listing.title}</p>
        <p><strong>Transaction ID:</strong> #${transaction.id}</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Amount Paid:</strong> <span style="font-size: 18px; color: #4CAF50; font-weight: bold;">₹${parseFloat(transaction.amount).toFixed(2)}</span></p>
      </div>

      <h3>📍 What happens next?</h3>
      <p>The seller has been notified and will contact you soon to arrange delivery or pickup. You can view your order details in your Yavuli account.</p>
      
      <p style="margin-top: 30px;">If you have any questions, feel free to reach out to our support team at <a href="mailto:admin@yavuli.app">admin@yavuli.app</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ============================================
// SELLER HTML TEMPLATE
// ============================================
function generateSellerHTML({ transaction, seller, buyer, listing }: any): string {
  const sellerName = seller.full_name || seller.email.split('@')[0];
  const buyerName = buyer.full_name || buyer.email.split('@')[0];
  
  // UPDATED: Use exact values from DB
  const platformFee = parseFloat(transaction.platform_fee).toFixed(2);
  const sellerAmount = parseFloat(transaction.seller_amount).toFixed(2);
  
  const dateStr = transaction.transaction_date 
    ? new Date(transaction.transaction_date).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
      })
    : new Date().toLocaleDateString('en-IN');

  return `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0;">
  <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background-color: #2196F3; color: white; padding: 30px 20px; text-align: center;">
      <h1 style="margin: 0; font-size: 28px;">💰 Item Sold!</h1>
      <p style="margin: 10px 0 0 0; font-size: 18px;">Congratulations on your sale</p>
    </div>
    <div style="padding: 30px;">
      <h2>Hi ${sellerName},</h2>
      <p>Great news! Your listing <strong>"${listing.title}"</strong> has been purchased on Yavuli Marketplace.</p>
      
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196F3;">
        <h3 style="margin-top: 0; color: #2196F3;">📦 Sale Details</h3>
        <p><strong>Transaction ID:</strong> #${transaction.id}</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Sale Amount:</strong> <span style="font-weight: bold;">₹${parseFloat(transaction.amount).toFixed(2)}</span></p>
      </div>

      <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
        <h3 style="margin-top: 0; color: #f57c00;">👤 Buyer Contact Information</h3>
        <p><strong>Name:</strong> ${buyerName}</p>
        <p><strong>Email:</strong> ${buyer.email}</p>
        <p><strong>Phone:</strong> ${buyer.phone || 'Not provided'}</p>
        <p style="margin: 15px 0 0 0; font-size: 14px;">Please contact the buyer to arrange delivery or pickup.</p>
      </div>

      <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
        <h3 style="margin-top: 0; color: #28a745;">💵 Your Payout</h3>
        <p>Sale Amount: ₹${parseFloat(transaction.amount).toFixed(2)}</p>
        <p style="color: #d32f2f;">Platform Fee (5%): -₹${platformFee}</p>
        <p style="font-size: 18px; font-weight: bold; color: #28a745;">Net Payout: ₹${sellerAmount}</p>
        <p style="margin: 15px 0 0 0; font-size: 14px; color: #666;">
          <strong>Timeline:</strong> Transferred within 3-7 working days after delivery.
        </p>
      </div>

      <h3>📍 Next Steps</h3>
      <ol>
        <li>Contact the buyer using the information provided above</li>
        <li>Arrange delivery or pickup of the item</li>
        <li>Your payment will be processed automatically after delivery</li>
      </ol>
      
      <p style="margin-top: 20px;">If you have any questions, please contact us at <a href="mailto:admin@yavuli.app">admin@yavuli.app</a></p>
    </div>
  </div>
</body>
</html>`;
}