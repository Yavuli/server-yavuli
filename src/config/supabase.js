const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
// Use SERVICE_ROLE_KEY for server-side auth verification
// Do NOT use ANON_KEY on the server - it lacks permission to verify tokens
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ;

if (!supabaseKey) {
    console.warn('⚠️ WARNING: No Supabase key found! Database operations will fail.');
}
console.log('🔑 Supabase key loaded:', supabaseKey ? `✅ starts with: ${supabaseKey.substring(0, 15)}...` : '❌ UNDEFINED');


// Fallback to avoid crash on startup, allowing server to serve CORS headers and 500 errors instead of 503
const finalKey = supabaseKey || 'MISSING_KEY';

const supabase = createClient(supabaseUrl, finalKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = supabase;