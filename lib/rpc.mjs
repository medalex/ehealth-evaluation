// Shared JSON-RPC helpers for the gas / governance benches.
import { ethers } from 'ethers';
export { loadConfig } from './config.mjs';

// The evm redeploys on every boot; read the live contract addresses from its HTTP API.
// /health returns { ok, registry, verifier, governance, chainId }.
export async function fetchAddresses(evmApi) {
  const res = await fetch(`${evmApi}/health`);
  if (!res.ok) throw new Error(`GET ${evmApi}/health -> HTTP ${res.status}`);
  return res.json(); // { registry, verifier, governance, chainId }
}

export function provider(evmRpc) {
  return new ethers.JsonRpcProvider(evmRpc);
}

// Member signer i (0-based) from the shared dev mnemonic. Account 0 is the deployer /
// first DAO member; accounts 0..daoMembers-1 are the k-of-n members.
export function memberSigner(mnemonic, i, prov) {
  const node = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${i}`);
  return node.connect(prov);
}

// Human-readable ABI fragments — only the functions the benches call.
export const ABI = {
  governance: [
    'function propose(bytes32 policyHash) returns (uint256 id)',
    'function vote(uint256 id)',
    'function proposalCount() view returns (uint256)',
  ],
  registry: [
    'function record(bytes32 stmtHash, bool outcome)',
    'function isRecorded(bytes32 stmtHash) view returns (bool)',
  ],
  verifier: [
    'function verifyProof(uint[2] _pA, uint[2][2] _pB, uint[2] _pC, uint[21] _pubSignals) view returns (bool)',
  ],
};

export function randHash() {
  return ethers.hexlify(ethers.randomBytes(32));
}
