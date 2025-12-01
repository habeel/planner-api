-- Migration: 005_organizations.sql
-- Description: Add organizations (multi-tenant) layer with billing support

-- Organizations (Companies/Tenants)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  plan VARCHAR(50) NOT NULL DEFAULT 'free',
  plan_limits JSONB NOT NULL DEFAULT '{"max_users": 3, "max_workspaces": 1, "max_integrations": 0}',
  billing_email VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  subscription_status VARCHAR(50) NOT NULL DEFAULT 'none',
  current_period_end TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User-Organization membership
CREATE TABLE user_organization_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_org_role CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  UNIQUE(organization_id, user_id)
);

-- Add organization_id to workspaces
ALTER TABLE workspaces
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Invitations for onboarding
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
  workspace_role VARCHAR(20) DEFAULT 'DEVELOPER',
  token VARCHAR(255) UNIQUE NOT NULL,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_invitation_role CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  CONSTRAINT valid_workspace_role CHECK (workspace_role IN ('ADMIN', 'TEAM_LEAD', 'DEVELOPER', 'READ_ONLY'))
);

-- Indexes for performance
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_owner ON organizations(owner_id);
CREATE INDEX idx_organizations_stripe_customer ON organizations(stripe_customer_id);

CREATE INDEX idx_user_org_roles_org ON user_organization_roles(organization_id);
CREATE INDEX idx_user_org_roles_user ON user_organization_roles(user_id);

CREATE INDEX idx_workspaces_org ON workspaces(organization_id);

CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_org ON invitations(organization_id);
CREATE INDEX idx_invitations_expires ON invitations(expires_at) WHERE accepted_at IS NULL;

-- Migration for existing data:
-- If there are existing workspaces, we need to create a default organization for them
-- This is wrapped in a DO block to handle the case where there might be no data
DO $$
DECLARE
  default_org_id UUID;
  first_workspace_owner UUID;
BEGIN
  -- Check if there are any existing workspaces
  SELECT owner_id INTO first_workspace_owner FROM workspaces LIMIT 1;

  IF first_workspace_owner IS NOT NULL THEN
    -- Create a default organization
    INSERT INTO organizations (id, name, slug, owner_id, plan, plan_limits)
    VALUES (
      gen_random_uuid(),
      'Default Organization',
      'default-org',
      first_workspace_owner,
      'free',
      '{"max_users": 100, "max_workspaces": 100, "max_integrations": 100}'
    )
    RETURNING id INTO default_org_id;

    -- Link all existing workspaces to the default org
    UPDATE workspaces SET organization_id = default_org_id WHERE organization_id IS NULL;

    -- Add all existing workspace members to the organization
    INSERT INTO user_organization_roles (organization_id, user_id, role)
    SELECT DISTINCT
      default_org_id,
      uwr.user_id,
      CASE
        WHEN uwr.user_id = first_workspace_owner THEN 'OWNER'
        WHEN uwr.role = 'ADMIN' THEN 'ADMIN'
        ELSE 'MEMBER'
      END
    FROM user_workspace_roles uwr
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END IF;
END $$;

-- After migration, make organization_id required for new workspaces
-- Note: We don't add NOT NULL constraint here to allow gradual migration
-- In production, you would add: ALTER TABLE workspaces ALTER COLUMN organization_id SET NOT NULL;
