const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/authmiddleware'); // Ensure this path is correct

// ==========================================
// 1. BANK DETAILS ROUTES (Secure - Requires Login)
// ==========================================

// UPDATE Bank Details
router.put('/bank-details', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; // Get ID from the logged-in user
    const { bankAccount, ifscCode, holderName } = req.body;

    // Validation
    if (!bankAccount || !ifscCode || !holderName) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide Account Number, IFSC Code, and Holder Name.' 
      });
    }

    // Update the PROFILES table (Secure storage)
    const { data, error } = await supabase
      .from('profiles')
      .update({
        bank_account_number: bankAccount,
        bank_ifsc: ifscCode,
        bank_holder_name: holderName,
        updated_at: new Date()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating bank details:', error);
      return res.status(500).json({ success: false, message: 'Failed to save bank details' });
    }

    return res.status(200).json({
      success: true,
      message: 'Bank details saved successfully',
      data: {
        bankAccount: data.bank_account_number,
        ifsc: data.bank_ifsc,
        holderName: data.bank_holder_name
      }
    });

  } catch (err) {
    console.error('SERVER ERROR:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// GET Bank Details (For pre-filling the form)
router.get('/bank-details', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('profiles')
      .select('bank_account_number, bank_ifsc, bank_holder_name')
      .eq('id', userId)
      .single();

    if (error) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    return res.status(200).json({
      success: true,
      data: data
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


// ==========================================
// 2. PUBLIC USER ROUTES (Existing Code)
// ==========================================

// GET all users
router.get('/', async (req, res) => {
  try {
    // Fetch all users
    const { data, error } = await supabase.from('users').select('*');

    if (error) {
      console.error("Error fetching users:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch users",
        details: error.message
      });
    }

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      count: data.length,
      data: data
    });

  } catch (error) {
    console.error("Error in user route:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// GET a single user by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .single();
      
    if (error) {
      console.error(`Error fetching user:${id}`, error);
      return res.status(404).json({
        success: false,
        error: "User not found",
        details: error.message
      });
    }

    res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: data
    });

  } catch (error) {
    console.error("Error in user route:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

module.exports = router;