const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/authmiddleware');

// Valid condition values
const VALID_CONDITIONS = ['new', 'like-new', 'used'];

// Function to normalize and validate condition
const normalizeCondition = (condition) => {
  if (!condition) return null;
  const normalized = condition.toLowerCase().replace(/\s+/g, '-');
  return VALID_CONDITIONS.includes(normalized) ? normalized : null;
};

// Simple Listing Cache to maximize response speeds
let baseListingsCache = {
  data: null,
  lastUpdated: 0
};
const CACHE_TTL = 30000; // 30 seconds

function invalidateListingsCache() {
  baseListingsCache.data = null;
  baseListingsCache.lastUpdated = 0;
}

async function getBaseListings() {
  if (baseListingsCache.data && (Date.now() - baseListingsCache.lastUpdated) < CACHE_TTL) {
    return baseListingsCache.data;
  }

  const { data, error } = await supabase
    .from('listings')
    .select(`
      *,
      seller:users!user_id (
        is_verified,
        full_name,
        profile_image_url,
        phone
      )
    `)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Base Listings Cache Query Error:", error);
    throw error;
  }

  baseListingsCache.data = data;
  baseListingsCache.lastUpdated = Date.now();
  return data;
}

// POST - Create a new listing
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;
    console.log('--- CREATE LISTING START ---');
    console.log('User ID:', userId);
    console.log('Request body:', req.body);

    const { title, description, category, condition, price, originalPrice, city, college, reason, age, status = 'published', images = [] } = req.body;

    // Validation
    if (!title || !price || !description || !category || !condition) {
      const missing = [];
      if (!title) missing.push('title');
      if (!price) missing.push('price');
      if (!description) missing.push('description');
      if (!category) missing.push('category');
      if (!condition) missing.push('condition');

      console.log('Validation failed - Missing fields:', missing);
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`,
        missingFields: missing
      });
    }

    // Normalize and validate condition
    const normalizedCondition = normalizeCondition(condition);
    if (!normalizedCondition) {
      console.log('Validation failed - Invalid condition:', condition);
      return res.status(400).json({
        success: false,
        error: `Invalid condition. Allowed values are: ${VALID_CONDITIONS.join(', ')}`
      });
    }

    // Ensure user exists in users table (create if not exists)
    try {
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Error checking user existence:', fetchError);
        // Continue but it might fail later
      }

      if (!existingUser) {
        // User doesn't exist, create them
        console.log('Creating user record for:', userId);
        const { error: createError } = await supabase
          .from('users')
          .insert([{
            id: userId,
            email: userEmail,
            full_name: userEmail?.split('@')[0] || 'User',
            location: city || null
          }]);

        if (createError) {
          console.error('Error creating user record:', createError);
          return res.status(500).json({
            success: false,
            error: "User profile could not be initialized",
            details: createError.message
          });
        }
        console.log('User record created successfully');
      }
    } catch (userSyncError) {
      console.error('Critical error in user sync:', userSyncError);
      return res.status(500).json({
        success: false,
        error: "Internal error during user validation",
        details: userSyncError.message
      });
    }

    // Parse images
    let imageArray = [];
    if (typeof images === 'string') {
      try {
        imageArray = JSON.parse(images);
      } catch (e) {
        imageArray = images ? [images] : [];
      }
    } else if (Array.isArray(images)) {
      imageArray = images;
    }

    // Convert status
    let dbStatus = 'active';
    if (status === 'draft') {
      dbStatus = 'draft';
    } else if (status === 'published') {
      dbStatus = 'active';
    }

    console.log('Inserting listing with status:', dbStatus);


    // Extra debug logging for the missing fields issue
    console.log('--- DETAILS DEBUG CHECK ---');
    console.log('Received Reason (why_selling):', reason, 'Type:', typeof reason);
    console.log('Received Age (age_of_item):', age, 'Type:', typeof age);
    console.log('Received Original Price (original_price):', originalPrice, 'Type:', typeof originalPrice);

    // Create the listing
    const { data: listing, error } = await supabase
      .from('listings')
      .insert([{
        user_id: userId,
        title,
        description,
        category,
        condition: normalizedCondition,
        price: parseFloat(price),
        original_price: originalPrice ? parseFloat(originalPrice) : null,
        location_city: city,
        college_name: college,
        why_selling: reason || null,
        age_of_item: age || null,
        images: imageArray,
        status: dbStatus
      }])
      .select();

    console.log('--- INSERTION DEBUG ---');
    console.log('Using Service Role Key:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (error) {
      console.error('Insert Error:', JSON.stringify(error, null, 2));
    } else {
      console.log('Insert Success. Returned Listing:', JSON.stringify(listing, null, 2));
    }

    if (error) {
      console.error("Error creating listing:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to create listing in database",
        details: error.message
      });
    }

    console.log('Listing created successfully:', listing[0].id);
    console.log('--- CREATE LISTING END ---');

    res.status(201).json({
      success: true,
      message: "Listing created successfully",
      data: listing[0]
    });

    // Invalidate the cache to ensure the new listing is immediately visible
    invalidateListingsCache();

  } catch (error) {
    console.error("Fatal error in create listing route:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message
    });
  }
});

// GET all listings with filters
router.get('/', async (req, res) => {
  try {
    const { category, minPrice, maxPrice, condition, verified, searchQuery, limit } = req.query;

    // Fetch base listings from cache or database
    let filteredData = await getBaseListings();

    // Apply category filter in memory
    if (category && category !== '') {
      filteredData = filteredData.filter(item => item.category === category);
    }

    // Apply price range filters in memory
    if (minPrice) {
      filteredData = filteredData.filter(item => item.price >= parseFloat(minPrice));
    }
    if (maxPrice) {
      filteredData = filteredData.filter(item => item.price <= parseFloat(maxPrice));
    }

    // Apply condition filter in memory
    if (condition && condition !== '') {
      filteredData = filteredData.filter(item => item.condition === condition);
    }

    // Apply verification filter in memory
    if (verified === 'true') {
      filteredData = filteredData.filter(item => item.seller?.is_verified === true);
    }

    // Apply search query (simple title/description search) in memory
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      filteredData = filteredData.filter(item =>
        (item.title && item.title.toLowerCase().includes(lowerQuery)) ||
        (item.description && item.description.toLowerCase().includes(lowerQuery))
      );
    }

    const originalCount = filteredData.length;

    // Apply limit in memory
    if (limit) {
      filteredData = filteredData.slice(0, parseInt(limit, 10));
    }

    res.status(200).json({
      success: true,
      message: "Listings fetched successfully",
      count: filteredData.length,
      originalCount: originalCount,
      data: filteredData
    });

  } catch (error) {
    console.error("Error in listings route:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// GET listings created by the authenticated user
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { data, error } = await supabase
      .from('listings')
      .select(`
        *,
        seller:users!user_id (
          full_name,
          phone,
          profile_image_url,
          is_verified
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user listings:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch listings',
        error: error.message
      });
    }

    res.status(200).json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('Error in /my listings route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// GET a single listing by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Get the listing
    const { data: listing, error: fetchError } = await supabase
      .from('listings')
      .select(`
        *,
        seller:users!user_id (
          full_name,
          phone,
          profile_image_url,
          is_verified
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error("Error fetching listing:", fetchError);
      return res.status(404).json({
        success: false,
        error: "Listing not found",
        details: fetchError.message
      });
    }

    res.status(200).json({
      success: true,
      message: "Listing fetched successfully",
      data: listing
    });

  } catch (error) {
    console.error("Error in listings route:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// Note: Favoriting and Popular (view-based) routes have been removed as per requirements.

// DELETE (soft delete) a listing owned by the authenticated user
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    const { data: listing, error: fetchError } = await supabase
      .from('listings')
      .select('id, user_id, status')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('Error fetching listing for deletion:', fetchError);
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    if (listing.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this listing'
      });
    }

    const { error: updateError } = await supabase
      .from('listings')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      console.error('Error archiving listing:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete listing',
        error: updateError.message
      });
    }

    res.status(200).json({
      success: true,
      message: 'Listing removed successfully'
    });

    // Invalidate the cache since a listing was removed
    invalidateListingsCache();

  } catch (error) {
    console.error('Error deleting listing:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
