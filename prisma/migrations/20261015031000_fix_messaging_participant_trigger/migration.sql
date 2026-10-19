-- Fix the deferred guard variable name so PostgreSQL cannot confuse it with the column.
CREATE OR REPLACE FUNCTION "messaging_conversation_organization_count_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  v_conversation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."conversation_id" ELSE NEW."conversation_id" END;
  IF (SELECT COUNT(*) FROM "conversation_organization_participants" cop WHERE cop."conversation_id" = v_conversation_id) <> 2 THEN
    RAISE EXCEPTION 'messaging_conversation_requires_two_organizations' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;
