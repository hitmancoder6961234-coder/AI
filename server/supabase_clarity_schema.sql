-- ============================================================================
-- CLARITY PRODUCTION PERSISTENCE SCHEMA (SUPABASE POSTGRESQL)
-- ============================================================================
-- Run this script in the Supabase SQL Editor to guarantee all persistence tables
-- exist with primary keys, indexes, and full service-role compatibility.
-- ============================================================================

-- 1. Users Table (Core account persistence)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password TEXT,
  active_model_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(LOWER(email));
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 2. Sessions Table (Session persistence across restarts/redeploys)
CREATE TABLE IF NOT EXISTS public.sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions(expires_at);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- 3. Models Table (User-configured AI models)
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_models_user_id_id ON public.models(user_id, id);
CREATE INDEX IF NOT EXISTS idx_models_user_id ON public.models(user_id);
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- 4. Projects Table
CREATE TABLE IF NOT EXISTS public.projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT DEFAULT 'upload',
  root_path TEXT,
  status TEXT DEFAULT 'ready',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_indexed_at BIGINT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- 5. Project Files Table
CREATE TABLE IF NOT EXISTS public.project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  extension TEXT,
  language TEXT,
  size BIGINT DEFAULT 0,
  hash TEXT,
  version INTEGER DEFAULT 1,
  content TEXT,
  is_binary INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON public.project_files(project_id);
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

-- 6. Workspace Files Table
CREATE TABLE IF NOT EXISTS public.workspace_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  file_type TEXT NOT NULL,
  content TEXT NOT NULL,
  uploaded_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_files_user_id ON public.workspace_files(user_id);
ALTER TABLE public.workspace_files ENABLE ROW LEVEL SECURITY;

-- 7. Conversations Table
CREATE TABLE IF NOT EXISTS public.conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  model_id TEXT,
  project_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- 8. Messages Table
CREATE TABLE IF NOT EXISTS public.messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model_id TEXT,
  attachments JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 9. Artifacts Table
CREATE TABLE IF NOT EXISTS public.artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_id TEXT,
  name TEXT NOT NULL,
  path TEXT,
  mime_type TEXT,
  artifact_type TEXT,
  version INTEGER DEFAULT 1,
  hash TEXT,
  content TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON public.artifacts(project_id);
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

-- 10. Knowledge Chunks Table (RAG)
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_id TEXT,
  chunk_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  chunk_type TEXT DEFAULT 'code',
  symbol TEXT,
  start_line INTEGER,
  end_line INTEGER,
  hash TEXT,
  version INTEGER DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_project_id ON public.knowledge_chunks(project_id);
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
