-- Database Indexes Migration
-- This file creates performance indexes for the indexed_accounts table
-- Indexes improve query performance for common access patterns

-- Index on pubkey for fast lookups by account public key
-- Used for: WHERE pubkey = '...' queries and upsert operations
CREATE INDEX IF NOT EXISTS idx_indexed_accounts_pubkey 
ON indexed_accounts(pubkey);

-- Index on slot (DESC) for efficient sorting by most recent slots
-- Used for: ORDER BY slot DESC queries to get latest account updates
CREATE INDEX IF NOT EXISTS idx_indexed_accounts_slot 
ON indexed_accounts(slot DESC);

-- Index on updated_at (DESC) for efficient sorting by most recently updated records
-- Used for: ORDER BY updated_at DESC queries in the frontend
CREATE INDEX IF NOT EXISTS idx_indexed_accounts_updated_at 
ON indexed_accounts(updated_at DESC);

-- Add comments for documentation
COMMENT ON INDEX idx_indexed_accounts_pubkey IS 'Index on pubkey for fast account lookups';
COMMENT ON INDEX idx_indexed_accounts_slot IS 'Index on slot (DESC) for sorting by most recent blockchain state';
COMMENT ON INDEX idx_indexed_accounts_updated_at IS 'Index on updated_at (DESC) for sorting by most recently updated records';

