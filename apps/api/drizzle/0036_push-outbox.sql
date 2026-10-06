CREATE TABLE "push_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"send_after" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"drop_reason" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_outbox_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "push_outbox_kind" CHECK ("push_outbox"."kind" in ('pr', 'rank')),
	CONSTRAINT "push_outbox_status" CHECK ("push_outbox"."status" in ('pending', 'sending', 'sent', 'dropped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "push_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"device_token_id" uuid NOT NULL,
	"ticket_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_outbox_id_push_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."push_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_device_token_id_device_push_tokens_id_fk" FOREIGN KEY ("device_token_id") REFERENCES "public"."device_push_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_outbox_due_idx" ON "push_outbox" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "push_outbox_user_idx" ON "push_outbox" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_tickets_unchecked_idx" ON "push_tickets" USING btree ("receipt_checked_at","created_at");--> statement-breakpoint
CREATE INDEX "push_tickets_outbox_idx" ON "push_tickets" USING btree ("outbox_id");