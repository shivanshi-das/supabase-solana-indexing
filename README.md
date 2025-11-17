# Solana + Supabase Indexing Template

A production-ready template for indexing Solana blockchain data into Supabase with real-time synchronization. This template provides a complete solution for monitoring Solana program accounts, decoding their data, and making it queryable through a modern web interface.

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Running the Indexer](#running-the-indexer)
- [Running the Next.js App](#running-the-nextjs-app)
- [How Real-Time Sync Works](#how-real-time-sync-works)
- [Best Practices](#best-practices)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Resources](#resources)

## Project Overview

This template enables you to:

- **Index Solana Program Accounts**: Subscribe to program account changes on the Solana blockchain
- **Decode Account Data**: Transform raw blockchain data into structured JSON
- **Store in Supabase**: Persist indexed data with automatic upserts
- **Real-Time Updates**: View live updates in your Next.js application without page refreshes
- **Production Ready**: Includes error handling, retry logic, batching, and graceful shutdown

### Key Features

- Automatic WebSocket reconnection for Solana subscriptions
- Rate limit handling with exponential backoff
- Batch database writes for optimal performance
- Real-time Supabase subscriptions for live UI updates
- Type-safe TypeScript throughout
- Extensible decoder system for multiple program types
- Comprehensive error handling and logging

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Solana Blockchain                        │
│                    (Program Account Changes)                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ WebSocket/RPC Subscription
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Indexer Service                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Solana       │  │ Decoder      │  │ Supabase     │         │
│  │ Client       │→ │ (SPL Token,  │→ │ Writer       │         │
│  │ (RPC+WS)     │  │ Custom...)   │  │ (Batched)    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│         │                  │                  │                 │
│         └──────────────────┴──────────────────┘                 │
│                            │                                    │
│                            │ Upsert (pubkey)                    │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Supabase Database                           │
│                  (indexed_accounts table)                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ pubkey (PK) │ slot │ parsed_account │ updated_at        │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Realtime Subscription
                             │ (INSERT/UPDATE/DELETE)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js Application                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  AccountTable Component                                   │  │
│  │  - Fetches initial data                                   │  │
│  │  - Subscribes to realtime changes                        │  │
│  │  - Updates UI automatically                              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Indexer** subscribes to Solana program account changes via WebSocket/RPC
2. On each account update, the **Decoder** transforms raw data into structured JSON
3. The **Supabase Writer** batches and upserts data to the database
4. The **Next.js App** subscribes to Supabase realtime changes
5. UI updates automatically when new data arrives

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 18+ and pnpm
- **Supabase Account** ([sign up here](https://supabase.com))
- **Solana RPC Endpoint** (use public endpoints or services like [Helius](https://helius.dev), [QuickNode](https://quicknode.com), or [Alchemy](https://alchemy.com))
- **TypeScript** knowledge (the project is fully typed)

## Getting Started

### 1. Clone and Install

```bash
# Clone the repository
git clone <your-repo-url>
cd solana-supabase-indexing

# Install dependencies
pnpm install
```

### 2. Create a Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click **"New Project"**
3. Fill in your project details:
   - **Name**: Your project name
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Choose closest to your users
4. Wait for the project to be provisioned (~2 minutes)

### 3. Get Your Supabase Credentials

In your Supabase project dashboard:

1. Go to **Settings** → **API**
2. Copy the following:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)
   - **service_role key** (starts with `eyJ...`) - ⚠️ Keep this secret!

### 4. Configure Environment Variables

Create a `.env.local` file in the root directory for the Next.js app (frontend):

```env
# Supabase Configuration (Frontend - uses anon key)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Create a `.env` file in the `indexer` directory for the indexer service (backend):

```env
# Supabase Configuration (Indexer - uses service role key)
SUPABASE_URL=https://xxxxx.supabase.co
# OR use NEXT_PUBLIC_SUPABASE_URL as fallback:
# NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Solana Configuration (optional - defaults to mainnet public RPC)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com

# Program to index (optional - defaults to SPL Token Program)
SOLANA_PROGRAM_ID=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
```

> **Security Note**: 
> - Never commit `.env.local` or `.env` to version control
> - The `service_role` key has admin privileges - only use in server-side code
> - Frontend uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe for browser)
> - Indexer uses `SUPABASE_SERVICE_ROLE_KEY` (server-side only)

### 5. Apply Database Migrations

The template includes SQL migrations to set up the database schema:

```bash
# Option 1: Using Supabase CLI (recommended)
npx supabase db push

# Option 2: Manual application via Supabase Dashboard
# 1. Go to SQL Editor in Supabase Dashboard
# 2. Copy contents of supabase/migrations/001_init.sql
# 3. Run the SQL
# 4. Repeat for 002_indexes.sql
```

**Migration Files:**
- `supabase/migrations/001_init.sql` - Creates the `indexed_accounts` table
- `supabase/migrations/002_indexes.sql` - Adds performance indexes

**Expected Schema:**

```sql
CREATE TABLE indexed_accounts (
  pubkey TEXT PRIMARY KEY,
  slot BIGINT NOT NULL,
  parsed_account JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_indexed_accounts_slot ON indexed_accounts(slot);
CREATE INDEX idx_indexed_accounts_updated_at ON indexed_accounts(updated_at DESC);
```

### 6. Enable Realtime (Important!)

For real-time updates to work:

1. Go to **Database** → **Replication** in Supabase Dashboard
2. Enable replication for the `indexed_accounts` table
3. Or run this SQL:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE indexed_accounts;
```

## ⚙️ Configuration

### Indexer Configuration

The indexer can be configured when creating an instance:

```typescript
import { startIndexer } from './indexer/indexer';

const indexer = await startIndexer({
  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'
  restartDelayMs: 5000,
  maxRestartAttempts: Infinity,
  enableAutoRestart: true,
});
```

### Supabase Writer Configuration

Configure batching and retry behavior:

```typescript
import { createSupabaseWriter } from './indexer/supabaseWriter';

const writer = createSupabaseWriter({
  tableName: 'indexed_accounts',
  batchSize: 100, // Batch size for writes
  batchDelayMs: 100, // Delay between batches
  maxRetries: 3, // Retry attempts
  retryDelayMs: 1000, // Initial retry delay
  maxRetryDelayMs: 30000, // Max retry delay
});
```

## Running the Indexer

### Development Mode

Create an `indexer.ts` or `indexer.js` file in the root:

```typescript
import { startIndexer, setupGracefulShutdown } from './indexer/indexer';

async function main() {
  const indexer = await startIndexer({
    programId: process.env.SOLANA_PROGRAM_ID || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    logLevel: 'info',
  });

  // Setup graceful shutdown
  setupGracefulShutdown(indexer);

  // Log statistics periodically
  setInterval(() => {
    const stats = indexer.getStats();
    console.log('Stats:', {
      processed: stats.accountsProcessed,
      written: stats.accountsWritten,
      failed: stats.accountsFailed,
      errors: stats.errors,
    });
  }, 60000); // Every minute
}

main().catch(console.error);
```

Run with:

```bash
# Using ts-node
npx ts-node indexer.ts

# Or compile first
pnpm run build
pnpm start
```

### Production Deployment

For production, consider:

- **PM2**: Process manager with auto-restart
- **Docker**: Containerized deployment
- **Systemd**: Linux service management

**Example PM2 Configuration (`ecosystem.config.js`):**

```javascript
module.exports = {
  apps: [{
    name: 'solana-indexer',
    script: 'dist/indexer.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
```

## Running the Next.js App

### Development

```bash
pnpm dev
```

Visit `http://localhost:3000` to see your application.

### Production Build

```bash
# Build the application
pnpm run build

# Start production server
pnpm start
```

### Using the AccountTable Component

In your `app/page.tsx`:

```tsx
import AccountTable from '@/app/(components)/AccountTable';

export default function Home() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Solana Indexed Accounts</h1>
      <AccountTable 
        limit={100}
        orderBy="updated_at"
        orderDirection="desc"
      />
    </main>
  );
}
```

## How Real-Time Sync Works

The real-time synchronization works in two layers:

### 1. Solana → Indexer → Supabase

```
Solana Program Account Change
    ↓ (WebSocket notification)
Indexer receives update
    ↓ (Fetch account data)
Decoder transforms to JSON
    ↓ (Batch write)
Supabase upsert (onConflict: pubkey)
```

### 2. Supabase → Next.js UI

```
Supabase Database Change (INSERT/UPDATE/DELETE)
    ↓ (PostgreSQL Replication)
Supabase Realtime Service
    ↓ (WebSocket to client)
Next.js Component (useRealtimeSubscription)
    ↓ (State update)
UI re-renders automatically
```

**Key Points:**

- **No Polling**: Uses WebSocket connections for instant updates
- **Efficient**: Only sends changed data, not full table scans
- **Reliable**: Automatic reconnection on connection loss
- **Scalable**: Supabase handles connection management

## Best Practices

### Indexing Best Practices

1. **Choose the Right RPC Endpoint**
   - Use dedicated RPC providers for production (Helius, QuickNode, Alchemy)
   - Public RPCs have rate limits and may be unreliable
   - Consider WebSocket endpoints for better performance

2. **Optimize Batch Sizes**
   - Larger batches = fewer database calls but more memory
   - Recommended: 50-200 accounts per batch
   - Monitor database connection pool usage

3. **Handle Rate Limits**
   - The indexer includes automatic retry with exponential backoff
   - Monitor error logs for rate limit issues
   - Consider rate limit headers from your RPC provider

4. **Monitor Indexer Health**
   - Track statistics: `accountsProcessed`, `accountsWritten`, `errors`
   - Set up alerts for high error rates
   - Log slot progression to detect stalls

5. **Database Optimization**
   - Index frequently queried columns (`slot`, `updated_at`)
   - Use `JSONB` for `parsed_account` (indexed JSON in PostgreSQL)
   - Consider partitioning by date if storing large amounts of historical data

6. **Error Handling**
   - Don't stop indexing on individual account failures
   - Log errors for debugging but continue processing
   - Set up monitoring/alerting for persistent failures

### Security Best Practices

1. **Environment Variables**
   - Never commit `.env.local` to version control
   - Use different keys for development/production
   - Rotate `service_role` key periodically

2. **Row Level Security (RLS)**
   - Enable RLS on `indexed_accounts` table for production
   - Use `anon` key for client-side queries
   - Only use `service_role` key in server-side indexer

3. **Network Security**
   - Use HTTPS/WSS for all connections
   - Validate RPC endpoint certificates
   - Consider VPN or private networking for production

### Performance Tips

1. **Database Connection Pooling**
   - Supabase handles this automatically
   - Monitor connection usage in dashboard

2. **Caching**
   - Consider caching frequently accessed accounts
   - Use Supabase's built-in caching for queries

3. **Query Optimization**
   - Use indexes for filtered queries
   - Limit result sets with `LIMIT`
   - Use `SELECT` specific columns when possible

## Project Structure

```
solana-supabase-indexing/
├── app/                          # Next.js app directory
│   ├── (components)/            # React components
│   │   └── AccountTable.tsx    # Main account display component
│   ├── (queries)/               # Data fetching logic
│   ├── (realtime)/              # Realtime subscription hooks
│   └── page.tsx                 # Home page
│
├── indexer/                      # Indexer service
│   ├── indexer.ts               # Main indexer orchestration
│   ├── solanaClient.ts          # Solana RPC + WebSocket client
│   ├── decoder.ts               # Account data decoder
│   ├── supabaseWriter.ts        # Database writer with batching
│   └── utils.ts                 # Utility functions
│
├── lib/                          # Shared libraries
│   ├── supabaseClient.ts        # Supabase client setup
│   └── types.ts                 # TypeScript type definitions
│
├── supabase/                     # Database migrations
│   ├── migrations/
│   │   ├── 001_init.sql        # Initial schema
│   │   └── 002_indexes.sql     # Performance indexes
│   └── schema.md                # Schema documentation
│
└── README.md                     # This file
```

## Troubleshooting

### Indexer Not Starting

**Problem**: Indexer fails to start with "SUPABASE_SERVICE_ROLE_KEY not found"

**Solution**: Ensure `.env.local` exists and contains `SUPABASE_SERVICE_ROLE_KEY`

### No Real-Time Updates

**Problem**: UI doesn't update when indexer writes data

**Solutions**:
1. Check Realtime is enabled in Supabase Dashboard (Database → Replication)
2. Verify you're using `NEXT_PUBLIC_SUPABASE_ANON_KEY` (not service_role) in the app
3. Check browser console for WebSocket connection errors
4. Ensure RLS policies allow SELECT if enabled

### High Error Rate

**Problem**: Many accounts failing to decode

**Solutions**:
1. Verify decoder is registered for your program ID
2. Check account data format matches decoder expectations
3. Review error logs for specific failure reasons
4. Consider adding custom decoder for your program

### Rate Limit Errors

**Problem**: Frequent 429 errors from Solana RPC

**Solutions**:
1. Use a dedicated RPC provider with higher limits
2. Increase `rateLimitRetryDelayMs` in Solana client config
3. Reduce indexing frequency if possible
4. Contact RPC provider to increase rate limits

### Database Connection Issues

**Problem**: Writer fails to connect to Supabase

**Solutions**:
1. Verify `NEXT_PUBLIC_SUPABASE_URL` is correct
2. Check `SUPABASE_SERVICE_ROLE_KEY` is valid
3. Ensure Supabase project is active (not paused)
4. Check network/firewall allows connections to Supabase

## Resources

### Solana Documentation

- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Solana Program Library (SPL)](https://spl.solana.com/)
- [Solana Cookbook](https://solanacookbook.com/)
- [Solana RPC API Reference](https://docs.solana.com/api/http)

### Supabase Documentation

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Realtime Guide](https://supabase.com/docs/guides/realtime)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
- [PostgreSQL JSONB Guide](https://www.postgresql.org/docs/current/datatype-json.html)

### RPC Providers

- [Helius](https://helius.dev) - Solana RPC with enhanced APIs
- [QuickNode](https://quicknode.com) - Multi-chain RPC infrastructure
- [Alchemy](https://alchemy.com) - Web3 development platform
- [Triton](https://triton.one) - Solana RPC and data services

### Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[Add your license here]

## Acknowledgments

- Built with [Solana Web3.js](https://github.com/solana-labs/solana-web3.js)
- Powered by [Supabase](https://supabase.com)
- UI built with [Next.js](https://nextjs.org) and [Tailwind CSS](https://tailwindcss.com)

---

**Need Help?** Open an issue or check the [Troubleshooting](#troubleshooting) section above.

