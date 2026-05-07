CREATE TABLE "media_caches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"transcript_segments" jsonb DEFAULT '[]'::jsonb,
	"suggested_clips" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "media_caches_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE INDEX "media_caches_updated_idx" ON "media_caches" USING btree ("updated_at");