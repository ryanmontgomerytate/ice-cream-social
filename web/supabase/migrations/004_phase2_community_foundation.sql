-- ============================================================
-- Phase 2: Community Editing + Moderation Foundation
-- ============================================================
-- Scope:
-- - Hosted schema primitives for auth-linked profiles, revision history,
--   moderation queue/actions, reports, audit, trust, and rate-limit telemetry.
-- - API/UI flows are out of scope for this migration.
-- ============================================================

-- ------------------------------------------------------------
-- Generic updated_at trigger helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- User profile + role model
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
    id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username        text UNIQUE,
    display_name    text,
    avatar_url      text,
    bio             text,
    is_suspended    boolean NOT NULL DEFAULT false,
    suspended_reason text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key             text NOT NULL UNIQUE,
    description     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles (key, description)
VALUES
    ('admin', 'Global administrator'),
    ('moderator', 'Moderation and trust/safety reviewer'),
    ('trusted_editor', 'Editor allowed to bypass some moderation queues'),
    ('member', 'Default signed-in community member')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_role_assignments (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role_id         bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by     uuid REFERENCES profiles(id),
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS show_memberships (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    show_id         bigint NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role_id         bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by      uuid REFERENCES profiles(id),
    granted_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (show_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_role_assignments_user_id ON user_role_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_show_memberships_show_id ON show_memberships(show_id);
CREATE INDEX IF NOT EXISTS idx_show_memberships_user_id ON show_memberships(user_id);

-- ------------------------------------------------------------
-- Revision and moderation workflow primitives
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_revisions (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    show_id                 bigint REFERENCES shows(id) ON DELETE SET NULL,
    content_type            text NOT NULL,
    content_id              bigint NOT NULL,
    revision_number         integer NOT NULL CHECK (revision_number > 0),
    operation               text NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    title                   text,
    summary                 text,
    payload                 jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by              uuid REFERENCES profiles(id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    is_approved             boolean NOT NULL DEFAULT false,
    approved_by             uuid REFERENCES profiles(id),
    approved_at             timestamptz,
    reverted_from_revision_id bigint REFERENCES content_revisions(id),
    UNIQUE (content_type, content_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_content_revisions_content ON content_revisions(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_content_revisions_show_id ON content_revisions(show_id);
CREATE INDEX IF NOT EXISTS idx_content_revisions_created_at ON content_revisions(created_at DESC);

CREATE TABLE IF NOT EXISTS pending_edits (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    revision_id     bigint NOT NULL UNIQUE REFERENCES content_revisions(id) ON DELETE CASCADE,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'needs_changes', 'auto_approved')),
    risk_score      numeric(5,2) NOT NULL DEFAULT 0,
    risk_reason     text,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    reviewed_by     uuid REFERENCES profiles(id),
    reviewed_at     timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_edits_status ON pending_edits(status);
CREATE INDEX IF NOT EXISTS idx_pending_edits_submitted_at ON pending_edits(submitted_at DESC);

CREATE TABLE IF NOT EXISTS moderation_queue (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    show_id         bigint REFERENCES shows(id) ON DELETE SET NULL,
    queue_type      text NOT NULL CHECK (queue_type IN ('pending_edit', 'report', 'system_flag')),
    ref_id          bigint NOT NULL,
    priority        integer NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
    assigned_to     uuid REFERENCES profiles(id),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (queue_type, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_moderation_queue_status_priority
    ON moderation_queue(status, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS moderation_actions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    queue_item_id   bigint REFERENCES moderation_queue(id) ON DELETE SET NULL,
    action          text NOT NULL CHECK (action IN (
                        'approve',
                        'reject',
                        'needs_changes',
                        'rollback',
                        'lock',
                        'unlock',
                        'suspend_user',
                        'unsuspend_user'
                    )),
    actor_user_id   uuid REFERENCES profiles(id),
    target_user_id  uuid REFERENCES profiles(id),
    notes           text,
    metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_queue_item_id ON moderation_actions(queue_item_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_actor_user_id ON moderation_actions(actor_user_id);

CREATE TABLE IF NOT EXISTS reports (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    show_id         bigint REFERENCES shows(id) ON DELETE SET NULL,
    reporter_user_id uuid REFERENCES profiles(id),
    target_type     text NOT NULL CHECK (target_type IN (
                        'revision',
                        'user',
                        'wiki_lore',
                        'segment',
                        'clip',
                        'comment'
                    )),
    target_id       bigint NOT NULL,
    reason          text NOT NULL,
    details         text,
    status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'triaged', 'resolved', 'dismissed')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_by     uuid REFERENCES profiles(id),
    resolved_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reports_status_created_at ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

-- ------------------------------------------------------------
-- Abuse controls / telemetry
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_limit_events (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
    ip_address      inet,
    action_key      text NOT NULL,
    window_start    timestamptz NOT NULL,
    window_seconds  integer NOT NULL CHECK (window_seconds > 0),
    hit_count       integer NOT NULL DEFAULT 1 CHECK (hit_count > 0),
    blocked         boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_action_window
    ON rate_limit_events(action_key, window_start DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_user_id
    ON rate_limit_events(user_id);

CREATE TABLE IF NOT EXISTS trust_scores (
    user_id                 uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    score                   numeric(8,2) NOT NULL DEFAULT 0,
    approved_edits          integer NOT NULL DEFAULT 0,
    rejected_edits          integer NOT NULL DEFAULT 0,
    reports_received        integer NOT NULL DEFAULT 0,
    reports_confirmed       integer NOT NULL DEFAULT 0,
    auto_publish_enabled    boolean NOT NULL DEFAULT false,
    last_updated            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id   uuid REFERENCES profiles(id),
    action          text NOT NULL,
    entity_type     text NOT NULL,
    entity_id       text,
    metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip_address      inet,
    user_agent      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- ------------------------------------------------------------
-- Import auditing extension
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS import_batch_items (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id        bigint NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    table_name      text NOT NULL,
    row_count       integer NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'complete', 'failed')),
    error           text,
    started_at      timestamptz,
    completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_import_batch_items_batch_id ON import_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batch_items_table_name ON import_batch_items(table_name);

-- ------------------------------------------------------------
-- Updated_at triggers
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;
CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_pending_edits_updated_at ON pending_edits;
CREATE TRIGGER set_pending_edits_updated_at
BEFORE UPDATE ON pending_edits
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_moderation_queue_updated_at ON moderation_queue;
CREATE TRIGGER set_moderation_queue_updated_at
BEFORE UPDATE ON moderation_queue
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

ALTER TABLE profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_memberships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_revisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_edits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_queue        ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_actions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_scores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batch_items      ENABLE ROW LEVEL SECURITY;

-- Phase 2 foundation keeps anon access closed by default.
-- Policies for authenticated/admin access will be added with API/auth implementation.
