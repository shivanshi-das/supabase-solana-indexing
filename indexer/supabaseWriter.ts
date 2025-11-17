// Supabase Database Writer
// This file should contain functions to write indexed data to Supabase
// Handles database insertions, updates, and batch operations
// Manages data transformation before writing to the database

import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './lib/supabaseClient.admin';
import {
  IndexedAccount,
  IndexedAccountInput,
  WriteResult,
  BatchWriteResult,
} from './lib/types';

export interface SupabaseWriterConfig {
  tableName?: string; // Database table name (default: 'indexed_accounts')
  batchSize?: number; // Maximum batch size for writes (default: 100)
  batchDelayMs?: number; // Delay between batches in ms (default: 100)
  maxRetries?: number; // Maximum retry attempts (default: 3)
  retryDelayMs?: number; // Initial retry delay in ms (default: 1000)
  maxRetryDelayMs?: number; // Maximum retry delay in ms (default: 30000)
}

export class SupabaseWriter {
  private client: SupabaseClient;
  private tableName: string;
  private batchSize: number;
  private batchDelayMs: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private maxRetryDelayMs: number;
  private pendingWrites: IndexedAccount[] = []; // Queue of accounts to be written
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing: boolean = false; // Flag to prevent concurrent flushes

  constructor(config: SupabaseWriterConfig = {}) {
    this.client = getSupabaseAdmin();
    this.tableName = config.tableName || 'indexed_accounts';
    this.batchSize = config.batchSize || 100;
    this.batchDelayMs = config.batchDelayMs || 100;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelayMs = config.retryDelayMs || 1000;
    this.maxRetryDelayMs = config.maxRetryDelayMs || 30000;
  }

  private transformToIndexedAccount(
    input: IndexedAccountInput
  ): IndexedAccount {
    return {
      pubkey: input.pubkey,
      slot: input.slot,
      parsed_account: input.parsed_account,
      updated_at: new Date().toISOString(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string = 'operation'
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on the last attempt
        if (attempt === this.maxRetries - 1) {
          break; 
        }

        // Calculate exponential backoff delay
        const delay = Math.min(
          this.retryDelayMs * Math.pow(2, attempt),
          this.maxRetryDelayMs
        );

        console.warn(
          `[SupabaseWriter] ${operationName} failed (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delay}ms:`,
          lastError.message
        );

        await this.sleep(delay);
      }
    }

    throw lastError || new Error(`${operationName} failed after ${this.maxRetries} attempts`);
  }

  private async executeBatchUpsert(
    accounts: IndexedAccount[]
  ): Promise<WriteResult[]> {
    if (accounts.length === 0) {
      return [];
    }

    return await this.retryWithBackoff(async () => {
      const { error, data } = await this.client
        .from(this.tableName)
        .upsert(accounts, {
          onConflict: 'pubkey',
          ignoreDuplicates: false,
        })
        .select('pubkey');

      if (error) {
        throw new Error(
          `Batch upsert failed: ${error.message} (code: ${error.code})`
        );
      }

      // Return successful results
      const successfulPubkeys = new Set(
        (data || []).map((row: { pubkey: string }) => row.pubkey)
      );

      return accounts.map((account) => ({
        success: successfulPubkeys.has(account.pubkey),
        pubkey: account.pubkey,
        error: successfulPubkeys.has(account.pubkey)
          ? undefined
          : 'Upsert did not return the account',
      }));
    }, `batch upsert (${accounts.length} accounts)`);
  }

  private async flushPendingWrites(): Promise<WriteResult[]> {
    if (this.pendingWrites.length === 0 || this.isFlushing) {
      return [];
    }

    this.isFlushing = true;
    const writesToProcess = [...this.pendingWrites];
    this.pendingWrites = [];

    try {
      // Process in batches of batchSize
      const results: WriteResult[] = [];

      for (let i = 0; i < writesToProcess.length; i += this.batchSize) { // Process in batches of batchSize
        const batch = writesToProcess.slice(i, i + this.batchSize);
        const batchResults = await this.executeBatchUpsert(batch); 
        results.push(...batchResults);  // Results (success/failure) for each account in the batch

        // Small delay between batches to avoid overwhelming the database
        if (i + this.batchSize < writesToProcess.length) {
          await this.sleep(this.batchDelayMs); 
        }
      }

      return results;
    } finally {
      this.isFlushing = false;
    }
  }

