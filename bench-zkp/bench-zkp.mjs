// RQ2 — ZKP circuit scaling.
//
// Sweeps the circuit-size parameters, recompiles via the prover's Docker setup image on
// each point, and records how cost scales. This is the only bench that needs the circom
// toolchain — it does NOT hit the running prover; it rebuilds the circuit from source.
//
// Parameters swept (component main = PrescriptionValidation(N_DRUGS, N_max, N_PRESC,
// BITLEN, MERKLE_DEPTH, N_LAB, CONTRA_DEPTH, LAB_DEPTH)): N_PRESC, N_LAB, CONTRA_DEPTH.
//
// Per point: #constraints, compile time, trusted-setup time, witness-gen, proof-gen,
// verify time, proof size (bytes), .zkey size, peak RAM.
//
// Output: results/zkp-scaling.csv (one row per parameter point).
//
// Mechanism (see README "ZKP scaling" + Dockerfile.setup in the prover):
//   1. Pin the prover source: npm dep github:medalex/ehealth-zkp-prover#<sha> (for .circom
//      + scripts/setup.sh), or a local checkout path.
//   2. docker build -f <prover>/Dockerfile.setup -t zkp-setup <prover>   (once)
//   3. For each param point:
//        - copy the .circom to a temp circuits dir; sed-replace the PrescriptionValidation(...)
//          argument list with the swept values -> variant.circom
//        - docker run --rm -v <tmp>/circuits:/work/circuits zkp-setup bash scripts/setup.sh variant
//          (requires the 1-line CIRCUIT_NAME arg added to setup.sh — see README)
//        - `time` the run; parse `snarkjs r1cs info` for #constraints; stat variant.zkey /
//          proof.json for sizes; time `snarkjs groth16 prove` + `verify`.
//   4. writeCsv with columns: N_PRESC, N_LAB, CONTRA_DEPTH, constraints, compileMs,
//      setupMs, witnessMs, proveMs, verifyMs, proofBytes, zkeyBytes.

console.error('bench-zkp: not yet implemented — see the TODO block in this file and the README "ZKP scaling" section.');
process.exit(1);
