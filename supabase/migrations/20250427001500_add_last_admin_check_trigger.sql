-- Migration: Add trigger to prevent removing the last admin

-- Function to check if the operation removes the last admin of a non-deleted organization
CREATE OR REPLACE FUNCTION check_last_admin()
RETURNS TRIGGER AS $$
DECLARE
    v_organization_id UUID;
    v_is_admin_being_removed BOOLEAN;
    v_other_admin_count INTEGER;
BEGIN
    -- Determine the organization ID from either OLD or NEW record
    IF TG_OP = 'DELETE' THEN
        v_organization_id := OLD.organization_id;
    ELSE -- TG_OP = 'UPDATE'
        v_organization_id := NEW.organization_id; -- Could also use OLD.organization_id
    END IF;

    -- Check if the organization is already deleted; if so, allow changes
    IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_organization_id AND deleted_at IS NOT NULL) THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Check if an admin is being demoted or removed (status changing from 'active' or role changing from 'admin')
    v_is_admin_being_removed := (
        TG_OP = 'DELETE' AND OLD.role = 'admin' AND OLD.status = 'active'
    ) OR (
        TG_OP = 'UPDATE' AND
        OLD.role = 'admin' AND OLD.status = 'active' AND
        (NEW.role <> 'admin' OR NEW.status <> 'active')
    );

    -- If an admin is not being removed/demoted, allow the operation
    IF NOT v_is_admin_being_removed THEN
         IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- If an admin is being removed/demoted, count other active admins in the non-deleted organization
    SELECT count(*)
    INTO v_other_admin_count
    FROM public.organization_members om
    JOIN public.organizations o ON om.organization_id = o.id
    WHERE om.organization_id = v_organization_id
      AND om.role = 'admin'
      AND om.status = 'active'
      AND o.deleted_at IS NULL
      AND om.id <> OLD.id; -- Exclude the member being updated/deleted

    -- If removing/demoting this admin leaves no other admins, raise an error
    IF v_other_admin_count = 0 THEN
        RAISE EXCEPTION 'Cannot remove or demote the last admin of organization %', v_organization_id;
    END IF;

    -- Otherwise, allow the operation
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission (usually inherited, but explicit grant is safe)
-- GRANT EXECUTE ON FUNCTION check_last_admin() TO authenticated; -- Might not be needed if called by trigger only

-- Trigger to execute the check before update or delete
-- Drop existing trigger if it exists to avoid errors during development/re-runs
DROP TRIGGER IF EXISTS before_member_update_delete_check_last_admin ON public.organization_members;

CREATE TRIGGER before_member_update_delete_check_last_admin
BEFORE UPDATE OR DELETE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION check_last_admin(); 