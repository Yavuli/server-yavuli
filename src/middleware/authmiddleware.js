const supabase = require('../config/supabase');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check if token exists
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided. Please login first.'
      });
    }

    const token = authHeader.split(' ')[1];

    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);

      // Check if token is invalid or expired
      if (error || !user) {
        console.error('Token verification failed:', error?.message);

        // Differentiate between expired and invalid tokens
        const isExpired = error?.message?.includes('expired') ||
          error?.message?.includes('JWT') ||
          error?.message?.includes('token');

        return res.status(401).json({
          success: false,
          message: isExpired ? 'Session expired' : 'Invalid token',
          code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
          error: error?.message
        });
      }

      // Attach user info to request object for use in routes
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        metadata: user.user_metadata || {}
      };
      console.log('User authenticated:', user.email);

      next();
    } catch (tokenError) {
      console.error('Token verification error:', tokenError.message);
      return res.status(401).json({
        success: false,
        message: 'Token verification failed'
      });
    }
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: error.message
    });
  }
};



const adminMiddleware = (req, res, next) => {
  // Check if the user has the 'admin' role OR matches your specific email
  if (req.user.role !== 'admin' && req.user.email !== '23r01a05cu@cmrithyderabad.edu.in') {
    return res.status(403).json({ 
      success: false, 
      message: 'Access Denied: Admins Only' 
    });
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware }; // Export both