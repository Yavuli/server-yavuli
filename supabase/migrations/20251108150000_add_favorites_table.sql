-- Create favorites table
CREATE TABLE IF NOT EXISTS public.favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    listing_id UUID REFERENCES public.listings(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, listing_id)  -- Ensure a user can only favorite a listing once
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_listing_id ON public.favorites(listing_id);

-- Add a favorites_count column to the listings table
ALTER TABLE public.listings 
ADD COLUMN IF NOT EXISTS favorites_count INTEGER DEFAULT 0;

-- Function to update favorites count
CREATE OR REPLACE FUNCTION update_favorites_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.listings 
        SET favorites_count = favorites_count + 1 
        WHERE id = NEW.listing_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.listings 
        SET favorites_count = GREATEST(0, favorites_count - 1) 
        WHERE id = OLD.listing_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for favorites
DROP TRIGGER IF EXISTS trg_favorites_count ON public.favorites;
CREATE TRIGGER trg_favorites_count
AFTER INSERT OR DELETE ON public.favorites
FOR EACH ROW EXECUTE FUNCTION update_favorites_count();

-- Function to get client IP (for view counting)
CREATE OR REPLACE FUNCTION get_client_ip()
RETURNS INET AS $$
BEGIN
    RETURN inet_client_addr();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a view_logs table to track views
CREATE TABLE IF NOT EXISTS public.view_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID REFERENCES public.listings(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for view_logs
CREATE INDEX IF NOT EXISTS idx_view_logs_listing_id ON public.view_logs(listing_id);
CREATE INDEX IF NOT EXISTS idx_view_logs_user_id ON public.view_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_view_logs_ip ON public.view_logs(ip_address, user_agent);

-- Function to increment view count
CREATE OR REPLACE FUNCTION increment_view_count(listing_id_param UUID, user_id_param UUID DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
    client_ip INET;
    user_agent TEXT;
    view_exists BOOLEAN;
BEGIN
    -- Get client IP and user agent
    client_ip := get_client_ip();
    user_agent := current_setting('app.settings.user_agent', true);
    
    -- Check if this view should be counted (unique by IP + user_agent + listing_id)
    SELECT EXISTS (
        SELECT 1 FROM public.view_logs 
        WHERE listing_id = listing_id_param 
        AND ip_address = client_ip 
        AND (user_agent = user_agent OR user_agent IS NULL)
        AND created_at > (NOW() - INTERVAL '24 hours')
    ) INTO view_exists;
    
    -- If not viewed recently, log the view and increment count
    IF NOT view_exists THEN
        INSERT INTO public.view_logs (listing_id, user_id, ip_address, user_agent)
        VALUES (listing_id_param, user_id_param, client_ip, user_agent);
        
        UPDATE public.listings 
        SET views = views + 1 
        WHERE id = listing_id_param;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
