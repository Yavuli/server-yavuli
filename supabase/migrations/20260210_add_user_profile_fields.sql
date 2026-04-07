-- Add missing profile fields to users table to match frontend expectations
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS city VARCHAR(255),
ADD COLUMN IF NOT EXISTS college VARCHAR(255),
ADD COLUMN IF NOT EXISTS college_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS college_name VARCHAR(255);

-- Update existing rows to migrate data if needed (optional, safe default)
-- UPDATE users SET city = location WHERE city IS NULL AND location IS NOT NULL;
