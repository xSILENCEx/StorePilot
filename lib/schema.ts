import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import type { StoreApp } from "./model";
export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  apps: jsonb("apps").$type<StoreApp[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull(),
  platform: text("platform").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"),
  input: jsonb("input").notNull(),
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const connectionConfigs = pgTable("connection_configs", {
  id: text("id").primaryKey(),
  verification: jsonb("verification"),
  scope: text("scope").notNull(),
  appId: text("app_id"),
  fields: jsonb("fields").notNull(),
  secret: text("secret").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const screenshotGroups = pgTable("screenshot_groups", {
  id: uuid("id").primaryKey(),
  appId: text("app_id").notNull(),
  platform: text("platform").notNull(),
  locale: text("locale").notNull(),
  device: text("device").notNull(),
  settings: jsonb("settings").notNull(),
  adopted: jsonb("adopted").notNull().default([]),
  previous: jsonb("previous").notNull().default([]),
  hasPrevious: boolean("has_previous").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const imageCandidates = pgTable("image_candidates", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => screenshotGroups.id),
  jobId: text("job_id").references(() => jobs.id),
  requestId: uuid("request_id"),
  status: text("status").notNull().default("queued"),
  settings: jsonb("settings").notNull(),
  origin: text("origin").notNull(),
  url: text("url"),
  thumbnail: text("thumbnail"),
  rawUrl: text("raw_url"),
  error: text("error"),
  discarded: boolean("discarded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const imageCalls = pgTable("image_calls", {
  candidateId: uuid("candidate_id")
    .primaryKey()
    .references(() => imageCandidates.id),
  status: text("status").notNull(),
  configRevision: integer("config_revision").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
