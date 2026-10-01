// Runs the impact calculation against snapshot JSON files and prints a totals table.
// Usage: npx esbuild scripts/impact-check.ts --bundle --platform=node --format=esm --outfile=/tmp/impact-check.mjs && node /tmp/impact-check.mjs <invoicing.json> <bintracker.json> [YYYY-MM-DD] [phases.json]
import { readFileSync } from 'node:fs';
import { computeImpact, attachPileStages, listInvoicingBusinesses, SEED_ALIASES } from '../netlify/functions/_lib/impact';

const [invPath, btPath, todayArg] = process.argv.slice(2);
const inv = JSON.parse(readFileSync(invPath, 'utf8')).data;
const bt = JSON.parse(readFileSync(btPath, 'utf8')).data;
const today = new Date(todayArg ?? Date.now());
const rows = listInvoicingBusinesses(inv).map((b) => {
  const r = computeImpact(inv, bt, { business: b, aliases: SEED_ALIASES[b.toLowerCase()] ?? [] }, today);
  const last = r.latestCollection ?? '';
  if (last > today.toISOString().slice(0, 10)) throw new Error(`${b}: collection after today`);
  return {
    business: b, first: r.firstCollection, last: r.latestCollection,
    litres: r.totals.litres, kg: r.totals.kg, co2eKg: r.totals.co2eVsLandfillKg, vsGreen: r.totals.co2eVsGreenBinKg, bokashi: r.totals.co2eVsLandfillBokashiKg,
    fullPct: r.settings.avgFullnessPct, src: r.settings.fullnessSource, n: r.settings.fullnessMeasuredContainers,
    measPct: r.totals.measuredSharePct, piles: r.piles.length, maturing: r.stillMaturing,
  };
});
console.table(rows);
const sum = (k: 'litres' | 'kg' | 'co2eKg' | 'vsGreen') => Math.round(rows.reduce((a, r) => a + r[k], 0));
console.log('TOTAL litres', sum('litres'), 'kg', sum('kg'), 'co2e vs red bin', sum('co2eKg'), 'vs green bin', sum('vsGreen'));

// Optional: node impact-check.mjs <inv> <bt> <today> <phases.json>  -> pile -> stage match report
const phasesPath = process.argv[5];
if (phasesPath) {
  const phases = JSON.parse(readFileSync(phasesPath, 'utf8')).data;
  const seen = new Map<string, string | undefined>();
  for (const b of listInvoicingBusinesses(inv)) {
    const r = attachPileStages(computeImpact(inv, bt, { business: b, aliases: SEED_ALIASES[b.toLowerCase()] ?? [] }, today), phases);
    for (const p of r.piles) seen.set(p.pile, p.stage);
  }
  console.log('matched:', [...seen].filter(([, s]) => s).map(([p, s]) => `${p}=${s}`).join(', '));
  console.log('unmatched:', [...seen].filter(([, s]) => !s).map(([p]) => p).join(', '));
}
