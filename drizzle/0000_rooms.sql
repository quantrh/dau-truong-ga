CREATE TABLE `rooms` (
  `code` text PRIMARY KEY NOT NULL,
  `status` text DEFAULT 'waiting' NOT NULL,
  `match_id` text NOT NULL,
  `peer_key` text NOT NULL,
  `host_hash` text NOT NULL,
  `host_name` text NOT NULL,
  `host_ready` integer DEFAULT 0 NOT NULL,
  `host_seen` integer NOT NULL,
  `host_seq` integer DEFAULT 0 NOT NULL,
  `host_payload` text DEFAULT '{}' NOT NULL,
  `guest_hash` text,
  `guest_name` text,
  `guest_ready` integer DEFAULT 0 NOT NULL,
  `guest_seen` integer,
  `guest_seq` integer DEFAULT 0 NOT NULL,
  `guest_payload` text DEFAULT '{}' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  CHECK (`status` IN ('waiting', 'playing', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_host_hash_unique` ON `rooms` (`host_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_guest_hash_unique` ON `rooms` (`guest_hash`);
--> statement-breakpoint
CREATE INDEX `rooms_expires_at_index` ON `rooms` (`expires_at`);
