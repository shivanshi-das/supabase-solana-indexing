// TypeScript Type Definitions
// This file should contain shared TypeScript types and interfaces
// Includes types for Solana data structures, Supabase schema types
// Shared types used across the indexer

import { PublicKey } from '@solana/web3.js';

/**
 * Decoded SPL Token Account data
 */
export interface SPLTokenAccount {
  owner: string; // PublicKey as base58 string
  mint: string; // PublicKey as base58 string
  amount: string; // Amount as string to handle large numbers
  delegate: string | null; // PublicKey as base58 string, or null if no delegate
  isFrozen: boolean;
}

/**
 * Base interface for decoded account data
 * All program-specific decoders should extend this
 */
export interface DecodedAccount {
  programId: string; // The program that owns this account
  accountType: string; // Type identifier for the account (e.g., 'spl-token-account')
}

/**
 * SPL Token Account with base interface
 */
export interface DecodedSPLTokenAccount extends DecodedAccount, SPLTokenAccount {
  programId: string;
  accountType: 'spl-token-account';
}

/**
 * Generic decoded account result
 * Can be extended with union types for different account types
 */
export type DecodedAccountData = DecodedSPLTokenAccount; // Add more types here as union

/**
 * Indexed account data structure for database storage
 */
export interface IndexedAccount {
  pubkey: string; // PublicKey as base58 string (primary key)
  slot: number; // Solana slot number
  parsed_account: DecodedAccountData; // Parsed account JSON data
  updated_at: string; // ISO 8601 timestamp
}

/**
 * Input data for writing an indexed account
 */
export interface IndexedAccountInput {
  pubkey: string; // PublicKey as base58 string
  slot: number; // Solana slot number
  parsed_account: DecodedAccountData; // Parsed account JSON data
}

/**
 * Result of a write operation
 */
export interface WriteResult {
  success: boolean;
  pubkey: string;
  error?: string;
}

/**
 * Batch write result
 */
export interface BatchWriteResult {
  successful: number;
  failed: number;
  results: WriteResult[];
}

