// Solana Client Configuration

import {
  Connection,
  PublicKey,
  AccountInfo,
  Commitment,
} from '@solana/web3.js';
import { Buffer } from 'node:buffer';

// Configuration for the Solana client
interface SolanaClientConfig {
  rpcUrl?: string;
  wsUrl?: string;
  commitment?: Commitment;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  rateLimitRetryDelayMs?: number;
}

// Callback function type for program account updates: AccountInfo<Buffer>, pubkey, context?
export type ProgramAccountCallback = (
  accountInfo: AccountInfo<Buffer>,
  pubkey: PublicKey,
  context?: { slot: number }
) => void;

// Subscription metadata
interface Subscription {
  subscriptionId: number;
  programId: PublicKey; 
  callback: ProgramAccountCallback; 
  accountPubkeys?: Map<string, PublicKey>; // Track account pubkeys for this subscription
}

// Define the Solana client class
class SolanaClient {
  private _connection: Connection;
  private wsUrl: string; 
  private ws: WebSocket | null = null;
  private subscriptions: Map<number, Subscription> = new Map(); 
  private nextSubscriptionId: number = 1;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number;
  private reconnectDelayMs: number;
  private rateLimitRetryDelayMs: number;
  private isReconnecting: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SolanaClientConfig = {}) {
    // Get environment variables safely using a helper function
    const getEnvVar = (key: string, defaultValue: string): string => {
      try {
        // Access process.env safely for Node.js environments
        const env = (globalThis as any).process?.env;
        if (env && typeof env[key] === 'string') {
          return env[key];
        }
      } catch {
        // Ignore errors accessing process
      }
      return defaultValue;
    };

    const rpcUrl =
      config.rpcUrl ||
      getEnvVar('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
    const wsUrl =
      config.wsUrl ||
      getEnvVar('SOLANA_WS_URL', rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'));

    this.wsUrl = wsUrl;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 1000;
    this.rateLimitRetryDelayMs = config.rateLimitRetryDelayMs ?? 2000;

    this._connection = new Connection(rpcUrl, {
      commitment: config.commitment || 'confirmed',
      wsEndpoint: wsUrl,
    });

    this.connectWebSocket();
  }

  // Get the connection instance
  get connection(): Connection {
    return this._connection;
  }

  // Connect to the WebSocket endpoint
  private connectWebSocket(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.onopen = () => {
        console.log('[SolanaClient] WebSocket connected');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.resubscribeAll();
      };
      
      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };

      this.ws.onerror = (error) => {
        console.error('[SolanaClient] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.warn('[SolanaClient] WebSocket closed');
        this.ws = null;
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('[SolanaClient] Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming WebSocket messages
   * Solana RPC WebSocket format:
   * {
   *   "jsonrpc": "2.0",
   *   "method": "accountNotification" | "programNotification",
   *   "params": {
   *     "result": {
   *       "context": { "slot": number },
   *       "value": { ...accountInfo }
   *     },
   *     "subscription": number
   *   }
   * }
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);

      // Handle program account subscription notifications
      if (data.method === 'programNotification' && data.params) {
        const subscriptionId = data.params.subscription; 
        const result = data.params.result;
        
        // Get subscription by subscriptionId
        const subscription = this.subscriptions.get(subscriptionId); 
        if (subscription && result?.value) {
          // Extract account pubkey from the notification
          // For program subscriptions, the pubkey is in result.value.pubkey
          let pubkey: PublicKey;
          
          if (result.value.pubkey) {
            // Direct pubkey in the notification
            pubkey = new PublicKey(result.value.pubkey);
          } else if (result.value.account?.data) { // POSSIBLE BUG: 
            // Try to extract from account data structure
            // This is a fallback - the pubkey should be in the notification
            console.warn('[SolanaClient] Pubkey not found in notification, using program ID as fallback');
            pubkey = subscription.programId;
          } else {
            console.error('[SolanaClient] Cannot extract pubkey from notification:', result);
            return;
          }

          // Handle base64 encoded account data
          const accountData = result.value.account || result.value;
          let accountInfo: AccountInfo<Buffer>;
          
          if (accountData.data && Array.isArray(accountData.data)) {
            // Base64 encoded data
            const [dataBase64] = accountData.data;
            accountInfo = {
              lamports: accountData.lamports || 0,
              owner: new PublicKey(accountData.owner),
              executable: accountData.executable || false,
              data: Buffer.from(dataBase64, 'base64'),
            };
          } else {
            // Fallback: try to parse as-is
            console.warn('[SolanaClient] Unexpected account data format:', accountData);
            accountInfo = {
              lamports: 0,
              owner: subscription.programId,
              executable: false,
              data: Buffer.alloc(0),
            };
          }
          
          // Store context for slot information
          if (result.context?.slot && subscription.accountPubkeys) {
            subscription.accountPubkeys.set(pubkey.toString(), pubkey);
          }

          // Pass context with slot information
          const context = result.context ? { slot: result.context.slot } : undefined;
          subscription.callback(accountInfo, pubkey, context);
        }
      }
      // Handle account subscription notifications (fallback)
      else if (data.method === 'accountNotification' && data.params) {
        const subscriptionId = data.params.subscription;
        const result = data.params.result;

        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription && result?.value) {
          // For account subscriptions, we need to track the pubkey
          // Since we don't have it directly, we'll need to get it from the subscription
          // For now, use a workaround - this should be improved
          const accountData = result.value.account || result.value;
          let accountInfo: AccountInfo<Buffer>;
          
          if (accountData.data && Array.isArray(accountData.data)) {
            // Base64 encoded data
            const [dataBase64] = accountData.data;
            accountInfo = {
              lamports: accountData.lamports || 0,
              owner: new PublicKey(accountData.owner),
              executable: accountData.executable || false,
              data: Buffer.from(dataBase64, 'base64'),
            };
          } else {
            // Fallback
            accountInfo = {
              lamports: 0,
              owner: subscription.programId,
              executable: false,
              data: Buffer.alloc(0),
            };
          }
          
          // Try to get pubkey from stored mapping or use program ID as fallback
          let pubkey = subscription.programId;
          if (subscription.accountPubkeys && subscription.accountPubkeys.size > 0) {
            // Use first pubkey as fallback (not ideal, but works for single-account subscriptions)
            pubkey = Array.from(subscription.accountPubkeys.values())[0];
          }
          
          // Pass context with slot information
          const context = result.context ? { slot: result.context.slot } : undefined;
          subscription.callback(accountInfo, pubkey, context);
        }
      }
    } catch (error) {
      console.error('[SolanaClient] Error handling WebSocket message:', error);
    }
  }

  private scheduleReconnect(): void {
    // If already reconnecting or WebSocket is open, return to prevent multiple reconnect attempts
    if (this.isReconnecting || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    // Check if the maximum reconnection attempts have been reached
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        `[SolanaClient] Max reconnection attempts (${this.maxReconnectAttempts}) reached`
      );
      return;
    }

    // Set the reconnecting flag to true 
    this.isReconnecting = true;
    
    // Calculate the delay for the next reconnection attempt using exponential backoff 
    const delay = Math.min(
      this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    console.log(
      `[SolanaClient] Scheduling reconnect attempt ${this.reconnectAttempts + 1} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connectWebSocket();
    }, delay);
  }

  private async resubscribeAll(): Promise<void> {
    const subscriptions = Array.from(this.subscriptions.values());
    let successCount = 0;
    let failureCount = 0;
    const maxRetries = 3;
    const retryDelay = 1000;

    for (const sub of subscriptions) {
      let retries = 0;
      let success = false;

      while (retries < maxRetries && !success) {
        try {
          // Remove old subscription ID before resubscribing
          this.subscriptions.delete(sub.subscriptionId);
          
          await this.subscribeToProgramAccounts(
            sub.programId,
            sub.callback
          );
          success = true;
          successCount++;
        } catch (error) {
          retries++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(
            `[SolanaClient] Failed to resubscribe to program ${sub.programId.toString()} (attempt ${retries}/${maxRetries}):`,
            errorMessage
          );

          if (retries < maxRetries) {
            // Exponential backoff
            const delay = retryDelay * Math.pow(2, retries - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            failureCount++;
          }
        }
      }
    }

    if (failureCount > 0) {
      console.warn(
        `[SolanaClient] Resubscription complete: ${successCount} succeeded, ${failureCount} failed`
      );
    } else {
      console.log(
        `[SolanaClient] Successfully resubscribed to ${successCount} program(s)`
      );
    }
  }

  private async sendWebSocketRequest(
    method: string,
    params: any[]
  ): Promise<number> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    return new Promise((resolve, reject) => {
      const id = this.nextSubscriptionId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      // Timeout the request if it takes too long to complete
      const timeout = setTimeout(() => {
        reject(new Error(`WebSocket request timeout for method: ${method}`));
      }, 30000); // 30 second timeout

      const messageHandler = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.id === id) {
            clearTimeout(timeout);
            this.ws?.removeEventListener('message', messageHandler);

            if (response.error) {
              reject(new Error(response.error.message || 'WebSocket request failed'));
            } else {
              resolve(response.result);
            }
          }
        } catch (error) {
          // Not our response, continue waiting
        }
      };

      if (this.ws) {
        this.ws.addEventListener('message', messageHandler);
        this.ws.send(JSON.stringify(request));
      } else {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection lost'));
      }
    });
  }

  private async handleRateLimit<T>(
    operation: () => Promise<T>,
    retries: number = 3
  ): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        const isRateLimit =
          error?.message?.includes('429') ||
          error?.message?.toLowerCase().includes('rate limit') ||
          error?.code === 429;

        if (isRateLimit && attempt < retries - 1) {
          const delay = this.rateLimitRetryDelayMs * Math.pow(2, attempt);
          console.warn(
            `[SolanaClient] Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw new Error('Rate limit handling failed');
  }

  /**
   * Subscribe to program account changes
   * @param programId - The program ID to subscribe to
   * @param callback - Callback function called when account data changes
   * @returns Subscription ID that can be used to unsubscribe
   * @throws Error if WebSocket is not available or connection fails
   */
  async subscribeToProgramAccounts(
    programId: PublicKey,
    callback: ProgramAccountCallback
  ): Promise<number> {
    // WebSocket is required for real-time indexing
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `WebSocket is not available. Cannot subscribe to program ${programId.toString()}. ` +
        `WebSocket state: ${this.ws ? this.ws.readyState : 'null'}. ` +
        `Please ensure WebSocket connection is established before subscribing.`
      );
    }

    try {
      const subscriptionId = await this.sendWebSocketRequest(
        // Solana RPC WebSocket format:
        // {
        //   "jsonrpc": "2.0",
        //   "method": "programSubscribe",
        //   "params": [
        //     "programId",
        //     { "encoding": "base64", "commitment": "confirmed" }
        //   ]
        // }
        'programSubscribe',
        [
          programId.toBase58(),
          {
            encoding: 'base64',
            commitment: this._connection.commitment,
          },
        ]
      );

      this.subscriptions.set(subscriptionId, {
        subscriptionId,
        programId,
        callback,
        accountPubkeys: new Map(),
      });

      console.log(
        `[SolanaClient] Subscribed to program ${programId.toString()} with subscription ID: ${subscriptionId}`
      );

      return subscriptionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `[SolanaClient] Failed to subscribe to program ${programId.toString()}:`,
        errorMessage
      );
      // Re-throw the error instead of falling back to polling
      throw new Error(
        `Failed to subscribe to program ${programId.toString()}: ${errorMessage}`
      );
    }
  }


  async unsubscribe(subscriptionId: number): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      console.warn(
        `[SolanaClient] Subscription ${subscriptionId} not found`
      );
      return;
    }

    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        await this.sendWebSocketRequest('programUnsubscribe', [
          subscriptionId,
        ]);
      } else {
        console.warn(
          `[SolanaClient] WebSocket not available, removing subscription ${subscriptionId} from registry`
        );
      }

      this.subscriptions.delete(subscriptionId);
      console.log(
        `[SolanaClient] Unsubscribed from subscription ${subscriptionId}`
      );
    } catch (error) {
      console.error(
        `[SolanaClient] Failed to unsubscribe ${subscriptionId}:`,
        error
      );
      // Remove from map anyway
      this.subscriptions.delete(subscriptionId);
    }
  }

  /**
   * Fetch account data by public key
   * @param pubkey - The public key of the account
   * @returns Account data or null if account doesn't exist
   */
  async fetchAccountData(
    pubkey: PublicKey | string
  ): Promise<AccountInfo<Buffer> | null> {
    const publicKey =
      typeof pubkey === 'string' ? new PublicKey(pubkey) : pubkey;

    
    return await this.handleRateLimit(async () => {
      const accountInfo = await this._connection.getAccountInfo(
        publicKey,
        this._connection.commitment
      );

      return accountInfo;
    });
  }

  async disconnect(): Promise<void> {
    // Unsubscribe from all subscriptions
    const subscriptionIds = Array.from(this.subscriptions.keys());
    for (const id of subscriptionIds) {
      await this.unsubscribe(id);
    }

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    console.log('[SolanaClient] Disconnected');
  }
}

// Create singleton instance
let solanaClientInstance: SolanaClient | null = null;

/**
 * Get or create the Solana client instance
 */
export function getSolanaClient(config?: SolanaClientConfig): SolanaClient {
  if (!solanaClientInstance) {
    solanaClientInstance = new SolanaClient(config);
  }
  return solanaClientInstance;
}

export function initializeSolanaClient(
  config: SolanaClientConfig
): SolanaClient {
  if (solanaClientInstance) {
    solanaClientInstance.disconnect();
  }
  solanaClientInstance = new SolanaClient(config);
  return solanaClientInstance;
}

// Export the connection and main functions
export function getConnection(): Connection {
  return getSolanaClient().connection;
}

export const connection = getConnection();

export const subscribeToProgramAccounts = (
  programId: PublicKey,
  callback: ProgramAccountCallback
) => getSolanaClient().subscribeToProgramAccounts(programId, callback);

export const fetchAccountData = (pubkey: PublicKey | string) =>
  getSolanaClient().fetchAccountData(pubkey);

