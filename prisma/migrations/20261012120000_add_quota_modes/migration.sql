CREATE TYPE "QuotaMode" AS ENUM ('CAPACITY', 'PERIODIC');

ALTER TABLE "plan_version_quotas"
  ADD COLUMN "mode" "QuotaMode" NOT NULL DEFAULT 'CAPACITY';

ALTER TABLE "plan_version_quotas"
  ALTER COLUMN "mode" SET DEFAULT 'PERIODIC';
