// High-resolution repeated-measurement helper. Runs fn() `n` times and returns every
// sample plus summary stats. Raw samples are what get written to CSV — aggregation
// (median/p95) is recomputed in the notebook so reviewers can re-derive it.

export async function repeat(n, fn) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    const value = await fn(i);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    samples.push({ i, ms, value });
  }
  return { samples, stats: summarize(samples.map((s) => s.ms)) };
}

export function summarize(xs) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length;
  return {
    n: s.length,
    min: s[0],
    median: q(0.5),
    p95: q(0.95),
    max: s[s.length - 1],
    mean,
    stdev: Math.sqrt(variance),
  };
}
