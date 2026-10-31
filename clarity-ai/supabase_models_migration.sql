-- ============================================================================
-- CLARITY PRODUCTION MIGRATION: public.models (Production-Safe RLS)
-- ============================================================================
-- This migration creates the model registry table in Supabase PostgreSQL
-- with exact schema matching server.ts / supabase.ts, RLS enabled, and 
-- zero permissive public policies (protecting against direct client access while
-- allowing full access to the server-side Supabase service-role client).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.models (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT,
  provider TEXT,
  provider_model_id TEXT,
  capabilities TEXT,
  context_window INTEGER DEFAULT 16000,
  max_output_tokens INTEGER DEFAULT 4096,
  temperature REAL DEFAULT 0.7,
  top_p REAL DEFAULT 1.0,
  base_url TEXT,
  api_secret TEXT,
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'available',
  is_user INTEGER DEFAULT 0,
  created_at BIGINT,
  updated_at BIGINT,
  PRIMARY KEY (user_id, id)
);

-- Safe non-destructive alter if the table already existed with a single-column primary key on id
DO $$
BEGIN
  -- Check if the primary key constraint on public.models is strictly on id alone
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name 
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_name = 'models' 
      AND tc.table_schema = 'public' 
      AND tc.constraint_type = 'PRIMARY KEY'
    GROUP BY tc.constraint_name
    HAVING count(*) = 1 AND max(kcu.column_name) = 'id'
  ) THEN
    ALTER TABLE public.models DROP CONSTRAINT IF EXISTS models_pkey;
    ALTER TABLE public.models ADD PRIMARY KEY (user_id, id);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Primary key migration exception: %', SQLERRM;
END $$;

-- Uniqueness constraint & index on (user_id, id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_models_user_id_id ON public.models(user_id, id);

-- Index on user_id for efficient tenant isolation lookups
CREATE INDEX IF NOT EXISTS idx_models_user_id ON public.models(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- Drop any existing legacy policies
DROP POLICY IF EXISTS "Users can view own models" ON public.models;
DROP POLICY IF EXISTS "Users can insert own models" ON public.models;
DROP POLICY IF EXISTS "Users can update own models" ON public.models;
DROP POLICY IF EXISTS "Users can delete own models" ON public.models;
DROP POLICY IF EXISTS "Deny direct public access" ON public.models;

-- Note: With RLS enabled and NO permissive policies for anon/authenticated roles,
-- direct browser/client access is completely blocked. The Render backend uses
-- the Supabase service-role key (getSupabaseAdmin()), which automatically bypasses
-- RLS and performs all server-side queries securely.

-- Force PostgREST schema cache reload so public.models is immediately recognized
NOTIFY pgrst, 'reload schema';
