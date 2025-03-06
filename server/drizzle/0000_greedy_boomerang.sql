CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"install_time" timestamp NOT NULL,
	"visited_domains_count" bigint NOT NULL,
	"blocked_domains_count" bigint NOT NULL,
	"allow_domains_count" bigint NOT NULL
);
