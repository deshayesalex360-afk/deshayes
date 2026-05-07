CREATE TABLE "request_idempotencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"route_key" varchar(128) NOT NULL,
	"idem_key" varchar(255) NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb,
	"status_code" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "request_idempotencies" ADD CONSTRAINT "request_idempotencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idem_user_route_key_unique" ON "request_idempotencies" USING btree ("user_id","route_key","idem_key");