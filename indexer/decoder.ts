// Transaction and Instruction Decoder
// This file should contain logic to decode Solana transactions and instructions
// Parses account data, instruction data, and program-derived addresses
// Converts raw blockchain data into structured, readable formats

import { PublicKey, AccountInfo } from '@solana/web3.js';

// Buffer type from Node.js
import { Buffer } from 'node:buffer';
type BufferType = Buffer;

import {
  SPLTokenAccount,
  DecodedSPLTokenAccount,
  DecodedAccountData, // Base interface for decoded account data
} from './lib/types';

/**
 * SPL Token Program ID
 */
// Public key of the official token program on Solana 
const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

/**
 * SPL Token Account layout detection.
 * 
 * SPL Token Accounts are exactly 165 bytes.
 * Other Tokenkeg-owned accounts (e.g., Mint, Multisig, Extension accounts)
 * have different sizes, and should NOT be decoded using the TokenAccount layout.
 * 
 * @param data - Account data buffer
 * @returns true if the data matches SPL Token Account layout (165 bytes)
 */
export function isSplTokenAccount(data: Buffer | Uint8Array): boolean {
  // SPL Token Account (Account layout) = 165 bytes
  const SPL_TOKEN_ACCOUNT_SIZE = 165;
  const buffer = Buffer.from(data);
  return buffer.length === SPL_TOKEN_ACCOUNT_SIZE;
}

/**
 * SPL Token Account layout offsets (in bytes)
 * Reference: https://spl.solana.com/token#account-layouts
 */
const SPL_TOKEN_ACCOUNT_LAYOUT = {
  MINT_OFFSET: 0,
  OWNER_OFFSET: 32,
  AMOUNT_OFFSET: 64,
  DELEGATE_OPTION_OFFSET: 72,
  DELEGATE_OFFSET: 76,
  STATE_OFFSET: 108,
  IS_NATIVE_OPTION_OFFSET: 109,
  IS_NATIVE_OFFSET: 113,
  DELEGATED_AMOUNT_OFFSET: 121,
  CLOSE_AUTHORITY_OPTION_OFFSET: 129,
  CLOSE_AUTHORITY_OFFSET: 133,
} as const;

// Read a u64 (8 bytes) from buffer at offset
function readU64(buffer: BufferType, offset: number): bigint {
  return buffer.readBigUInt64LE(offset);
}

// Read a u32 (4 bytes) from buffer at offset
function readU32(buffer: BufferType, offset: number): number {
  return buffer.readUInt32LE(offset);
}

// Read a PublicKey (32 bytes) from buffer at offset
function readPublicKey(buffer: BufferType, offset: number): PublicKey {
  const keyBytes = buffer.slice(offset, offset + 32);
  return new PublicKey(keyBytes);
}

/**
 * Decode SPL Token Account from raw account data
 * @param accountData - Raw account data buffer
 * @param programId - The program ID that owns this account
 * @returns Decoded SPL Token Account or null if decoding fails
 */

// Decode SPL Token Account
export function decodeSPLTokenAccount(
  accountData: BufferType | Uint8Array,
  programId: PublicKey | string = SPL_TOKEN_PROGRAM_ID
): DecodedSPLTokenAccount | null {
  try {
    const buffer: BufferType = Buffer.from(accountData);
    
    // SPL Token Account must be exactly 165 bytes
    if (buffer.length !== 165) {
      throw new Error('Invalid SPL Token Account size');
    }

    // Read mint (32 bytes at offset 0)
    const mint = readPublicKey(buffer, SPL_TOKEN_ACCOUNT_LAYOUT.MINT_OFFSET);

    // Read owner (32 bytes at offset 32)
    const owner = readPublicKey(buffer, SPL_TOKEN_ACCOUNT_LAYOUT.OWNER_OFFSET);

    // Read amount (8 bytes at offset 64)
    const amount = readU64(buffer, SPL_TOKEN_ACCOUNT_LAYOUT.AMOUNT_OFFSET);

    // Read delegate option (4 bytes at offset 72)
    const delegateOption = readU32(
      buffer,
      SPL_TOKEN_ACCOUNT_LAYOUT.DELEGATE_OPTION_OFFSET
    );

    // Read delegate if option is 1 (32 bytes at offset 76)
    let delegate: PublicKey | null = null;
    if (delegateOption === 1) {
      delegate = readPublicKey(buffer, SPL_TOKEN_ACCOUNT_LAYOUT.DELEGATE_OFFSET);
    }

    // Read state (1 byte at offset 108)
    // 0 = Initialized, 1 = Frozen
    const state = buffer[SPL_TOKEN_ACCOUNT_LAYOUT.STATE_OFFSET];
    const isFrozen = state === 1;

    const programIdStr =
      typeof programId === 'string' ? programId : programId.toString();

    return {
      programId: programIdStr,
      accountType: 'spl-token-account',
      owner: owner.toString(),
      mint: mint.toString(),
      amount: amount.toString(),
      delegate: delegate ? delegate.toString() : null,
      isFrozen,
    };
  } catch (error) {
    // Silently skip — account is not a TokenAccount layout
    return null;
  }
}

