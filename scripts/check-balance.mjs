import { JsonRpcProvider } from 'ethers';
const provider = new JsonRpcProvider('https://evmrpc-testnet.0g.ai');
const balance = await provider.getBalance('0x136DeCcCf327A9573e32Aac73514C4CFfBc559a8');
console.log('Balance (wei):', balance.toString());
console.log('Balance (A0GI):', (Number(balance) / 1e18).toFixed(6));
