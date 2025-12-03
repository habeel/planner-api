-- Platform administrators table (separate from regular users for security)
CREATE TABLE platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('OWNER', 'ADMIN', 'SUPPORT')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin sessions (separate from user refresh tokens)
CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin audit log (tracks all admin actions - immutable)
CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  admin_email VARCHAR(255), -- Preserved even if admin deleted
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50), -- 'organization', 'user', 'subscription', 'admin'
  target_id UUID,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for admin sessions
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);
CREATE INDEX idx_admin_sessions_token ON admin_sessions(token_hash);

-- Indexes for audit logs
CREATE INDEX idx_admin_audit_admin ON admin_audit_logs(admin_id);
CREATE INDEX idx_admin_audit_target ON admin_audit_logs(target_type, target_id);
CREATE INDEX idx_admin_audit_created ON admin_audit_logs(created_at DESC);
CREATE INDEX idx_admin_audit_action ON admin_audit_logs(action);

-- Add last_login_at to users table for admin visibility
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
