import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import type { StoreApp } from "./model";
import type { AppleSnapshot, GoogleSnapshot } from "./apple-sync-model";
const timestamp = (name: string) =>
  text(name)
    .notNull()
    .$defaultFn(() => new Date().toISOString());
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  apps: text("apps", { mode: "json" })
    .$type<StoreApp[]>()
    .notNull()
    .default([]),
  updatedAt: timestamp("updated_at"),
});
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: timestamp("created_at"),
});
export type Verification = {
  status: string;
  revision: number;
  jobId: string;
  message: string;
  [key: string]: unknown;
};
export const connectionConfigs = sqliteTable("connection_configs", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  app_id: text("app_id"),
  fields: text("fields", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  secret: text("secret").notNull(),
  revision: integer("revision").notNull().default(1),
  verification: text("verification", { mode: "json" }).$type<Verification>(),
  updated_at: timestamp("updated_at"),
});
export type ImageResult = {
  url: string;
  width: number;
  height: number;
  bytes: number;
};
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    app_id: text("app_id").notNull(),
    platform: text("platform").notNull(),
    kind: text("kind", {
      enum: [
        "generate_image",
        "verify_connection",
        "pull_apple",
        "pull_google",
        "validate_draft",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "uncertain"],
    })
      .notNull()
      .default("queued"),
    input: text("input", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
    created_at: timestamp("created_at"),
    updated_at: timestamp("updated_at"),
  },
  (table) => [index("jobs_status_created").on(table.status, table.created_at)],
);
export type Job = typeof jobs.$inferSelect;
export const jobLogs = sqliteTable("job_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  job_id: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  step: text("step").notNull(),
  message: text("message").notNull(),
  created_at: timestamp("created_at"),
});
export const storeSnapshots = sqliteTable("store_snapshots", {
  app_id: text("app_id").primaryKey(),
  config_revision: integer("config_revision").notNull(),
  current_snapshot: text("current_snapshot", { mode: "json" })
    .$type<AppleSnapshot>()
    .notNull(),
  updated_at: timestamp("updated_at"),
});

export const googleSnapshots = sqliteTable("google_snapshots", {
  app_id: text("app_id").primaryKey(),
  config_revision: integer("config_revision").notNull(),
  current_snapshot: text("current_snapshot", { mode: "json" })
    .$type<GoogleSnapshot>()
    .notNull(),
  updated_at: timestamp("updated_at"),
});
