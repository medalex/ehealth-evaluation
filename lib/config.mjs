// Stack configuration loader. Kept free of heavy deps (no ethers) so the HTTP-only benches
// (correctness, e2e) can import it without pulling the RPC toolchain.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));

export function loadConfig() {
  const raw = readFileSync(join(__dir, '..', 'config', 'stack.json'), 'utf8');
  const cfg = JSON.parse(raw);
  return {
    evmRpc: process.env.RPC_URL ?? cfg.evmRpc,
    evmApi: process.env.EVM_API ?? cfg.evmApi,
    mnemonic: process.env.MNEMONIC ?? cfg.mnemonic,
    daoMembers: Number(process.env.DAO_MEMBERS ?? cfg.daoMembers),
    hospitalApi: process.env.HOSPITAL_API ?? cfg.hospitalApi,
    pharmacyApi: process.env.PHARMACY_API ?? cfg.pharmacyApi,
    patientApi: process.env.PATIENT_API ?? cfg.patientApi,
    labApi: process.env.LAB_API ?? cfg.labApi,
    mfssiaApi: process.env.MFSSIA_API ?? cfg.mfssiaApi,
  };
}
