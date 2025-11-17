-- Initial Database Schema Migration
-- This file creates the main table for storing decoded Solana account data
-- The table supports real-time updates via Supabase Realtime

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the indexed_accounts table
-- This table stores decoded Solana program account data indexed by the indexer service
CREATE TABLE IF NOT EXISTS indexed_accounts (
  -- Solana account public key (base58 encoded string)
  -- This is the primary key and unique identifier for the Solana account
  pubkey TEXT PRIMARY KEY,
  
  -- Solana slot number when the account was last updated
  -- Used for ordering and tracking blockchain state
  slot BIGINT NOT NULL,
  
  -- Decoded account data stored as JSONB for efficient querying
  -- Contains structured data decoded from raw Solana account bytes
  parsed_account JSONB NOT NULL,
  
  -- Timestamp when this record was last updated in the database
  -- Automatically set to current timestamp on insert/update
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable REPLICA IDENTITY FULL for Supabase Realtime
-- This allows realtime to send the full row data on UPDATE/DELETE events
ALTER TABLE indexed_accounts REPLICA IDENTITY FULL;

-- Add comment to table for documentation
COMMENT ON TABLE indexed_accounts IS 'Stores decoded Solana program account data indexed from the blockchain';
COMMENT ON COLUMN indexed_accounts.pubkey IS 'Solana account public key (base58 encoded)';
COMMENT ON COLUMN indexed_accounts.slot IS 'Solana slot number when account was last updated';
COMMENT ON COLUMN indexed_accounts.parsed_account IS 'Decoded account data as JSONB';
COMMENT ON COLUMN indexed_accounts.updated_at IS 'Timestamp when record was last updated in database';

