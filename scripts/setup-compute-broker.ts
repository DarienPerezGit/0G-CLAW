/**
 * setup-compute-broker.ts
 *
 * One-time setup script for the 0G Compute Network broker.
 * Run ONCE per wallet. Safe to re-run — each step checks state before acting.
 *
 * What it does:
 *   1. Validates required env vars
 *   2. Prints wallet address + balance
 *   3. Initializes ZGComputeNetworkBroker
 *   4. Creates ledger with 3 OG (if not already present)
 *   5. Acknowledges provider signer (if not already acked)
 *   6. Transfers 1 OG to provider for inference (if not already funded)
 *
 * Run:
 *   pnpm tsx scripts/setup-compute-broker.ts
 *
 * Required env vars:
 *   OG_PRIVATE_KEY        — wallet private key
 *   OG_STORAGE_RPC        — 0G chain EVM RPC
 *   OG_COMPUTE_PROVIDER   — provider address to fund
 *
 * Cost:
 *   ~3 OG ledger creation + ~1 OG provider funding + gas (~0.1 OG)
 *   Total: ~4.1 OG minimum. Wallet must have ≥ 4.5 OG to be safe.
 */

import { config as loadDotenv } from 'dotenv';
import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createRequire } from 'module';

loadDotenv({ override: true });

// The 0G serving broker has a broken ESM bundle in Node ≥22 (named export resolution fails).
// Use CJS interop via createRequire — the CJS build works correctly.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { createZGComputeNetworkBroker } = require('@0glabs/0g-serving-broker') as any;

loadDotenv({ override: true });

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const OK    = '\u2705'; // ✅
const FAIL  = '\u274C'; // ❌
const WARN  = '\u26A0\uFE0F '; // ⚠️
const INFO  = '\u2139\uFE0F '; // ℹ️
const SPIN  = '\u23F3'; // ⏳

function ok(msg: string)   { console.log(`  ${OK}  ${msg}`); }
function fail(msg: string) { console.log(`  ${FAIL}  ${msg}`); }
function warn(msg: string) { console.log(`  ${WARN} ${msg}`); }
function info(msg: string) { console.log(`  ${INFO} ${msg}`); }
function spin(msg: string) { console.log(`  ${SPIN}  ${msg}`); }

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
}

// ---------------------------------------------------------------------------
// 1. Env var validation
// ---------------------------------------------------------------------------

section('Environment');

const REQUIRED = ['OG_PRIVATE_KEY', 'OG_STORAGE_RPC', 'OG_COMPUTE_PROVIDER'] as const;
let allPresent = true;

for (const key of REQUIRED) {
  const val = process.env[key];
  if (val && val.trim().length > 0) {
    ok(`${key} = ${key === 'OG_PRIVATE_KEY' ? '<set>' : val}`);
  } else {
    fail(`${key} missing or empty`);
    allPresent = false;
  }
}

if (!allPresent) {
  console.error('\nFix missing env vars in .env before running this script.\n');
  process.exit(1);
}

const PRIVATE_KEY      = process.env['OG_PRIVATE_KEY']!;
const RPC              = process.env['OG_STORAGE_RPC']!;
const PROVIDER_ADDRESS = process.env['OG_COMPUTE_PROVIDER']!;

// ---------------------------------------------------------------------------
// 2. Wallet address + balance
// ---------------------------------------------------------------------------

section('Wallet');

const rpcProvider = new JsonRpcProvider(RPC);
const wallet = new Wallet(PRIVATE_KEY, rpcProvider);
const address = wallet.address;

ok(`Address: ${address}`);

const rawBalance = await rpcProvider.getBalance(address);
const balanceOG = Number(rawBalance) / 1e18;
info(`Balance: ${balanceOG.toFixed(6)} A0GI`);

if (balanceOG < 4) {
  fail(`Insufficient balance: ${balanceOG.toFixed(6)} A0GI. Need at least 4 OG (3 ledger + 1 provider + gas).`);
  process.exit(1);
}

ok(`Balance sufficient (≥ 4 OG)`);

// ---------------------------------------------------------------------------
// 3. Initialize broker
// ---------------------------------------------------------------------------

section('Broker Initialization');

spin('Creating ZGComputeNetworkBroker...');

let broker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>>;

try {
  broker = await createZGComputeNetworkBroker(wallet);
  ok('Broker initialized');
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  fail(`Broker init failed: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Create ledger (if needed)
// ---------------------------------------------------------------------------

section('Ledger Setup');

let ledgerExists = false;
let ledgerBalance = 0n;

try {
  const ledger = await broker.ledger.getLedger();
  ledgerExists = true;
  // LedgerStructOutput has a `balance` field (bigint, in neuron)
  if (ledger && typeof ledger === 'object' && 'balance' in ledger) {
    ledgerBalance = (ledger as { balance: bigint }).balance;
  }
  const ledgerOG = Number(ledgerBalance) / 1e18;
  ok(`Ledger already exists — balance: ${ledgerOG.toFixed(6)} OG`);
} catch {
  info('No existing ledger found — will create one');
  ledgerExists = false;
}

if (!ledgerExists) {
  spin('Creating ledger with 3 OG...');
  try {
    await broker.ledger.addLedger(3);
    ok('Ledger created with 3 OG');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Ledger creation failed: ${msg}`);
    process.exit(1);
  }
} else {
  info('Skipping ledger creation (already exists)');
}

