// Main Indexer Logic
// This file should contain the core indexing orchestration logic
// Coordinates between Solana client, decoder, and Supabase writer
// Handles indexing loops, error handling, and state management
// May include retry logic and checkpointing for resumable indexing

// Load environment variables from .env file (for indexer)
import * as dotenv from 'dotenv';
dotenv.config();

import { PublicKey, AccountInfo } from '@solana/web3.js';
import {
  subscribeToProgramAccounts,
  getConnection,
  getSolanaClient,
} from './solanaClient';
import { decodeAccount } from './decoder';
import {
  writeIndexedAccount,
  flushIndexedAccounts,
} from './supabaseWriter';
import { IndexedAccountInput } from './lib/types';

// Process type declaration for Node.js environments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

/**
 * Configuration for the indexer
 */
export interface IndexerConfig {
  programId: string; // Program ID to index (base58 string)
  restartDelayMs?: number; // Delay before restarting on failure (default: 5000)
  maxRestartAttempts?: number; // Maximum restart attempts (default: Infinity)
  logLevel?: 'debug' | 'info' | 'warn' | 'error'; // Logging level
  enableAutoRestart?: boolean; // Enable automatic restart on failure (default: true)
}

/**
 * Indexer statistics
 */
export interface IndexerStats {
  accountsProcessed: number;
  accountsWritten: number;
  accountsFailed: number;
  errors: number;
  startTime: Date | null;
  lastProcessedTime: Date | null;
  isRunning: boolean;
}

/**
 * Main indexer class that orchestrates the indexing process
 */
export class Indexer {
  private programId: PublicKey;
  private config: Required<Omit<IndexerConfig, 'programId'>>;
  private subscriptionId: number | null = null;
  private stats: IndexerStats;
  private isRunning: boolean = false;
  private restartAttempts: number = 0;
  private shouldStop: boolean = false;

