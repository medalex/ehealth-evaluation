// RQ2/RQ4 — on-chain gas costs.
//
// Measures gasUsed for the state-changing governance/registry operations and the gas an
// on-chain Groth16 verification would consume. Addresses are read live from the evm API
// (it redeploys on every boot). Run with the stack up:
//
//   node bench-gas/bench-gas.mjs   [--runs 20]
//
// Output: results/gas.csv  (one row per operation per run).
//
// Note on verifyProof: it is a view function, so its gas is obtained via estimateGas
// against a real proof fixture. If bench-gas/fixtures/proof.json + public.json are absent,
// that measurement is skipped (produce a fixture from a live issuance first — see README).
// The headline DSR result is that this figure is CONSTANT regardless of circuit size.

import { ethers } from 'ethers';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, fetchAddresses, provider, memberSigner, ABI, randHash } from '../lib/rpc.mjs';
import { writeCsv } from '../lib/csv.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv.includes('--runs') ? process.argv[process.argv.indexOf('--runs') + 1] : 20);

async function main() {
  const cfg = loadConfig();
  const prov = provider(cfg.evmRpc);
  const addr = await fetchAddresses(cfg.evmApi);
  console.log(`[gas] governance=${addr.governance} registry=${addr.registry} verifier=${addr.verifier} chainId=${addr.chainId}`);

  // Capture the measurement environment (gas depends on the EVM/compiler, not the host).
  let client = '';
  try { client = await prov.send('web3_clientVersion', []); } catch { /* ignore */ }
  const env = {
    chain: 'dedicated local EVM (ehealth-evm)',
    chainId: addr.chainId,
    client: client || 'ganache',
    solc: '0.8.26',
    contracts: 'MinimalGovernance, DecisionRegistry, Groth16Verifier',
    ethers: ethers.version,
    node: process.version,
    runs: RUNS,
    at: new Date().toISOString(),
    note: 'Gas is deterministic — fixed by the contract bytecode + EVM rules, independent of the host machine.',
  };

  const m0 = memberSigner(cfg.mnemonic, 0, prov);
  const m1 = memberSigner(cfg.mnemonic, 1, prov);

  // Include the Proposed event so we can recover the exact proposal id from the receipt
  // (robust against concurrent proposals from mfssia / the DAO console on the same contract).
  const govAbi = [...ABI.governance, 'event Proposed(uint256 indexed id, bytes32 indexed policyHash, address indexed proposer)'];
  // These accounts (0,1) are also the evm's own DAO members, so their on-chain nonce can
  // drift from a fresh ethers read. Wrap in NonceManager and reset+retry on a nonce error —
  // the same guard the evm itself uses.
  const nm0 = new ethers.NonceManager(m0);
  const nm1 = new ethers.NonceManager(m1);
  const gov0 = new ethers.Contract(addr.governance, govAbi, nm0);
  const gov1 = new ethers.Contract(addr.governance, govAbi, nm1);
  const reg0 = new ethers.Contract(addr.registry, ABI.registry, nm0);

  async function txWait(mgr, send) {
    try { return await (await send()).wait(); }
    catch (e) {
      if (!/nonce/i.test(e.message ?? '')) throw e;
      mgr.reset();
      return await (await send()).wait();
    }
  }

  const rows = [];
  const push = (op, run, gasUsed, extra = {}) =>
    rows.push({ op, run, gasUsed: gasUsed.toString(), ...extra });

  const example = {}; // one representative call's actual inputs, for the report
  for (let run = 0; run < RUNS; run++) {
    // propose(bytes32): fresh hash each run so we never collide with an existing proposal.
    const hash = randHash();
    const pr = await txWait(nm0, () => gov0.propose(hash));
    push('propose', run, pr.gasUsed);

    // Recover the exact proposal id from the Proposed event in this receipt.
    const ev = pr.logs
      .map((l) => { try { return gov0.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === 'Proposed');
    const id = ev.args.id;
    const vr = await txWait(nm1, () => gov1.vote(id));
    push('vote', run, vr.gasUsed);

    // record(bytes32,bool): fresh stmtHash so we never hit the replay guard (409/revert).
    const stmtHash = randHash();
    const rr = await txWait(nm0, () => reg0.record(stmtHash, true));
    push('record', run, rr.gasUsed);

    if (run === 0) {
      example.propose = { policyHash: hash };
      example.vote = { id: id.toString() };
      example.record = { stmtHash, outcome: true };
    }
  }
  env.inputs = example;

  // verifyProof gas — constant-cost headline. Only if a real proof fixture is present.
  const proofPath = join(__dir, 'fixtures', 'proof.json');
  const pubPath = join(__dir, 'fixtures', 'public.json');
  if (existsSync(proofPath) && existsSync(pubPath)) {
    const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
    const pub = JSON.parse(readFileSync(pubPath, 'utf8'));
    const pA = [proof.pi_a[0], proof.pi_a[1]];
    const pB = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]];
    const pC = [proof.pi_c[0], proof.pi_c[1]];
    const verifier = new ethers.Contract(addr.verifier, ABI.verifier, prov);
    for (let run = 0; run < RUNS; run++) {
      const gas = await verifier.verifyProof.estimateGas(pA, pB, pC, pub);
      push('verifyProof', run, gas);
    }
  } else {
    console.warn('[gas] no proof fixture — skipping verifyProof gas (see README to generate one).');
  }

  writeCsv(join(__dir, '..', 'results', 'gas.csv'), rows);
  writeFileSync(join(__dir, '..', 'results', 'gas-env.json'), JSON.stringify(env, null, 2));
  console.log('[gas] done.');
}

main().catch((e) => {
  console.error('[gas] FAILED:', e.message);
  process.exit(1);
});
