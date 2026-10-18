CREATE OR REPLACE FUNCTION "messaging_message_insert_invariants"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conversation_record RECORD;
  organization_participant_count INTEGER;
  user_participant_count INTEGER;
BEGIN
  SELECT "organization_low_id", "organization_high_id"
  INTO conversation_record
  FROM "conversations"
  WHERE "id" = NEW."conversation_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_invariant: conversation does not exist' USING ERRCODE = 'P0001';
  END IF;

  IF NEW."source_organization_id" <> conversation_record."organization_low_id"
     AND NEW."source_organization_id" <> conversation_record."organization_high_id" THEN
    RAISE EXCEPTION 'message_invariant: source organization is not a conversation organization' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)
  INTO organization_participant_count
  FROM "conversation_organization_participants"
  WHERE "conversation_id" = NEW."conversation_id"
    AND "organization_id" = NEW."source_organization_id"
    AND "status" = 'ACTIVE'::"MessagingParticipantStatus"
    AND "joined_at" IS NOT NULL;

  IF organization_participant_count <> 1 THEN
    RAISE EXCEPTION 'message_invariant: source organization is not an active participant' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)
  INTO user_participant_count
  FROM "conversation_user_participants" AS cup
  INNER JOIN "memberships" AS membership
    ON membership."organization_id" = cup."organization_id"
   AND membership."user_id" = cup."user_id"
  INNER JOIN "users" AS author
    ON author."id" = cup."user_id"
  WHERE cup."conversation_id" = NEW."conversation_id"
    AND cup."organization_id" = NEW."source_organization_id"
    AND cup."user_id" = NEW."author_user_id"
    AND cup."status" = 'ACTIVE'::"MessagingParticipantStatus"
    AND cup."joined_at" IS NOT NULL
    AND membership."status" = 'ACTIVE'::"MembershipStatus"
    AND author."status" = 'ACTIVE'::"UserStatus";

  IF user_participant_count <> 1 THEN
    RAISE EXCEPTION 'message_invariant: author is not an active member participant of the source organization' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "messages_insert_invariants"
BEFORE INSERT ON "messages"
FOR EACH ROW EXECUTE FUNCTION "messaging_message_insert_invariants"();
