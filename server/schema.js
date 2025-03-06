import { pgTable, timestamp, uuid, bigint } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid().primaryKey().notNull(),
  install_time: timestamp({ mode: "string" }).notNull(),
  visited_domains_count: bigint({ mode: "number" }).notNull(),
  blocked_domains_count: bigint({ mode: "number" }).notNull(),
  allow_domains_count: bigint({ mode: "number" }).notNull(),
});
