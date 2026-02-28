-- ============================================================
-- Phase 2: Auth UX bootstrap (profiles + self role introspection)
-- ============================================================
-- Goals:
-- - Ensure every authenticated user has a profile row.
-- - Provide authenticated helpers for self-profile bootstrap and role lookup.
-- - Add baseline self-access RLS policies for profiles.
-- ============================================================

-- ------------------------------------------------------------
-- Auto-provision profile on auth user creation
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_display_name text;
BEGIN
    v_display_name := COALESCE(
        new.raw_user_meta_data ->> 'display_name',
        new.raw_user_meta_data ->> 'name',
        NULLIF(split_part(COALESCE(new.email, ''), '@', 1), '')
    );

    INSERT INTO public.profiles (id, display_name)
    VALUES (new.id, v_display_name)
    ON CONFLICT (id) DO NOTHING;

    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profiles ON auth.users;
CREATE TRIGGER on_auth_user_created_profiles
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_profile();

-- ------------------------------------------------------------
-- Ensure profile exists for authenticated caller
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_profile_for_current_user()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text;
    v_display_name text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT
        u.email,
        COALESCE(
            u.raw_user_meta_data ->> 'display_name',
            u.raw_user_meta_data ->> 'name',
            NULLIF(split_part(COALESCE(u.email, ''), '@', 1), '')
        )
    INTO v_email, v_display_name
    FROM auth.users u
    WHERE u.id = v_uid;

    INSERT INTO public.profiles (id, display_name)
    VALUES (v_uid, v_display_name)
    ON CONFLICT (id) DO UPDATE
    SET
        display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
        updated_at = now();

    RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_profile_for_current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_profile_for_current_user() TO authenticated;

-- ------------------------------------------------------------
-- Get current authenticated user's role keys
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_roles()
RETURNS TABLE (role_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT r.key
    FROM public.user_role_assignments ura
    JOIN public.roles r ON r.id = ura.role_id
    WHERE ura.user_id = auth.uid()
    ORDER BY r.key ASC;
$$;

REVOKE ALL ON FUNCTION public.current_user_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_roles() TO authenticated;

-- ------------------------------------------------------------
-- Profile RLS: authenticated user can manage only their own profile
-- ------------------------------------------------------------
DROP POLICY IF EXISTS profile_self_read ON public.profiles;
CREATE POLICY profile_self_read
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());

DROP POLICY IF EXISTS profile_self_insert ON public.profiles;
CREATE POLICY profile_self_insert
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profile_self_update ON public.profiles;
CREATE POLICY profile_self_update
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());