  private scheduleBatchFlush(): void {
    if (this.batchTimer || this.isFlushing) {
      return;
    }

    // Flush when batch size is reached
    if (this.pendingWrites.length >= this.batchSize) {
      this.flushPendingWrites().catch((error) => {
        console.error('[SupabaseWriter] Error in scheduled flush:', error);
      });
      return;
    }

    // Schedule flush after a delay
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushPendingWrites().catch((error) => {
        console.error('[SupabaseWriter] Error in scheduled flush:', error);
      });
    }, this.batchDelayMs);
  }

  /**
   * Write a single indexed account (queued for batch processing)
   * @param input - Account data to write
   * @returns Promise that resolves when the account is queued
   */
  async write(input: IndexedAccountInput): Promise<void> {
    const indexedAccount = this.transformToIndexedAccount(input);
    this.pendingWrites.push(indexedAccount);
    this.scheduleBatchFlush();
  }

  /**
   * Write multiple indexed accounts (queued for batch processing)
   * @param inputs - Array of account data to write
   * @returns Promise that resolves when all accounts are queued
   */
  async writeMany(inputs: IndexedAccountInput[]): Promise<void> {
    const indexedAccounts = inputs.map((input) =>
      this.transformToIndexedAccount(input)
    );
    this.pendingWrites.push(...indexedAccounts);
    this.scheduleBatchFlush();
  }

  /**
   * Immediately write a single account (bypasses batching)
   * @param input - Account data to write
   * @returns Write result
   */
  async writeImmediate(input: IndexedAccountInput): Promise<WriteResult> {
    const indexedAccount = this.transformToIndexedAccount(input);
    const results = await this.executeBatchUpsert([indexedAccount]); // Execute the batch upsert immediately
    return results[0] || {
      success: false,
      pubkey: input.pubkey,
      error: 'No result returned from upsert',
    };
  }

  /**
   * Immediately write multiple accounts (bypasses batching)
   * @param inputs - Array of account data to write
   * @returns Batch write result
   */
  async writeManyImmediate(
    inputs: IndexedAccountInput[]
  ): Promise<BatchWriteResult> {
    const indexedAccounts = inputs.map((input) =>
      this.transformToIndexedAccount(input)
    );

    const results = await this.executeBatchUpsert(indexedAccounts);

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      successful,
      failed,
      results,
    };
  }

  /**
   * Flush all pending writes immediately
   * @returns Batch write result
   */
  async flush(): Promise<BatchWriteResult> {
    // Clear any pending timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const results = await this.flushPendingWrites();

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      successful,
      failed,
      results,
    };
  }

  getPendingCount(): number {
    return this.pendingWrites.length;
  }


  isFlushingPending(): boolean {
    return this.isFlushing;
  }
}

// Singleton instance
let writerInstance: SupabaseWriter | null = null;

export function getSupabaseWriter(
  config?: SupabaseWriterConfig
): SupabaseWriter {
  if (!writerInstance) {
    writerInstance = new SupabaseWriter(config);
  }
  return writerInstance;
}

export function createSupabaseWriter(
  config?: SupabaseWriterConfig
): SupabaseWriter {
  return new SupabaseWriter(config);
}

// Convenience functions using singleton
export async function writeIndexedAccount(
  input: IndexedAccountInput
): Promise<void> {
  return getSupabaseWriter().write(input);
}

export async function writeIndexedAccounts(
  inputs: IndexedAccountInput[]
): Promise<void> {
  return getSupabaseWriter().writeMany(inputs);
}

export async function writeIndexedAccountImmediate(
  input: IndexedAccountInput
): Promise<WriteResult> {
  return getSupabaseWriter().writeImmediate(input);
}

export async function writeIndexedAccountsImmediate(
  inputs: IndexedAccountInput[]
): Promise<BatchWriteResult> {
  return getSupabaseWriter().writeManyImmediate(inputs);
}

export async function flushIndexedAccounts(): Promise<BatchWriteResult> {
  return getSupabaseWriter().flush();
}

