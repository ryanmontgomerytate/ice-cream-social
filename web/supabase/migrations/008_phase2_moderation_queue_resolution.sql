-- ============================================================
-- Phase 2: Moderation Queue Resolution for Reports/System Flags
-- ============================================================
-- Scope:
-- - Add resolve/dismiss moderation actions.
-- - Extend transactional moderation-action RPC to support
--   report/system_flag queue items end-to-end.
-- ============================================================

ALTER TABLE public.moderation_actions
    DROP CONSTRAINT IF EXISTS moderation_actions_action_check;

ALTER TABLE public.moderation_actions
    ADD CONSTRAINT moderation_actions_action_check
    CHECK (action IN (
        'approve',
        'reject',
        'needs_changes',
        'resolve',
        'dismiss',
        'rollback',
        'lock',
        'unlock',
        'assign',
        'unassign',
        'suspend_user',
        'unsuspend_user'
    ));

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
    v_queue_status text;
    v_report_status text;
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
        WHERE id = v_queue.id
        RETURNING status INTO v_queue_status;

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
            'queue_type', v_queue.queue_type,
            'action', v_action,
            'status', v_queue_status
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
            'queue_type', v_queue.queue_type,
            'action', v_action,
            'status', 'resolved',
            'pending_edit_id', v_queue.ref_id,
            'revision_id', v_revision_id
        );
    END IF;

    IF v_action IN ('resolve', 'dismiss') THEN
        IF v_queue.queue_type NOT IN ('report', 'system_flag') THEN
            RAISE EXCEPTION 'Action % is only valid for report/system_flag queue items', v_action;
        END IF;

        v_queue_status := CASE
            WHEN v_action = 'resolve' THEN 'resolved'
            ELSE 'dismissed'
        END;

        IF v_queue.queue_type = 'report' THEN
            v_report_status := CASE
                WHEN v_action = 'resolve' THEN 'resolved'
                ELSE 'dismissed'
            END;

            UPDATE public.reports
            SET
                status = v_report_status,
                resolved_by = v_actor,
                resolved_at = now()
            WHERE id = v_queue.ref_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Report % not found for queue item %', v_queue.ref_id, v_queue.id;
            END IF;
        END IF;

        UPDATE public.moderation_queue
        SET
            status = v_queue_status,
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
            'queue_type', v_queue.queue_type,
            'action', v_action,
            'status', v_queue_status,
            'ref_id', v_queue.ref_id
        );
    END IF;

    RAISE EXCEPTION 'Unsupported moderation action: %', p_action;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_moderation_action(bigint, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_moderation_action(bigint, text, text, uuid) TO authenticated;
