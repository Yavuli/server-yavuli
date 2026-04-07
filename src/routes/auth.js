const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/authmiddleware');
const asyncHandler = require('../utils/asyncHandler');


router.get('/', (req, res) => {
  try {
    res.status(200).json({
      message: "Auth route is working successfully!"
    });
  } catch (error) {
    console.error("Error in fetching auth route:", error);
    res.status(500).json({
      error: "Internal server error"
    });
  }
});

// Check if email exists in database
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log('Checking email existence:', email);

    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      console.error('Error checking email:', error);
      throw error;
    }

    return res.status(200).json({
      success: true,
      exists: !!data
    });
  } catch (error) {
    console.error('Error in check-email route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify email existence',
      error: error.message
    });
  }
});

// Create or sync user record in database (called after signup)
router.post('/sync-user', authMiddleware, async (req, res) => {
  try {
    const { full_name, city, college_name, college_email, phone, is_verified } = req.body;
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId || !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User information missing'
      });
    }

    console.log('Syncing user to database:', { userId, userEmail, full_name, city, college_name, college_email });

    // 1. Sync User record (location/phone)
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id, full_name, location, phone')
      .eq('id', userId)
      .single();

    if (!existingUser && fetchError?.code === 'PGRST116') {
      await supabase.from('users').insert([{
        id: userId,
        email: userEmail,
        full_name: full_name || userEmail.split('@')[0],
        location: city || null,
        phone: phone || null,
        is_verified: is_verified || false,
      }]);
    } else if (existingUser) {
      const userUpdates = {};
      if (full_name && full_name !== existingUser.full_name) userUpdates.full_name = full_name;
      if (city && city !== existingUser.location) userUpdates.location = city;
      if (phone && phone !== existingUser.phone) userUpdates.phone = phone;
      if (typeof is_verified === 'boolean') userUpdates.is_verified = is_verified;

      if (Object.keys(userUpdates).length > 0) {
       await supabase.from('users').update(userUpdates).eq('id', userId);
      }
    }

    // 2. Sync Profiles record (college info)
    const { data: existingProfile, error: profileFetchError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    const profileData = {
      id: userId,
      full_name: full_name || userEmail.split('@')[0],
      college_email: college_email || null,
      college_name: college_name || null,
      phone: phone || null,
      updated_at: new Date().toISOString()
    };

    if (!existingProfile && profileFetchError?.code === 'PGRST116') {
      await supabase.from('profiles').insert([profileData]);
    } else {
      await supabase.from('profiles').update(profileData).eq('id', userId);
    }

    res.status(200).json({
      success: true,
      message: 'User and profile records synced'
    });

  } catch (error) {
    console.error('Error in sync-user route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync user/profile',
      error: error.message
    });
  }
});

// Simple login for testing (using Supabase Auth)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Ask superbase to verify credentials
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) {
      console.error(' Login error:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        error: error.message
      });
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Refresh access token endpoint
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({
      success: false,
      message: 'Refresh token is required'
    });
  }

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token
  });

  if (error) {
    console.error('Token refresh error:', error);
    return res.status(401).json({
      success: false,
      message: 'Failed to refresh token',
      code: 'REFRESH_FAILED',
      error: error.message
    });
  }

  res.status(200).json({
    success: true,
    message: 'Token refreshed successfully',
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at
  });
}));


module.exports = router;
