// Indexer Entry Point
// Run this file to start the Solana indexer service
// Usage: pnpm run build && pnpm start
// Or: npx ts-node index.ts

import { startIndexer, setupGracefulShutdown } from './indexer';

// Get environment variables
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const process = (globalThis as any).process;
const programId = process?.env?.SOLANA_PROGRAM_ID || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

async function main() {
  console.log('Starting Solana Indexer...');
  console.log(`Program ID: ${programId}`);

  try {
    const indexer = await startIndexer({
      programId,
      logLevel: 'info',
      restartDelayMs: 5000,
      maxRestartAttempts: Infinity,
      enableAutoRestart: true,
    });

    // Setup graceful shutdown
    setupGracefulShutdown(indexer);

    // Log statistics periodically
    const statsInterval = setInterval(() => {
      const stats = indexer.getStats();
      console.log('\n=== Indexer Statistics ===');
      console.log(`Accounts Processed: ${stats.accountsProcessed}`);
      console.log(`Accounts Written: ${stats.accountsWritten}`);
      console.log(`Accounts Failed: ${stats.accountsFailed}`);
      console.log(`Errors: ${stats.errors}`);
      console.log(`Is Running: ${stats.isRunning}`);
      if (stats.startTime) {
        const uptime = Math.round((Date.now() - stats.startTime.getTime()) / 1000);
        console.log(`Uptime: ${uptime}s`);
      }
      console.log('========================\n');
    }, 60000); // Every minute

    // Cleanup interval on shutdown
    if (process) {
      process.on('SIGINT', () => clearInterval(statsInterval));
      process.on('SIGTERM', () => clearInterval(statsInterval));
    }
  } catch (error) {
    console.error('Failed to start indexer:', error);
    if (process) {
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  if (process) {
    process.exit(1);
  }
});

