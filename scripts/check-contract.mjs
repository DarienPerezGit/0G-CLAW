import { JsonRpcProvider, Wallet, Contract } from 'ethers';

const FLOW_ABI = [
  'function market() view returns (address)',
  'function submission(uint256 idx) view returns (tuple)',
];

const MARKET_ABI = [
  'function pricePerSector() view returns (uint256)',
];

const provider = new JsonRpcProvider('https://evmrpc-testnet.0g.ai');
const flowAddr = '0x22E03a6A89B950F1c82ec5e74F8eCa321a105296';

try {
  const flow = new Contract(flowAddr, FLOW_ABI, provider);
  const marketAddr = await flow.market();
  console.log('Market address:', marketAddr);
  const market = new Contract(marketAddr, MARKET_ABI, provider);
  const price = await market.pricePerSector();
  console.log('Price per sector:', price.toString());
} catch (e) {
  console.error('Error:', e.message);
}

// Check if code exists at flow address
const code = await provider.getCode(flowAddr);
console.log('Flow contract code exists:', code !== '0x', '(length:', code.length, ')');