// ---------------------------------------------------------------------------
// 5. Acknowledge provider signer
// ---------------------------------------------------------------------------

section('Provider Acknowledgement');

info(`Provider: ${PROVIDER_ADDRESS}`);

let alreadyAcknowledged = false;

try {
  alreadyAcknowledged = await broker.inference.acknowledged(PROVIDER_ADDRESS);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  warn(`Could not check acknowledgement status: ${msg}. Will attempt to acknowledge.`);
}

if (alreadyAcknowledged) {
  ok('Provider already acknowledged');
} else {
  spin('Acknowledging provider signer (on-chain tx)...');
  try {
    await broker.inference.acknowledgeProviderSigner(PROVIDER_ADDRESS);
    ok('Provider signer acknowledged');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Acknowledgement failed: ${msg}`);
    console.error('\n  Possible causes:');
    console.error('    - Provider address does not exist on this testnet');
    console.error('    - Provider TEE signer not registered');
    console.error(`    - Provider: ${PROVIDER_ADDRESS}`);
    console.error('  Try a different provider:');
    console.error('    0xa48f01287233509FD694a22Bf840225062E67836  — qwen/qwen-2.5-7b-instruct');
    console.error('    0x8e60d466FD16798Bec4868aa4CE38586D5590049  — openai/gpt-oss-20b');
    console.error('    0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08  — google/gemma-3-27b-it');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 6. Fund provider (if not already funded)
// ---------------------------------------------------------------------------

section('Provider Funding');

// Check existing balance with provider
let existingProviderBalance = 0n;
let providerAlreadyFunded = false;

try {
  const providers = await broker.ledger.getProvidersWithBalance('inference');
  const entry = providers.find(([addr]: [string, bigint, bigint]) => addr.toLowerCase() === PROVIDER_ADDRESS.toLowerCase());
  if (entry) {
    existingProviderBalance = entry[1];
    const existingOG = Number(existingProviderBalance) / 1e18;
    if (existingOG > 0.5) {
      providerAlreadyFunded = true;
      ok(`Provider already funded: ${existingOG.toFixed(6)} OG`);
    } else {
      info(`Provider has ${existingOG.toFixed(6)} OG — will top up to 1 OG`);
    }
  } else {
    info('Provider has no existing balance — will fund 1 OG');
  }
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  warn(`Could not check provider balance: ${msg}. Will attempt to fund.`);
}

if (!providerAlreadyFunded) {
  // transferFund amount is in neuron (bigint). 1 OG = 1e18 neuron.
  const FUND_AMOUNT_NEURON = parseEther('1'); // BigInt(1_000_000_000_000_000_000n)
  const fundOG = Number(FUND_AMOUNT_NEURON) / 1e18;

  spin(`Transferring ${fundOG} OG to provider for inference...`);
  try {
    await broker.ledger.transferFund(PROVIDER_ADDRESS, 'inference', FUND_AMOUNT_NEURON);
    ok(`Transferred ${fundOG} OG to provider`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Fund transfer failed: ${msg}`);
    console.error(`  Provider: ${PROVIDER_ADDRESS}`);
    process.exit(1);
  }
} else {
  info('Skipping fund transfer (provider already funded)');
}

// ---------------------------------------------------------------------------
// 7. Verify service metadata (sanity check)
// ---------------------------------------------------------------------------

section('Service Verification');

spin('Fetching provider service metadata...');

try {
  const meta = await broker.inference.getServiceMetadata(PROVIDER_ADDRESS);
  ok(`Endpoint: ${meta.endpoint}`);
  ok(`Model: ${meta.model}`);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  warn(`Could not fetch service metadata: ${msg}`);
  warn('The broker may still work — this is a non-fatal check.');
}

// ---------------------------------------------------------------------------
// 8. Final balance
// ---------------------------------------------------------------------------

section('Final Balance');

const finalRawBalance = await rpcProvider.getBalance(address);
const finalOG = Number(finalRawBalance) / 1e18;
const spent = balanceOG - finalOG;

info(`Before: ${balanceOG.toFixed(6)} A0GI`);
info(`After:  ${finalOG.toFixed(6)} A0GI`);
info(`Spent:  ~${spent.toFixed(6)} A0GI (ledger + funding + gas)`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

section('Summary');

ok('Broker setup complete');
ok(`Provider:      ${PROVIDER_ADDRESS}`);
ok(`Acknowledged:  yes`);
ok(`Funded:        yes (1 OG)`);
console.log('');
info('Next steps:');
info('  1. Add to .env:');
info(`     OG_COMPUTE_PROVIDER=${PROVIDER_ADDRESS}`);
info('     ENABLE_0G_COMPUTE_TESTS=true');
info('  2. Run live tests:');
info('     ENABLE_0G_COMPUTE_TESTS=true pnpm test adapters/compute/0GComputeAdapter.test.ts');
info('  3. Run agent with 0G compute:');
info('     MEMORY_ADAPTER=0g COMPUTE_ADAPTER=0g pnpm example:basic');
console.log('');
