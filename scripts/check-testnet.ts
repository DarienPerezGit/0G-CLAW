/**
 * check-testnet.ts
 *
 * Validates that the 0G testnet environment is reachable and correctly configured.
 * Run via: pnpm run check:testnet
 *
 * Checks:
 *   1. Required env vars present
 *   2. 0G Storage RPC reachable (eth_chainId)
 *   3. 0G Storage Indexer reachable (HTTP GET /info or /v1/file/info)
 *   4. Wallet address + A0GI balance
 *   5. Compute broker status (blocked unless funded)
 */

import { config as loadDotenv } from 'dotenv';
import { JsonRpcProvider } from 'ethers';

loadDotenv({ override: true });

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const OK    = '\u2705'; // ✅
const FAIL  = '\u274C'; // ❌
const WARN  = '\u26A0\uFE0F '; // ⚠️
const INFO  = '\u2139\uFE0F '; // ℹ️
const BLOCK = '\u{1F6AB}'; // 🚫

function ok(msg: string)   { console.log(`  ${OK}  ${msg}`); }
function fail(msg: string) { console.log(`  ${FAIL}  ${msg}`); }
function warn(msg: string) { console.log(`  ${WARN} ${msg}`); }
function info(msg: string) { console.log(`  ${INFO} ${msg}`); }
function block(msg: string){ console.log(`  ${BLOCK}  ${msg}`); }

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
}

// ---------------------------------------------------------------------------
// 1. Required env vars
// ---------------------------------------------------------------------------

section('Required env vars');

const REQUIRED = ['OG_STORAGE_RPC', 'OG_STORAGE_INDEXER', 'OG_PRIVATE_KEY'] as const;
const OPTIONAL = ['OG_COMPUTE_PROVIDER', 'ENABLE_0G_COMPUTE_TESTS'] as const;

let allRequiredPresent = true;

for (const key of REQUIRED) {
  const val = process.env[key];
  if (val && val.trim().length > 0) {
    ok(`${key} = ${key === 'OG_PRIVATE_KEY' ? '<set>' : val}`);
  } else {
    fail(`${key} is missing or empty`);
    allRequiredPresent = false;
  }
}

for (const key of OPTIONAL) {
  const val = process.env[key];
  if (val && val.trim().length > 0) {
    info(`${key} = ${val}`);
  } else {
    warn(`${key} not set (optional)`);
  }
}

if (!allRequiredPresent) {
  console.log('\nRequired env vars missing — copy .env.example to .env and fill in values.');
  console.log('Get testnet tokens: https://faucet.0g.ai\n');
  process.exit(1);
}

const RPC      = process.env['OG_STORAGE_RPC']!;
const INDEXER  = process.env['OG_STORAGE_INDEXER']!;
const PKEY     = process.env['OG_PRIVATE_KEY']!;
const PROVIDER = process.env['OG_COMPUTE_PROVIDER'] ?? '';

// ---------------------------------------------------------------------------
// 2. 0G Storage RPC
// ---------------------------------------------------------------------------

section('0G Storage RPC');

let rpcOk = false;

try {
  const rpcProvider = new JsonRpcProvider(RPC);
  const network = await rpcProvider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId === 16602) {
    ok(`RPC reachable — chain ID ${chainId} (0G Galileo testnet)`);
  } else {
    warn(`RPC reachable — unexpected chain ID ${chainId} (expected 16602 for Galileo testnet)`);
  }
  rpcOk = true;
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  fail(`RPC unreachable: ${message}`);
}

// ---------------------------------------------------------------------------
// 3. 0G Storage Indexer
// ---------------------------------------------------------------------------

section('0G Storage Indexer');

let indexerOk = false;

try {
  // The turbo indexer responds to /nodes with the storage node list
  const res = await fetch(`${INDEXER}/nodes`, {
    signal: AbortSignal.timeout(8_000),
  });

  if (res.ok) {
    let nodeCount: number | null = null;
    try {
      const data: unknown = await res.json();
      if (Array.isArray(data)) {
        nodeCount = data.length;
      } else if (
        data !== null &&
        typeof data === 'object' &&
        'nodes' in data &&
        Array.isArray((data as { nodes: unknown }).nodes)
      ) {
        nodeCount = (data as { nodes: unknown[] }).nodes.length;
      }
    } catch {
      // non-JSON is fine — status OK is enough
    }
    const detail = nodeCount !== null ? ` (${nodeCount} storage nodes)` : '';
    ok(`Indexer reachable — HTTP ${res.status}${detail}`);
    indexerOk = true;
  } else {
    // Some indexers return 404 on /nodes but are still healthy — try root
    const res2 = await fetch(INDEXER, { signal: AbortSignal.timeout(8_000) });
    if (res2.ok || res2.status < 500) {
      ok(`Indexer reachable — HTTP ${res2.status} (root)`);
      indexerOk = true;
    } else {
      fail(`Indexer returned HTTP ${res2.status}`);
    }
  }
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  fail(`Indexer unreachable: ${message}`);
}

