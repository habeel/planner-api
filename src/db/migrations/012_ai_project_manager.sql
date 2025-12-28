-- AI Project Manager tables
-- Migration: 012_ai_project_manager.sql

-- AI conversation threads per workspace
CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(255),
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Individual messages in a conversation
CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    -- Structured data for rich responses (task suggestions, capacity overviews, etc.)
    -- Schema: { type: 'task_suggestions', tasks: [...] } | { type: 'capacity_overview', ... }
    structured_data JSONB,
    -- Token tracking for billing
    input_tokens INTEGER,
    output_tokens INTEGER,
    model VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Usage tracking for billing (aggregated monthly)
CREATE TABLE IF NOT EXISTS ai_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    month DATE NOT NULL, -- First day of month (e.g., 2024-01-01)
    input_tokens_used BIGINT DEFAULT 0,
    output_tokens_used BIGINT DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    UNIQUE(workspace_id, month)
);

-- AI feature settings per workspace
CREATE TABLE IF NOT EXISTS ai_settings (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT FALSE,
    preferred_provider VARCHAR(20) DEFAULT 'openai' CHECK (preferred_provider IN ('openai', 'anthropic')),
    preferred_model VARCHAR(50) DEFAULT 'gpt-4o-mini',
    monthly_token_limit BIGINT, -- NULL = use plan default
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_conversations_workspace ON ai_conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_workspace_updated ON ai_conversations(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_created_by ON ai_conversations(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON ai_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_month ON ai_usage(workspace_id, month);
