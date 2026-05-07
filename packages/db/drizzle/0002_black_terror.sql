CREATE TYPE "public"."user_plan" AS ENUM('FREE', 'PRO', 'SCALE');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" "user_plan" DEFAULT 'FREE' NOT NULL;