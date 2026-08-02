// RQ3 — k-of-n governance cost. Deploys a fresh MinimalGovernance for a range of member
// counts and drives the resolution path (propose → vote to quorum → approved), recording
// deploy gas, propose/vote gas, the total resolution gas, and wall-clock. This isolates the
// on-chain governance cost as a function of the DAO size.
//
//   node bench-dao/bench-conflict.mjs
//
// Needs only the running evm (JSON-RPC + funded dev accounts) — it deploys its own contracts,
// so it does not touch the DKG or the domain services. Output: results/dao-conflict.csv.

import { ethers } from 'ethers';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, provider, memberSigner, randHash } from '../lib/rpc.mjs';
import { summarize } from '../lib/timer.mjs';
import { writeCsv } from '../lib/csv.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const EVM_CONTRACTS = process.env.EVM_CONTRACTS_DIR ?? join(__dir, '..', '..', 'ehealth-evm', 'contracts');
const QUORUM_PCT = Number(process.env.DAO_QUORUM_PCT ?? 60);
const MEMBERS_GRID = (process.env.DAO_GRID ?? '3,4,5,6,7').split(',').map(Number);
// The evm reserves mnemonic accounts 0..2 (deployer/registry + its own DAO members); use
// dedicated idle accounts to avoid nonce contention with the long-running evm process.
const ACCOUNT_OFFSET = Number(process.env.DAO_ACCOUNT_OFFSET ?? 3);

function compileGovernance() {
  const src = readFileSync(join(EVM_CONTRACTS, 'MinimalGovernance.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MinimalGovernance.sol': { content: src } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  const c = out.contracts['MinimalGovernance.sol']['MinimalGovernance'];
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}

const quorum = (n) => Math.max(1, Math.ceil((n * QUORUM_PCT) / 100));

async function runN(n, pool, art) {
  const t = quorum(n);
  const members = pool.slice(0, n);
  const memberAddrs = await Promise.all(members.map((m) => m.getAddress()));

  // Deploy a fresh MinimalGovernance(members, threshold).
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, members[0]);
  const gov = await factory.deploy(memberAddrs, t);
  await gov.waitForDeployment();
  const deployGas = (await gov.deploymentTransaction().wait()).gasUsed;

  // Resolution path: propose + vote until approved. Time the whole round-trip.
  const wall0 = process.hrtime.bigint();
  const hash = randHash();
  const pr = await (await gov.connect(members[0]).propose(hash)).wait();
  const proposeGas = pr.gasUsed;
  const ev = pr.logs.map((l) => { try { return gov.interface.parseLog(l); } catch { return null; } })
    .find((x) => x && x.name === 'Proposed');
  const id = ev.args.id;

  const voteGas = [];
  let votes = 0;
  // Voters are members 1..n-1 (proposer is member 0); cast until the proposal is approved.
  for (let i = 1; i < n && votes < t; i++) {
    const vr = await (await gov.connect(members[i]).vote(id)).wait();
    voteGas.push(vr.gasUsed);
    votes++;
    if ((await gov.proposals(id)).approved) break;
  }
  const wallMs = Number(process.hrtime.bigint() - wall0) / 1e6;

  const approved = (await gov.proposals(id)).approved;
  const sum = (xs) => xs.reduce((a, b) => a + b, 0n);
  const resolutionGas = proposeGas + sum(voteGas);
  const voteGasMed = voteGas.length ? Math.round(summarize(voteGas.map(Number)).median) : 0;

  return {
    members: n, threshold: t, approved,
    deployGas: deployGas.toString(),
    proposeGas: proposeGas.toString(),
    voteGasMed,
    votesCast: votes,
    resolutionGas: resolutionGas.toString(),
    wallMs: wallMs.toFixed(1),
  };
}

async function main() {
  const prov = provider(cfg.evmRpc);
  try { await prov.getBlockNumber(); }
  catch { console.error(`[dao] cannot reach evm RPC at ${cfg.evmRpc} — is the stack up?`); process.exit(1); }

  console.log('[dao] compiling MinimalGovernance.sol (solc 0.8.26)...');
  const art = compileGovernance();

  // One NonceManager per account, created once so the local nonce counter stays continuous
  // across grid iterations (avoids ganache pending/latest off-by-one on account reuse).
  const maxN = Math.max(...MEMBERS_GRID);
  const pool = Array.from({ length: maxN }, (_, i) =>
    new ethers.NonceManager(memberSigner(cfg.mnemonic, ACCOUNT_OFFSET + i, prov)));

  const rows = [];
  for (const n of MEMBERS_GRID) {
    try {
      const r = await runN(n, pool, art);
      console.log(`[dao] n=${n} k=${r.threshold} approved=${r.approved} deploy=${r.deployGas} resolution=${r.resolutionGas} wall=${r.wallMs}ms`);
      rows.push(r);
    } catch (e) {
      console.error(`[dao] n=${n} FAILED: ${e.message.split('\n')[0]}`);
    }
  }
  if (!rows.length) { console.error('[dao] no points completed'); process.exit(1); }
  writeCsv(join(__dir, '..', 'results', 'dao-conflict.csv'), rows);
}

main().catch((e) => { console.error('[dao] FATAL:', e.message); process.exit(1); });
