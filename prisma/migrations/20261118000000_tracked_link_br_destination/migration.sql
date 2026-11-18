-- A campaign's primary tracked link can carry a second destination for the
-- Brazil store. The /r redirect sends visitors in Brazil there and everyone
-- else to destinationUrl. Existing links have no Brazil destination, so
-- nothing needs backfilling.

-- AlterTable
ALTER TABLE "TrackedLink" ADD COLUMN IF NOT EXISTS "destinationUrlBr" TEXT;
