-- Conversation participants are never deleted by the Messaging API. The parent
-- conversation/organization cascades may delete them during tenant teardown;
-- therefore the deferred cardinality invariant applies to INSERT/UPDATE only.
DROP TRIGGER IF EXISTS "conversation_organization_participants_exactly_two_guard" ON "conversation_organization_participants";
CREATE CONSTRAINT TRIGGER "conversation_organization_participants_exactly_two_guard"
AFTER INSERT OR UPDATE ON "conversation_organization_participants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "messaging_conversation_organization_count_guard"();