/**
 * Decoder function type for program-specific account decoders
 */
export type AccountDecoder<T extends DecodedAccountData = DecodedAccountData> = (
  accountData: BufferType | Uint8Array,
  programId: PublicKey | string
) => T | null;

/**
 * Registry of decoders by program ID
 * Add new decoders here for different programs
 */
const DECODER_REGISTRY = new Map<string, AccountDecoder>([
  [SPL_TOKEN_PROGRAM_ID.toString(), decodeSPLTokenAccount],
]);

/**
 * Register a decoder for a specific program
 * @param programId - The program ID to register the decoder for
 * @param decoder - The decoder function
 */
export function registerDecoder(
  programId: PublicKey | string,
  decoder: AccountDecoder
): void {
  const programIdStr =
    typeof programId === 'string' ? programId : programId.toString();
  DECODER_REGISTRY.set(programIdStr, decoder);
  console.log(`[Decoder] Registered decoder for program: ${programIdStr}`);
}

/**
 * Get a decoder for a specific program ID
 * @param programId - The program ID to get the decoder for
 * @returns The decoder function or null if not found
 */
export function getDecoder(
  programId: PublicKey | string
): AccountDecoder | null {
  const programIdStr =
    typeof programId === 'string' ? programId : programId.toString();
  return DECODER_REGISTRY.get(programIdStr) || null;
}

/**
 * Main decoder function that transforms raw Solana account data into clean JSON
 * Automatically selects the appropriate decoder based on program ID
 * 
 * @param accountData - Raw account data (Buffer or Uint8Array)
 * @param programId - The program ID that owns this account
 * @returns Decoded account data or null if no decoder is available or decoding fails
 * 
 * @example
 * ```ts
 * const accountInfo = await connection.getAccountInfo(publicKey);
 * if (accountInfo) {
 *   const decoded = decodeAccount(accountInfo.data, accountInfo.owner);
 *   if (decoded && decoded.accountType === 'spl-token-account') {
 *     console.log('Token amount:', decoded.amount);
 *   }
 * }
 * ```
 */
export function decodeAccount(
  accountData: BufferType | Uint8Array,
  programId: PublicKey | string
): DecodedAccountData | null {
  const programIdStr =
    typeof programId === 'string' ? programId : programId.toString();

  // Convert to buffer for size checking
  const dataBuffer = Buffer.from(accountData);

  // Detect SPL Token Account layout before attempting to decode
  if (programIdStr === SPL_TOKEN_PROGRAM_ID.toString()) {
    if (!isSplTokenAccount(dataBuffer)) {
      // Skip non-token-account Tokenkeg PDAs silently
      // (Mint accounts, Multisig accounts, Extension accounts, etc.)
      return null;
    }

    // Valid SPL Token Account → decode normally
    const decoder = getDecoder(programIdStr);
    if (decoder) {
      try {
        return decoder(accountData, programIdStr);
      } catch (error) {
        // Silently skip on decode error
        return null;
      }
    }
    // If no decoder found for Tokenkeg, return null silently
    return null;
  }

  // Handle other programs
  const decoder = getDecoder(programIdStr);
  if (!decoder) {
    console.warn(
      `[Decoder] No decoder registered for program: ${programIdStr}`
    );
    return null;
  }

  try {
    return decoder(accountData, programIdStr);
  } catch (error) {
    // Silently skip on decode error
    return null;
  }
}

/**
 * Decode account from AccountInfo object
 * Convenience function that extracts data and owner from AccountInfo
 * 
 * @param accountInfo - Solana AccountInfo object
 * @returns Decoded account data or null if decoding fails
 */
export function decodeAccountInfo(
  accountInfo: AccountInfo<BufferType | Uint8Array>
): DecodedAccountData | null {
  if (!accountInfo.data) {
    return null;
  }

  return decodeAccount(accountInfo.data, accountInfo.owner);
}

/**
 * Batch decode multiple accounts
 * 
 * @param accounts - Array of account data and program ID pairs
 * @returns Array of decoded accounts (null entries for failed decodes)
 */
export function decodeAccounts(
  accounts: Array<{
    data: BufferType | Uint8Array;
    programId: PublicKey | string;
  }>
): Array<DecodedAccountData | null> {
  return accounts.map(({ data, programId }) =>
    decodeAccount(data, programId)
  );
}

