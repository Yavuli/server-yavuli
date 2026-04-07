CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,   -- fixed
  seller_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- fixed
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'created',          -- changed default from 'pending' to 'created' to match your flow
  payment_method VARCHAR(100),
  transaction_date TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),            -- added

  -- Platform and Seller Split
  platform_fee DECIMAL(10,2) DEFAULT 0,
  seller_amount DECIMAL(10,2) DEFAULT 0,

  -- Payout Tracking
  payout_status VARCHAR(50) DEFAULT 'pending',
  payout_date TIMESTAMP,
  payout_reference VARCHAR(255),

  -- Paytm Identifiers
  paytm_order_id VARCHAR(255),
  paytm_txn_token VARCHAR(500),                  -- added
  paytm_transaction_id VARCHAR(255)
);

-- Indexes
CREATE INDEX idx_transactions_buyer_id ON transactions(buyer_id);
CREATE INDEX idx_transactions_seller_id ON transactions(seller_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_payout_status ON transactions(payout_status);
CREATE INDEX idx_transactions_listing_id ON transactions(listing_id);  -- added (used in double-booking check)
CREATE INDEX idx_transactions_paytm_order_id ON transactions(paytm_order_id); -- added (used in webhook lookup)