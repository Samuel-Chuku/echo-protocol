import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { config } from '../config';

// `max: 10` is plenty for a single-process indexer; Neon's free tier pooler caps far higher.
const client = postgres(config.databaseUrl, { max: 10 });

export const db = drizzle(client, { schema });

/**
 * Create tables on first boot (idempotent). DDL mirrors schema.ts column-for-column so we don't need
 * a separate `drizzle-kit push` to get running — the database is migrated in-process on startup.
 */
export async function migrate(): Promise<void> {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS cursor (
      id TEXT PRIMARY KEY, last_block INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      block_number INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
      address TEXT NOT NULL, event_name TEXT NOT NULL, market_id INTEGER, actor TEXT,
      args TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS events_unique ON events(block_number, tx_hash, log_index);
    CREATE INDEX IF NOT EXISTS events_actor ON events(actor);
    CREATE INDEX IF NOT EXISTS events_market ON events(market_id);
    CREATE TABLE IF NOT EXISTS markets (
      id INTEGER PRIMARY KEY, mode INTEGER NOT NULL, requester TEXT NOT NULL,
      requester_agent_id TEXT, worker TEXT, subject TEXT, description TEXT, metadata_uri TEXT,
      scope_hash TEXT, tiers TEXT, escrow_total TEXT, reveal_fee TEXT, flag_window INTEGER,
      stake_required TEXT, default_award TEXT, pool TEXT, review_window INTEGER, ghost_deadline INTEGER,
      status TEXT NOT NULL DEFAULT 'active', applicant_count INTEGER NOT NULL DEFAULT 0,
      created_at_block INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS markets_requester ON markets(requester);
    CREATE INDEX IF NOT EXISTS markets_mode_status ON markets(mode, status);
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, market_id INTEGER NOT NULL, participant TEXT NOT NULL, agent_id TEXT,
      tier_reached INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'applied',
      receipt_id TEXT, submission_hash TEXT, created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS applications_participant ON applications(participant);
    CREATE INDEX IF NOT EXISTS applications_market ON applications(market_id);
    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY, market_id INTEGER NOT NULL, idx INTEGER NOT NULL, submitter TEXT NOT NULL,
      submitter_agent_id TEXT, finding_hash TEXT, status INTEGER NOT NULL DEFAULT 0, award TEXT,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS findings_market ON findings(market_id);
    CREATE INDEX IF NOT EXISTS findings_submitter ON findings(submitter);
    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY, market_id INTEGER NOT NULL, idx INTEGER NOT NULL, amount TEXT,
      status INTEGER NOT NULL DEFAULT 0, deliverable_hash TEXT, submitted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS milestones_market ON milestones(market_id);
    CREATE TABLE IF NOT EXISTS reveal_holds (
      id TEXT PRIMARY KEY, market_id INTEGER NOT NULL, participant TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 1, revealed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS reputation (
      address TEXT PRIMARY KEY, agent_id TEXT,
      jobs_completed INTEGER NOT NULL DEFAULT 0,
      total_earned TEXT NOT NULL DEFAULT '0',
      tier_sum INTEGER NOT NULL DEFAULT 0,
      ghost_count INTEGER NOT NULL DEFAULT 0,
      total_slashed TEXT NOT NULL DEFAULT '0',
      r_rep_slashes INTEGER NOT NULL DEFAULT 0,
      last_event_block INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS reputation_agent_id ON reputation(agent_id);
    CREATE TABLE IF NOT EXISTS disputes (
      id INTEGER PRIMARY KEY, subject INTEGER NOT NULL, market_id INTEGER, target INTEGER,
      participant TEXT, opener TEXT, counter TEXT, bond TEXT, status INTEGER NOT NULL DEFAULT 0,
      for_opener INTEGER NOT NULL DEFAULT 0, against INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Additive column migrations for DBs created before a column existed. Postgres supports IF NOT
  // EXISTS on ADD COLUMN, so no guard needed; new rows backfill, old rows get NULL until re-index.
  await client.unsafe(`ALTER TABLE markets ADD COLUMN IF NOT EXISTS ghost_deadline INTEGER`);
}

export { schema };
