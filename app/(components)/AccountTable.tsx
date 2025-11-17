'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseClient.browser';
import { IndexedAccount } from '@/lib/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Props for the AccountTable component
 */
interface AccountTableProps {
  limit?: number; // Maximum number of accounts to display (default: 100)
  orderBy?: 'slot' | 'updated_at'; // Column to order by (default: 'updated_at')
  orderDirection?: 'asc' | 'desc'; // Sort direction (default: 'desc')
}

/**
 * Custom hook to fetch initial indexed accounts
 */
function useIndexedAccounts(
  limit: number = 100,
  orderBy: 'slot' | 'updated_at' = 'updated_at',
  orderDirection: 'asc' | 'desc' = 'desc'
) {
  const [accounts, setAccounts] = useState<IndexedAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const supabase = getSupabaseBrowser();
      const { data, error: fetchError } = await supabase
        .from('indexed_accounts')
        .select('*')
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .limit(limit);

      if (fetchError) {
        throw fetchError;
      }

      setAccounts((data as IndexedAccount[]) || []);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch accounts';
      setError(errorMessage);
      console.error('[AccountTable] Error fetching accounts:', err);
    } finally {
      setLoading(false);
    }
  }, [limit, orderBy, orderDirection]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return { accounts, loading, error, refetch: fetchAccounts };
}

/**
 * Custom hook to subscribe to realtime changes
 */
function useRealtimeSubscription(
  onInsert: (account: IndexedAccount) => void,
  onUpdate: (account: IndexedAccount) => void,
  onDelete: (pubkey: string) => void
) {
  useEffect(() => {
    // Subscribe to realtime changes
    const supabase = getSupabaseBrowser();
    const realtimeChannel = supabase
      .channel('indexed_accounts_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'indexed_accounts',
        },
        (payload) => {
          const newAccount = payload.new as IndexedAccount;
          onInsert(newAccount);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'indexed_accounts',
        },
        (payload) => {
          const updatedAccount = payload.new as IndexedAccount;
          onUpdate(updatedAccount);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'indexed_accounts',
        },
        (payload) => {
          const deletedPubkey = (payload.old as { pubkey: string }).pubkey;
          onDelete(deletedPubkey);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[AccountTable] Realtime subscription active');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[AccountTable] Realtime subscription error');
        }
      });

    // Cleanup subscription on unmount
    return () => {
      realtimeChannel.unsubscribe().then(() => {
        getSupabaseBrowser().removeChannel(realtimeChannel);
      });
    };
  }, [onInsert, onUpdate, onDelete]);
}

/**
 * Format a timestamp to a readable date string
 */
function formatDate(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

/**
 * Format a large number (like token amount) with commas
 */
function formatAmount(amount: string): string {
  try {
    const num = BigInt(amount);
    return num.toLocaleString('en-US');
  } catch {
    return amount;
  }
}

/**
 * Truncate a public key for display
 */
function truncatePubkey(pubkey: string, start: number = 4, end: number = 4): string {
  if (pubkey.length <= start + end) {
    return pubkey;
  }
  return `${pubkey.slice(0, start)}...${pubkey.slice(-end)}`;
}

/**
 * AccountTable component that displays indexed accounts with realtime updates
 */
export default function AccountTable({
  limit = 100,
  orderBy = 'updated_at',
  orderDirection = 'desc',
}: AccountTableProps) {
  const { accounts: initialAccounts, loading, error, refetch } = useIndexedAccounts(
    limit,
    orderBy,
    orderDirection
  );

  // Local state that gets updated by realtime subscriptions
  const [accounts, setAccounts] = useState<IndexedAccount[]>(initialAccounts);

  // Sync local state with fetched accounts
  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);

  // Handle realtime insert
  const handleInsert = useCallback(
    (newAccount: IndexedAccount) => {
      // Add new account to the beginning of the list
      // and remove the last one if we exceed the limit
      setAccounts((prev) => {
        // Check if account already exists (avoid duplicates)
        if (prev.some((acc) => acc.pubkey === newAccount.pubkey)) {
          return prev;
        }
        const updated = [newAccount, ...prev];
        return updated.slice(0, limit);
      });
    },
    [limit]
  );

  // Handle realtime update
  const handleUpdate = useCallback((updatedAccount: IndexedAccount) => {
    setAccounts((prev) => {
      const existingIndex = prev.findIndex(
        (account) => account.pubkey === updatedAccount.pubkey
      );
      if (existingIndex === -1) {
        // If account doesn't exist, add it to the beginning
        return [updatedAccount, ...prev].slice(0, limit);
      }
      // Update existing account
      return prev.map((account) =>
        account.pubkey === updatedAccount.pubkey ? updatedAccount : account
      );
    });
  }, [limit]);

  // Handle realtime delete
  const handleDelete = useCallback((deletedPubkey: string) => {
    setAccounts((prev) => prev.filter((account) => account.pubkey !== deletedPubkey));
  }, []);

  // Memoize callbacks to prevent subscription recreation
  const memoizedHandleInsert = useCallback(handleInsert, [limit]);
  const memoizedHandleUpdate = useCallback(handleUpdate, [limit]);
  const memoizedHandleDelete = useCallback(handleDelete, []);

  // Set up realtime subscription
  useRealtimeSubscription(memoizedHandleInsert, memoizedHandleUpdate, memoizedHandleDelete);

  // Extract amount from parsed_account
  const getAmount = (account: IndexedAccount): string => {
    if (
      account.parsed_account &&
      account.parsed_account.accountType === 'spl-token-account' &&
      'amount' in account.parsed_account
    ) {
      return account.parsed_account.amount;
    }
    return 'N/A';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading accounts...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-red-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error loading accounts</h3>
            <p className="mt-1 text-sm text-red-700">{error}</p>
            <button
              onClick={refetch}
              className="mt-2 text-sm font-medium text-red-800 hover:text-red-900 underline"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-8 text-center">
        <p className="text-gray-600">No accounts found</p>
        <p className="mt-2 text-sm text-gray-500">
          Accounts will appear here once the indexer starts processing them.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Indexed Accounts</h2>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <span className="w-2 h-2 bg-green-400 rounded-full mr-1.5 animate-pulse"></span>
            Live
          </span>
          <button
            onClick={refetch}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="overflow-x-auto shadow ring-1 ring-black ring-opacity-5 rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Public Key
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Slot
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Amount
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Updated At
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {accounts.map((account) => (
              <tr
                key={account.pubkey}
                className="hover:bg-gray-50 transition-colors duration-150"
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <code className="text-sm font-mono text-gray-900">
                      {truncatePubkey(account.pubkey)}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(account.pubkey)}
                      className="ml-2 text-gray-400 hover:text-gray-600"
                      title="Copy full public key"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900">
                    {account.slot.toLocaleString('en-US')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm font-medium text-gray-900">
                    {formatAmount(getAmount(account))}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-500">{formatDate(account.updated_at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-sm text-gray-500">
        Showing {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
      </div>
    </div>
  );
}