  constructor(config: IndexerConfig) {
    // Validate SERVICE_ROLE_KEY is available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serviceRoleKey = (globalThis as any).process?.env?.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY environment variable is required for the indexer. ' +
        'Please set it in your .env.local file.'
      );
    }

    this.programId = new PublicKey(config.programId);
    this.config = {
      restartDelayMs: config.restartDelayMs ?? 5000,
      maxRestartAttempts: config.maxRestartAttempts ?? Infinity,
      logLevel: config.logLevel ?? 'info',
      enableAutoRestart: config.enableAutoRestart ?? true,
    };

    this.stats = {
      accountsProcessed: 0,
      accountsWritten: 0,
      accountsFailed: 0,
      errors: 0,
      startTime: null,
      lastProcessedTime: null,
      isRunning: false,
    };
  }

  /**
   * Log message with level filtering
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const messageLevel = levels.indexOf(level);

    if (messageLevel >= configLevel) {
      const timestamp = new Date().toISOString();
      const prefix = `[Indexer:${level.toUpperCase()}] [${timestamp}]`;
      console[level](prefix, message, ...args);
    }
  }

  /**
   * Process a single account update
   */
  private async processAccountUpdate(
    accountInfo: AccountInfo<Buffer>,
    pubkey: PublicKey,
    context?: { slot: number }
  ): Promise<void> {
    try {
      this.stats.accountsProcessed++;
      this.stats.lastProcessedTime = new Date();

      const pubkeyStr = pubkey.toString();
      this.log('debug', `Processing account update: ${pubkeyStr}`);

      // Use slot from context if available, otherwise fetch current slot
      let slot: number;
      if (context?.slot) {
        slot = context.slot;
      } else {
        // Fallback: get current slot
        const connection = getConnection();
        slot = await connection.getSlot('confirmed');
        this.log('debug', `Using current slot ${slot} (context not provided)`);
      }

      // Use provided accountInfo or fetch if needed
      let accountData = accountInfo;
      if (!accountData || !accountData.data) {
        const connection = getConnection();
        const fetched = await connection.getAccountInfo(pubkey, 'confirmed');
        if (!fetched) {
          this.log('warn', `Account ${pubkeyStr} not found, skipping`);
          this.stats.accountsFailed++;
          return;
        }
        accountData = fetched;
      }

      // Decode the account data
      const decoded = decodeAccount(accountData.data, accountData.owner);

      if (!decoded) {
        this.log(
          'warn',
          `Failed to decode account ${pubkeyStr} for program ${accountData.owner.toString()}`
        );
        this.stats.accountsFailed++;
        return;
      }

      // Prepare indexed account input
      const indexedAccount: IndexedAccountInput = {
        pubkey: pubkeyStr,
        slot,
        parsed_account: decoded,
      };

      // Write to Supabase
      await writeIndexedAccount(indexedAccount);
      this.stats.accountsWritten++;

      this.log(
        'debug',
        `Successfully indexed account ${pubkeyStr} (slot: ${slot}, type: ${decoded.accountType})`
      );
    } catch (error) {
      this.stats.errors++;
      this.stats.accountsFailed++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `Error processing account ${pubkey.toString()}:`, errorMessage);

      // Don't throw - continue processing other accounts
    }
  }

  /**
   * Start the indexer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log('warn', 'Indexer is already running');
      return;
    }

    this.shouldStop = false;
    this.isRunning = true;
    this.stats.isRunning = true;
    this.stats.startTime = new Date();
    this.restartAttempts = 0;

    this.log('info', `Starting indexer for program: ${this.programId.toString()}`);

    try {
      await this.subscribe();
    } catch (error) {
      this.log('error', 'Failed to start indexer:', error);
      this.isRunning = false;
      this.stats.isRunning = false;
      throw error;
    }
  }

  /**
   * Subscribe to program account changes
   */
  private async subscribe(): Promise<void> {
    try {
      this.log('info', 'Subscribing to program account changes...');

      // Create callback handler
      const handleAccountUpdate = async (
        accountInfo: AccountInfo<Buffer>,
        pubkey: PublicKey,
        context?: { slot: number }
      ) => {
        if (this.shouldStop) {
          return;
        }

        // Process account update asynchronously
        this.processAccountUpdate(accountInfo, pubkey, context).catch((error) => {
          this.stats.errors++;
          this.log('error', 'Unhandled error in account update handler:', error);
        });
      };

      // Subscribe to program accounts
      this.subscriptionId = await subscribeToProgramAccounts(
        this.programId,
        handleAccountUpdate
      );

      this.log(
        'info',
        `Successfully subscribed to program ${this.programId.toString()} (subscription ID: ${this.subscriptionId})`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `Failed to subscribe: ${errorMessage}`);

      if (this.config.enableAutoRestart && !this.shouldStop) {
        await this.handleRestart(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle restart on failure
   */
  private async handleRestart(error: unknown): Promise<void> {
    if (this.shouldStop) {
      return;
    }

    this.restartAttempts++;

    if (this.restartAttempts > this.config.maxRestartAttempts) {
      this.log(
        'error',
        `Max restart attempts (${this.config.maxRestartAttempts}) reached. Stopping indexer.`
      );
      this.isRunning = false;
      this.stats.isRunning = false;
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    this.log(
      'warn',
      `Indexer error occurred. Restarting in ${this.config.restartDelayMs}ms (attempt ${this.restartAttempts}/${this.config.maxRestartAttempts}):`,
      errorMessage
    );

    // Cleanup current subscription
    await this.cleanup();

    // Wait before restarting
    await new Promise((resolve) => setTimeout(resolve, this.config.restartDelayMs));

    if (!this.shouldStop) {
      try {
        await this.subscribe();
        this.restartAttempts = 0; // Reset on successful restart
        this.log('info', 'Indexer restarted successfully');
      } catch (restartError) {
        // Will be handled by recursive call if auto-restart is enabled
        if (this.config.enableAutoRestart) {
          await this.handleRestart(restartError);
        }
      }
    }
  }

  /**
   * Stop the indexer
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.log('warn', 'Indexer is not running');
      return;
    }

    this.log('info', 'Stopping indexer...');
    this.shouldStop = true;
    this.isRunning = false;
    this.stats.isRunning = false;

    // Flush any pending writes
    try {
      this.log('info', 'Flushing pending writes to database...');
      const flushResult = await flushIndexedAccounts();
      this.log(
        'info',
        `Flush complete: ${flushResult.successful} successful, ${flushResult.failed} failed`
      );
    } catch (error) {
      this.log('error', 'Error flushing writes:', error);
    }

    await this.cleanup();
    this.log('info', 'Indexer stopped');
  }

  /**
   * Cleanup subscriptions and connections
   */
  private async cleanup(): Promise<void> {
    if (this.subscriptionId !== null) {
      try {
        const client = getSolanaClient();
        await client.unsubscribe(this.subscriptionId);
        this.log('debug', `Unsubscribed from subscription ${this.subscriptionId}`);
      } catch (error) {
        this.log('warn', `Error unsubscribing: ${error}`);
      }
      this.subscriptionId = null;
    }
  }

  /**
   * Get current indexer statistics
   */
  getStats(): IndexerStats {
    return { ...this.stats };
  }

  /**
   * Check if indexer is running
   */
  isIndexerRunning(): boolean {
    return this.isRunning;
  }
}

/**
 * Create and start an indexer instance
 * 
 * @example
 * ```ts
 * const indexer = await startIndexer({
 *   programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 *   logLevel: 'info',
 * });
 * 
 * // Later, stop the indexer
 * await indexer.stop();
 * ```
 */
export async function startIndexer(config: IndexerConfig): Promise<Indexer> {
  const indexer = new Indexer(config);
  await indexer.start();
  return indexer;
}

/**
 * Graceful shutdown handler
 */
export function setupGracefulShutdown(indexer: Indexer): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeProcess = (globalThis as any).process;
  if (!nodeProcess) {
    console.warn('[Indexer] Process object not available, graceful shutdown not set up');
    return;
  }

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    try {
      await indexer.stop();
      const stats = indexer.getStats();
      console.log('\n=== Indexer Statistics ===');
      console.log(`Accounts Processed: ${stats.accountsProcessed}`);
      console.log(`Accounts Written: ${stats.accountsWritten}`);
      console.log(`Accounts Failed: ${stats.accountsFailed}`);
      console.log(`Errors: ${stats.errors}`);
      console.log(`Uptime: ${stats.startTime ? Math.round((Date.now() - stats.startTime.getTime()) / 1000) : 0}s`);
      nodeProcess.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      nodeProcess.exit(1);
    }
  };

  nodeProcess.on('SIGINT', () => shutdown('SIGINT'));
  nodeProcess.on('SIGTERM', () => shutdown('SIGTERM'));
}

