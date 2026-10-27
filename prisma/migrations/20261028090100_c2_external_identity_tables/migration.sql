CREATE TYPE "ExternalIdentityStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "external_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "issuer" VARCHAR(2048) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "status" "ExternalIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "verified_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "revoked_by_user_id" UUID,
    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "external_identities_issuer_ascii_url_check" CHECK (
        octet_length("issuer") = char_length("issuer")
        AND "issuer" LIKE 'https://%'
        AND substring("issuer" FROM 9) <> ''
        AND substring("issuer" FROM 9) !~ '^[/?#]'
        AND "issuer" !~ '[[:space:][:cntrl:]]'
        AND position('?' IN "issuer") = 0
        AND position('#' IN "issuer") = 0
    ),
    CONSTRAINT "external_identities_issuer_octet_length_check" CHECK (octet_length("issuer") <= 2048),
    CONSTRAINT "external_identities_subject_ascii_check" CHECK (
        "subject" <> '' AND octet_length("subject") = char_length("subject")
    ),
    CONSTRAINT "external_identities_subject_octet_length_check" CHECK (octet_length("subject") <= 255),
    CONSTRAINT "external_identities_status_revocation_check" CHECK (
        ("status" = 'ACTIVE' AND "revoked_at" IS NULL AND "revoked_by_user_id" IS NULL)
        OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_by_user_id" IS NOT NULL)
    ),
    CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_identities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_identities_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "external_identities_issuer_subject_key" ON "external_identities"("issuer", "subject");
CREATE UNIQUE INDEX "external_identities_id_user_id_key" ON "external_identities"("id", "user_id");
CREATE INDEX "external_identities_user_id_status_idx" ON "external_identities"("user_id", "status");
CREATE UNIQUE INDEX "refresh_sessions_id_user_id_key" ON "refresh_sessions"("id", "user_id");

CREATE TABLE "external_identity_link_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "state_hash" CHAR(64) NOT NULL,
    "nonce_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "external_identity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_identity_link_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "external_identity_link_challenges_state_hash_format_check" CHECK ("state_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "external_identity_link_challenges_nonce_hash_format_check" CHECK ("nonce_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "external_identity_link_challenges_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "external_identity_link_challenges_consumption_check" CHECK (("consumed_at" IS NULL) = ("external_identity_id" IS NULL)),
    CONSTRAINT "external_identity_link_challenges_session_user_fkey" FOREIGN KEY ("session_id", "user_id") REFERENCES "refresh_sessions"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "external_identity_link_challenges_identity_user_fkey" FOREIGN KEY ("external_identity_id", "user_id") REFERENCES "external_identities"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "external_identity_link_challenges_state_hash_key" ON "external_identity_link_challenges"("state_hash");
CREATE UNIQUE INDEX "external_identity_link_challenges_nonce_hash_key" ON "external_identity_link_challenges"("nonce_hash");
CREATE INDEX "external_identity_link_challenges_expires_at_consumed_at_idx" ON "external_identity_link_challenges"("expires_at", "consumed_at");

CREATE FUNCTION "protect_external_identity_ownership"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'external identity tombstones cannot be deleted' USING ERRCODE = '23514';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
        OR NEW."issuer" IS DISTINCT FROM OLD."issuer"
        OR NEW."subject" IS DISTINCT FROM OLD."subject"
        OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'external identity ownership fields are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW."status" = OLD."status" THEN
        IF NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
            OR NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at"
            OR NEW."revoked_by_user_id" IS DISTINCT FROM OLD."revoked_by_user_id" THEN
            RAISE EXCEPTION 'external identity state fields require a status transition' USING ERRCODE = '23514';
        END IF;
    ELSIF OLD."status" = 'ACTIVE' AND NEW."status" = 'REVOKED' THEN
        IF NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
            OR NEW."revoked_at" IS NULL OR NEW."revoked_by_user_id" IS NULL THEN
            RAISE EXCEPTION 'invalid external identity revocation transition' USING ERRCODE = '23514';
        END IF;
    ELSIF OLD."status" = 'REVOKED' AND NEW."status" = 'ACTIVE' THEN
        IF NEW."revoked_at" IS NOT NULL OR NEW."revoked_by_user_id" IS NOT NULL
            OR NEW."verified_at" < OLD."revoked_at" THEN
            RAISE EXCEPTION 'invalid external identity reactivation transition' USING ERRCODE = '23514';
        END IF;
    ELSE
        RAISE EXCEPTION 'unsupported external identity status transition' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "external_identities_ownership_immutable"
BEFORE UPDATE OR DELETE ON "external_identities"
FOR EACH ROW EXECUTE FUNCTION "protect_external_identity_ownership"();

CREATE FUNCTION "protect_external_identity_link_challenge"() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
        OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
        OR NEW."state_hash" IS DISTINCT FROM OLD."state_hash"
        OR NEW."nonce_hash" IS DISTINCT FROM OLD."nonce_hash"
        OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'external identity link challenge proof is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."consumed_at" IS NOT NULL AND (
        NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at"
        OR NEW."external_identity_id" IS DISTINCT FROM OLD."external_identity_id"
    ) THEN
        RAISE EXCEPTION 'consumed external identity link challenge is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."consumed_at" IS NULL AND NEW."consumed_at" IS NOT NULL AND NEW."external_identity_id" IS NULL THEN
        RAISE EXCEPTION 'challenge consumption requires a linked identity' USING ERRCODE = '23514';
    END IF;
    IF OLD."consumed_at" IS NULL AND NEW."consumed_at" IS NOT NULL
        AND (NEW."consumed_at" < OLD."created_at" OR NEW."consumed_at" > OLD."expires_at") THEN
        RAISE EXCEPTION 'challenge consumption must occur within its validity window' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "external_identity_link_challenges_proof_immutable"
BEFORE UPDATE ON "external_identity_link_challenges"
FOR EACH ROW EXECUTE FUNCTION "protect_external_identity_link_challenge"();
