CREATE TABLE "usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"month_key" varchar(7) NOT NULL,
	"uploads_count" integer DEFAULT 0 NOT NULL,
	"videos_created_count" integer DEFAULT 0 NOT NULL,
	"suggest_count" integer DEFAULT 0 NOT NULL,
	"export_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_user_month_idx" ON "usage_counters" USING btree ("user_id","month_key");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_user_month_unique" ON "usage_counters" USING btree ("user_id","month_key");