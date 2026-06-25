// Geocode client + farm + start-location addresses via OpenStreetMap Nominatim.
//
// Reads addresses from clients.json, farms.json, start-locations.json,
// queries Nominatim (rate-limited to 1 req/sec per their policy), and writes
// the results into src/data/coordinates.json keyed by business name / farm
// name / start id.
//
// Re-run this whenever new clients or farms are added. Existing entries with
// coords are kept (so the file is the source of truth) — pass --force to re-geocode.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'src', 'data');
const coordsPath = path.join(dataDir, 'coordinates.json');

const force = process.argv.includes('--force');

const USER_AGENT = 'GreenLoopApp/1.0 (collector route planning; contact: admin@greenloop.local)';

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=nz`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim returned ${res.status} for "${address}"`);
  const results = await res.json();
  if (!results.length) return null;
  const { lat, lon, display_name } = results[0];
  return { lat: parseFloat(lat), lng: parseFloat(lon), matchedAs: display_name };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  const [clients, farms, startLocations] = await Promise.all([
    loadJson(path.join(dataDir, 'clients.json')),
    loadJson(path.join(dataDir, 'farms.json')),
    loadJson(path.join(dataDir, 'start-locations.json')),
  ]);

  let existing = {};
  try {
    existing = await loadJson(coordsPath);
  } catch {
    // First run.
  }

  const targets = [
    ...clients.map(c => ({ key: c.business_name, address: c.address, kind: 'client' })),
    ...farms.map(f => ({ key: `farm:${f.id}`, address: f.address, kind: 'farm', label: f.farm_name })),
    ...startLocations.map(s => ({ key: `start:${s.id}`, address: s.address, kind: 'start', label: s.name })),
  ];

  const out = { ...existing };
  let geocoded = 0;
  for (const t of targets) {
    if (!t.address || t.address === 'TBD') {
      console.log(`SKIP  ${t.key} — no address`);
      continue;
    }
    if (!force && out[t.key]?.lat != null) {
      console.log(`KEEP  ${t.key}  (${out[t.key].lat}, ${out[t.key].lng})`);
      continue;
    }
    process.stdout.write(`GEOC  ${t.key}  "${t.address}" ... `);
    try {
      const result = await geocode(t.address);
      if (!result) {
        console.log('NO MATCH');
        out[t.key] = { lat: null, lng: null, address: t.address, error: 'no match' };
      } else {
        console.log(`${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`);
        out[t.key] = { lat: result.lat, lng: result.lng, address: t.address, matchedAs: result.matchedAs };
      }
      geocoded++;
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      out[t.key] = { lat: null, lng: null, address: t.address, error: err.message };
    }
    await sleep(1100); // Nominatim policy: max 1 req/sec.
  }

  await writeFile(coordsPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${Object.keys(out).length} entries to ${coordsPath} (${geocoded} newly geocoded).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
