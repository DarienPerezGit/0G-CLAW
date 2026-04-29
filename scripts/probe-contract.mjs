/**
 * Probe the flow contract to understand why submit() reverts.
 */
import { JsonRpcProvider, Wallet, Contract, ethers } from 'ethers';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { config } = createRequire(import.meta.url)('dotenv');
config({ path: join(__dirname, '../.env') });

const rpc = process.env.OG_STORAGE_RPC;
const privateKey = process.env.OG_PRIVATE_KEY;
const flowAddr = '0x22E03a6A89B950F1c82ec5e74F8eCa321a105296';

const FLOW_ABI = [
  'function market() view returns (address)',
  'function numEntries() view returns (uint256)',
  'function epoch() view returns (uint256)',
  'function firstBlock() view returns (uint256)',
];

const provider = new JsonRpcProvider(rpc);
const wallet = new Wallet(privateKey, provider);
const flow = new Contract(flowAddr, FLOW_ABI, provider);

try {
  const market = await flow.market();
  console.log('market:', market);
} catch(e) { console.log('market() failed:', e.message); }

try {
  const entries = await flow.numEntries();
  console.log('numEntries:', entries.toString());
} catch(e) { console.log('numEntries() failed:', e.message); }

try {
  const ep = await flow.epoch();
  console.log('epoch:', ep.toString());
} catch(e) { console.log('epoch() failed:', e.message); }

try {
  const fb = await flow.firstBlock();
  console.log('firstBlock:', fb.toString());
} catch(e) { console.log('firstBlock() failed:', e.message); }

// Check if there's a newer flow contract address by fetching from 0G docs or explorer
// Let's also check nonce
const nonce = await provider.getTransactionCount(wallet.address);
console.log('Wallet nonce:', nonce);
const block = await provider.getBlockNumber();
console.log('Current block:', block);