// ---------------------------------------------------------------------------
// 4. Wallet address + balance
// ---------------------------------------------------------------------------

section('Wallet');

try {
  // Derive address from private key without signing anything
  const { Wallet } = await import('ethers');
  const wallet = new Wallet(PKEY);
  const address = wallet.address;
  ok(`Address: ${address}`);

  if (rpcOk) {
    const rpcProvider = new JsonRpcProvider(RPC);
    const rawBalance = await rpcProvider.getBalance(address);
    const balanceA0GI = Number(rawBalance) / 1e18;

    if (balanceA0GI >= 3) {
      ok(`Balance: ${balanceA0GI.toFixed(6)} A0GI ✓ (≥ 3 OG — sufficient to fund compute broker)`);
    } else if (balanceA0GI >= 0.01) {
      warn(`Balance: ${balanceA0GI.toFixed(6)} A0GI — enough for storage, not enough for compute broker (need ≥ 3 OG)`);
    } else {
      fail(`Balance: ${balanceA0GI.toFixed(6)} A0GI — too low. Get testnet tokens at https://faucet.0g.ai`);
    }
  } else {
    warn('Balance check skipped — RPC unreachable');
  }
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  fail(`Wallet check failed: ${message}`);
}

// ---------------------------------------------------------------------------
// 5. Compute broker status
// ---------------------------------------------------------------------------

section('0G Compute Broker');

if (!PROVIDER) {
  block('OG_COMPUTE_PROVIDER not set — compute inference disabled');
  info('Set OG_COMPUTE_PROVIDER to a testnet provider address to enable compute.');
  info('Known testnet providers (Galileo):');
  info('  0xa48f01287233509FD694a22Bf840225062E67836  — qwen/qwen-2.5-7b-instruct');
  info('  0x8e60d466FD16798Bec4868aa4CE38586D5590049  — openai/gpt-oss-20b');
  info('  0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08  — google/gemma-3-27b-it');
} else {
  info(`Provider: ${PROVIDER}`);

  // Check wallet balance to determine if broker COULD be funded
  try {
    const { Wallet } = await import('ethers');
    const wallet = new Wallet(PKEY);
    const address = wallet.address;

    if (rpcOk) {
      const rpcProvider = new JsonRpcProvider(RPC);
      const rawBalance = await rpcProvider.getBalance(address);
      const balanceA0GI = Number(rawBalance) / 1e18;

      if (balanceA0GI >= 3) {
        warn('Broker: BLOCKED — wallet has enough balance but broker ledger not yet created.');
        info('To fund the broker, run these steps once:');
        info('  1. broker.ledger.addLedger(3)');
        info(`  2. broker.inference.acknowledgeProviderSigner("${PROVIDER}")`);
        info(`  3. broker.ledger.transferFund("${PROVIDER}", "inference", ethers.parseEther("1.0"))`);
        info('  4. Set ENABLE_0G_COMPUTE_TESTS=true in .env');
      } else {
        block(`Broker: BLOCKED — insufficient balance (${balanceA0GI.toFixed(6)} A0GI, need ≥ 3 OG)`);
        info('Funding steps (run after topping up wallet):');
        info('  1. broker.ledger.addLedger(3)');
        info(`  2. broker.inference.acknowledgeProviderSigner("${PROVIDER}")`);
        info(`  3. broker.ledger.transferFund("${PROVIDER}", "inference", ethers.parseEther("1.0"))`);
      }
    } else {
      block('Broker: BLOCKED — cannot check balance (RPC unreachable)');
    }
  } catch {
    block('Broker: BLOCKED — wallet error (check OG_PRIVATE_KEY)');
  }

  info('Until broker is funded, agent uses LocalComputeAdapter (COMPUTE_ADAPTER=local).');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

section('Summary');

if (!allRequiredPresent) {
  fail('Environment incomplete — see errors above.');
} else if (!rpcOk) {
  fail('0G Storage RPC unreachable — check OG_STORAGE_RPC and network.');
} else if (!indexerOk) {
  warn('Storage indexer unreachable — uploads/downloads will fail. Check OG_STORAGE_INDEXER.');
} else {
  ok('0G Storage: operational');
  if (PROVIDER) {
    block('0G Compute: deferred (broker not funded)');
  } else {
    warn('0G Compute: disabled (OG_COMPUTE_PROVIDER not set)');
  }
  info('Run: MEMORY_ADAPTER=0g COMPUTE_ADAPTER=local pnpm example:basic');
}

console.log('');
