/**
 * Simulate a minimal upload to diagnose the require(false) revert.
 * We'll create a tiny MemData and call createSubmission, then simulate
 * the flow.submit() call to get the actual revert reason.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { JsonRpcProvider, Wallet } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load dotenv
const { config } = createRequire(import.meta.url)('dotenv');
config({ path: join(__dirname, '../.env') });

const { Indexer, MemData } = await import('@0gfoundation/0g-ts-sdk');

const rpc = process.env.OG_STORAGE_RPC;
const indexerUrl = process.env.OG_STORAGE_INDEXER;
const privateKey = process.env.OG_PRIVATE_KEY;

const provider = new JsonRpcProvider(rpc);
const wallet = new Wallet(privateKey, provider);
console.log('Wallet address:', wallet.address);
console.log('Indexer URL:', indexerUrl);

const indexer = new Indexer(indexerUrl);
const testData = new TextEncoder().encode('hello 0g-claw test ' + Date.now() + ' '.repeat(300));
const memData = new MemData(testData);

console.log('Data size:', memData.size());

try {
  const [result, err] = await indexer.upload(memData, rpc, wallet);
  if (err) {
    console.error('Upload error:', err.message);
  } else {
    console.log('Upload success! rootHash:', result.rootHash, 'txHash:', result.txHash);
  }
} catch (e) {
  console.error('Exception:', e.message);
  if (e.cause) console.error('Cause:', e.cause.message);
}
