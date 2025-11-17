// Indexer Utility Functions
// Helper functions used across the indexer
// Includes common utilities for data processing, validation, formatting

/**
 * Safely parse JSON with error handling
 */
export function safeJsonParse<T = unknown>(
  json: string,
  fallback: T | null = null
): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        const delay = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate a Solana public key string
 */
export function isValidPublicKey(pubkey: string): boolean {
  try {
    // Basic validation: base58 string, 32-44 characters
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pubkey)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Truncate a public key for display
 */
export function truncatePubkey(
  pubkey: string,
  start: number = 4,
  end: number = 4
): string {
  if (pubkey.length <= start + end) {
    return pubkey;
  }
  return `${pubkey.slice(0, start)}...${pubkey.slice(-end)}`;
}

/**
 * Format a number with commas
 */
export function formatNumber(num: number | bigint | string): string {
  try {
    const numValue = typeof num === 'string' ? BigInt(num) : num;
    return numValue.toLocaleString('en-US');
  } catch {
    return String(num);
  }
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get environment variable with fallback
 */
export function getEnvVar(key: string, defaultValue: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any).process?.env;
    if (env && typeof env[key] === 'string') {
      return env[key];
    }
  } catch {
    // Ignore errors
  }
  return defaultValue;
}

/**
 * Validate required environment variables
 */
export function validateEnvVars(required: string[]): void {
  const missing: string[] = [];
  
  for (const key of required) {
    const value = getEnvVar(key, '');
    if (!value) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}
