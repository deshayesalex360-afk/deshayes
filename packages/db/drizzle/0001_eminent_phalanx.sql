CREATE INDEX "exports_video_created_idx" ON "exports" USING btree ("video_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_video_created_idx" ON "jobs" USING btree ("video_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clips_video_score_idx" ON "suggested_clips" USING btree ("video_id","score");--> statement-breakpoint
CREATE INDEX "segments_video_start_idx" ON "transcript_segments" USING btree ("video_id","start_ms");--> statement-breakpoint
CREATE INDEX "videos_user_created_idx" ON "videos" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "videos_status_idx" ON "videos" USING btree ("status");