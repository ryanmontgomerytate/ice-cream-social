-- ============================================================
-- Phase 2: Moderation Write Actions + Role-Aware RLS
-- ============================================================
-- Scope:
-- - Add role helper function for authenticated checks.
-- - Add transactional moderation-action RPC.
-- - Add RLS policies for moderator/admin write paths.
-- ============================================================

-- ------------------------------------------------------------
-- Role helper (reads role tables via SECURITY DEFINER)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_has_role(role_keys text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_role_assignments ura
        JOIN public.roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid()
          AND r.key = ANY(role_keys)
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(text[]) TO authenticated;

-- ------------------------------------------------------------
-- Moderation action enum expansion (assign/unassign)
-- ------------------------------------------------------------
ALTER TABLE public.moderation_actions
    DROP CONSTRAINT IF EXISTS moderation_actions_action_check;

ALTER TABLE public.moderation_actions
    ADD CONSTRAINT moderation_actions_action_check
    CHECK (action IN (
        'approve',
        'reject',
        'needs_changes',
        'rollback',
        'lock',
        'unlock',
        'assign',
        'unassign',
        'suspend_user',
        'unsuspend_user'
    ));

-- ------------------------------------------------------------
-- Transactional moderation action RPC (invoker, RLS enforced)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_moderation_action(
    p_queue_item_id bigint,
    p_action text,
    p_notes text DEFAULT NULL,
    p_assigned_to uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_queue moderation_queue%ROWTYPE;
    v_revision_id bigint;
    v_action text := lower(trim(p_action));
    v_pending_status text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.current_user_has_role(ARRAY['admin', 'moderator']) THEN
        RAISE EXCEPTION 'Moderator role required';
    END IF;

    SELECT *
    INTO v_queue
    FROM public.moderation_queue
    WHERE id = p_queue_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Queue item % not found', p_queue_item_id;
    END IF;

    IF v_action IN ('assign', 'unassign') THEN
        UPDATE public.moderation_queue
        SET
            assigned_to = CASE
                WHEN v_action = 'assign' THEN COALESCE(p_assigned_to, v_actor)
                ELSE NULL
            END,
            status = CASE
                WHEN v_action = 'assign' THEN 'in_review'
                WHEN status = 'in_review' THEN 'open'
                ELSE status
            END,
            notes = COALESCE(p_notes, notes),
            updated_at = now()
        WHERE id = v_queue.id;

        INSERT INTO public.moderation_actions (
            queue_item_id,
            action,
            actor_user_id,
            target_user_id,
            notes
        ) VALUES (
            v_queue.id,
            v_action,
            v_actor,
            CASE WHEN v_action = 'assign' THEN COALESCE(p_assigned_to, v_actor) ELSE NULL END,
            p_notes
        );

        RETURN jsonb_build_object(
            'queue_item_id', v_queue.id,
            'action', v_action,
            'status', CASE WHEN v_action = 'assign' THEN 'in_review' ELSE 'open' END
        );
    END IF;

    IF v_action IN ('approve', 'reject', 'needs_changes') THEN
        IF v_queue.queue_type <> 'pending_edit' THEN
            RAISE EXCEPTION 'Action % is only valid for pending_edit queue items', v_action;
        END IF;

        v_pending_status := CASE
            WHEN v_action = 'approve' THEN 'approved'
            WHEN v_action = 'reject' THEN 'rejected'
            ELSE 'needs_changes'
        END;

        UPDATE public.pending_edits
        SET
            status = v_pending_status,
            reviewed_by = v_actor,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = v_queue.ref_id
        RETURNING revision_id INTO v_revision_id;

        IF v_revision_id IS NULL THEN
            RAISE EXCEPTION 'Pending edit % not found for queue item %', v_queue.ref_id, v_queue.id;
        END IF;

        UPDATE public.content_revisions
        SET
            is_approved = (v_action = 'approve'),
            approved_by = CASE WHEN v_action = 'approve' THEN v_actor ELSE NULL END,
            approved_at = CASE WHEN v_action = 'approve' THEN now() ELSE NULL END
        WHERE id = v_revision_id;

        UPDATE public.moderation_queue
        SET
            status = 'resolved',
            notes = COALESCE(p_notes, notes),
            updated_at = now()
        WHERE id = v_queue.id;

        INSERT INTO public.moderation_actions (
            queue_item_id,
            action,
            actor_user_id,
            notes
        ) VALUES (
            v_queue.id,
            v_action,
            v_actor,
            p_notes
        );

        RETURN jsonb_build_object(
            'queue_item_id', v_queue.id,
            'action', v_action,
            'status', 'resolved',
            'pending_edit_id', v_queue.ref_id,
            'revision_id', v_revision_id
        );
    END IF;

    RAISE EXCEPTION 'Unsupported moderation action: %', p_action;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_moderation_action(bigint, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_moderation_action(bigint, text, text, uuid) TO authenticated;

-- ------------------------------------------------------------
-- RLS policies for moderator/admin write path
-- ------------------------------------------------------------

DROP POLICY IF EXISTS moderator_read_content_revisions ON public.content_revisions;
CREATE POLICY moderator_read_content_revisions
    ON public.content_revisions
    FOR SELECT
    TO authenticated
    USING (public.current_user_has_role(ARRAY['admin', 'moderator']));

DROP POLICY IF EXISTS moderator_update_content_revisions ON public.content_revisions;
CREATE POLICY moderator_update_content_revisions
    ON public.content_revisions
    FOR UPDATE
    TO authenticated
    USING (public.current_user_has_role(ARRAY['admin', 'moderator']))
    WITH CHECK (public.current_user_has_role(ARRAY['admin', 'moderator']));

DROP POLICY IF EXISTS moderator_read_pending_edits ON public.pending_edits;
CREATE POLICY moderator_read_pending_edits
    ON public.pending_edits
    FOR SELECT
    TO authenticated
    USING (public.current_user_has_role(ARRAY['admin', 'moderator']));

DROP POLICY IF EXISTS moderator_update_pending_edits ON public.pending_edits;
CREATE POLICY moderator_update_pending_edits
    ON public.pending_edits
    FOR UPDATE
    TO authenticated
    USING (public.current_user_has_role(ARRAY['admin', 'moderator']))
    WITH CHECK (public.current_user_has_role(ARRAY['admin', 'moderator']));

DROP POLICY IF EXISTS moderator_read_moderation_queue ON public.moderation_queue;
CREATE POLICY moderator_read_moderation_queue
    ON public.moderation_queue
    FOR SELECT
    TO authenticated
    USING (public.current_user_has_role(ARRAY['admin', 'moderator']));

DROP POLICY IF EXISTS moderator_update_moderation_queue ON public.moderation_queue;
CREATE POLICY moderator_update_moderation_queue
    ON public.moderation_queue
    FOR UPDATE
    TO authenticated
    USING (public.current_user_has_role(ARRAY['admin', 'moderator']))
    WITH CHECK (public.current_user_has_role(ARRAY['admin', 'moderator']));

DROP POLICY IF EXISTS moderator_read_moderation_actions ON public.moderation_actions;
CREATE POLICY moderator_read_moderation_actions
    ON public.moderation_actions
    FOR SELECT
    TO authenticated
    USING (public.current_user_has_role(ARRAY['admin', 'moderator']));

DROP POLICY IF EXISTS moderator_insert_moderation_actions ON public.moderation_actions;
CREATE POLICY moderator_insert_moderation_actions
    ON public.moderation_actions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.current_user_has_role(ARRAY['admin', 'moderator'])
        AND actor_user_id = auth.uid()
    );
