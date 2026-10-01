// Pure business-impact calculation. No I/O: takes raw sheet rows + settings +
// "today" so it can be run with node against snapshots of the live sheets.
//
// Inputs
//   invoicingRows  – the "invoicing" tab (row 0 date headers from col 13,
//                    row 1 column headers, then 3-row business blocks)
//   binTrackerRows – the "Bin Tracker" tab (column-by-position contract, see
//                    the memory note "Bin Tracker sheet contract")

export const BIN_CAPACITY_LITRES = 120; // keep in sync with src/services/consolidationService.ts
export const BUCKET_CAPACITY_LITRES = 20;
export const DEFAULT_KG_PER_FULL_BIN = 70; // placeholder density

// NZ Ministry for the Environment, Measuring Emissions Catalogue 2026
// https://measuringemissionsguide.environment.govt.nz/10_materials_waste.html
export const FACTORS = {
  foodLandfillGasRecovery: 0.971043,
  gardenLandfillGasRecovery: 0.79449,
  composting: 0.1756,
};
// Distances (km) and truck factor, used for the transport legs.
// Red-bin waste is trucked from New Plymouth to Bonny Glen landfill near Marton
// (NPDC FAQ: https://www.npdc.govt.nz/zero-waste/faqs/).
export const RED_BIN_LANDFILL_KM = 200;
// Council food-scraps (green) bin is trucked to a commercial composter at Hampton Downs
// (https://www.npdc.govt.nz/zero-waste/recycling-and-rubbish-collection/your-food-scraps-bin/).
export const COUNCIL_FOOD_SCRAPS_KM = 300;
// MfE Measuring Emissions Catalogue 2026, Table 8.11 long-haul heavy truck, kg CO2e per tonne-km
// https://measuringemissionsguide.environment.govt.nz/8_freight.html
export const TRUCK_KG_CO2E_PER_TONNE_KM = 0.105;
// Green Loop's own collection transport is an electric van charged from solar: counted as zero.
export const GREEN_LOOP_TRANSPORT_KG_CO2E_PER_KG = 0;

// Per kg of waste
export const TRANSPORT_LANDFILL_PER_KG = (RED_BIN_LANDFILL_KM * TRUCK_KG_CO2E_PER_TONNE_KM) / 1000; // 0.021
export const TRANSPORT_COUNCIL_PER_KG = (COUNCIL_FOOD_SCRAPS_KM * TRUCK_KG_CO2E_PER_TONNE_KM) / 1000; // 0.0315

// (a) vs the red bin: landfill methane + trucking to landfill - our composting (+ our own transport = 0)
export const LANDFILL_PART_PER_KG_FOOD = FACTORS.foodLandfillGasRecovery - FACTORS.composting; // 0.795443
export const LANDFILL_PART_PER_KG_GARDEN = FACTORS.gardenLandfillGasRecovery - FACTORS.composting; // 0.61889
export const AVOIDED_PER_KG_FOOD = LANDFILL_PART_PER_KG_FOOD + TRANSPORT_LANDFILL_PER_KG - GREEN_LOOP_TRANSPORT_KG_CO2E_PER_KG; // 0.816443
export const AVOIDED_PER_KG_GARDEN = LANDFILL_PART_PER_KG_GARDEN + TRANSPORT_LANDFILL_PER_KG - GREEN_LOOP_TRANSPORT_KG_CO2E_PER_KG; // 0.63989
// (b) vs the council food-scraps bin: composting emissions cancel; only the longer trucking leg is avoided
export const AVOIDED_VS_GREEN_BIN_PER_KG = TRANSPORT_COUNCIL_PER_KG - GREEN_LOOP_TRANSPORT_KG_CO2E_PER_KG; // 0.0315

export const SOURCE_URL = 'https://measuringemissionsguide.environment.govt.nz/10_materials_waste.html';
export const FREIGHT_SOURCE_URL = 'https://measuringemissionsguide.environment.govt.nz/8_freight.html';

export interface ImpactSettings {
  business: string; // exact invoicing name
  kgPerFullBin?: number | null; // blank = default
  aliases?: string[]; // other names in the Bin Tracker
  yearStartMonth?: number | null; // 1-12, blank = January
}

// Aliases seeded for new rows (keyed by lower-cased invoicing name).
export const SEED_ALIASES: Record<string, string[]> = {
  'columbus coffee': ['Columbus'],
  'novotel new plymouth': ['Novotel'],
  'toi foundation': ['Toi Foundation'],
  'np community foodbank trust': ['Food Bank'],
};

type Row = (string | number | null | undefined)[];

// ───────────────────────── date helpers ─────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parses "4 Feb 2026", "3-Oct-2025", "1-Sept-2026", "31/12/2026" (DD/MM/YYYY) to YYYY-MM-DD. */
export function parseDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,})\.?[\s\-/.,]+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? iso(+m[3], mon, +m[1]) : null;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  return null;
}

function todayIso(today: Date): string {
  return today.toISOString().slice(0, 10);
}

// ───────────────────────── name helpers ─────────────────────────

export function norm(name: unknown): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function nameSet(s: ImpactSettings): Set<string> {
  const set = new Set<string>([norm(s.business)]);
  for (const a of s.aliases ?? []) if (norm(a)) set.add(norm(a));
  return set;
}

// ───────────────────────── invoicing parse ─────────────────────────

export interface Pickup {
  business: string; // trimmed invoicing name
  date: string; // YYYY-MM-DD
  count: number;
  binType: string; // 'W-Bins' | 'Bkts' | 'green' | other
}

function containerKind(binType: string): { litres: number; kind: 'bin' | 'bucket'; garden: boolean } {
  const t = binType.trim().toLowerCase();
  if (t.startsWith('bkt') || t.includes('bucket')) return { litres: BUCKET_CAPACITY_LITRES, kind: 'bucket', garden: false };
  if (t === 'green') return { litres: BIN_CAPACITY_LITRES, kind: 'bin', garden: true };
  return { litres: BIN_CAPACITY_LITRES, kind: 'bin', garden: false };
}

export function listInvoicingBusinesses(rows: Row[]): string[] {
  const out: string[] = [];
  for (let i = 2; i < rows.length; i++) {
    const n = String(rows[i]?.[0] ?? '').trim();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export function firstInvoicingDate(rows: Row[]): string | null {
  let first: string | null = null;
  for (const h of (rows[0] ?? []).slice(13)) {
    const d = parseDate(h);
    if (d && (!first || d < first)) first = d;
  }
  return first;
}

/** Counted pickups (marker is a non-aborted "Pick Up", date <= today, count > 0) for one business. */
export function parseInvoicingPickups(rows: Row[], business: string, today: Date): Pickup[] {
  const todayS = todayIso(today);
  const headers = (rows[0] ?? []).map((h, i) => (i >= 13 ? parseDate(h) : null));
  const out: Pickup[] = [];
  const want = norm(business);
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = String(r[0] ?? '').trim();
    if (!name || norm(name) !== want) continue;
    const countRow = rows[i + 1] ?? [];
    const binType = String(r[10] ?? '').trim();
    for (let c = 13; c < headers.length; c++) {
      const date = headers[c];
      if (!date || date > todayS) continue;
      const marker = String(r[c] ?? '').trim().toLowerCase();
      if (!marker.includes('pick') || marker.includes('aborted')) continue;
      const count = Number(String(countRow[c] ?? '').trim());
      if (!Number.isFinite(count) || count <= 0) continue;
      out.push({ business: name, date, count, binType });
    }
  }
  return out;
}

// ───────────────────────── bin tracker parse ─────────────────────────

export interface TrackerEntry {
  name: string;
  bins: number;
  buckets: number;
  litres: number;
  estimated: boolean;
}

export interface TrackerRow {
  date: string; // collection date
  names: string[]; // B–F + M, "?" and blanks removed
  pile: string; // col K ('' if none)
  batchingDate: string | null; // col J
  entries: TrackerEntry[]; // col N
}

export function parseBinTracker(rows: Row[]): TrackerRow[] {
  const out: TrackerRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const date = parseDate(r[0]);
    if (!date) continue; // header, blank, separator
    const names: string[] = [];
    for (let c = 1; c <= 5; c++) {
      const n = String(r[c] ?? '').trim();
      if (n && n !== '?') names.push(n);
    }
    for (const n of String(r[12] ?? '').split(',')) {
      const t = n.trim();
      if (t && t !== '?') names.push(t);
    }
    let pile = String(r[10] ?? '').trim();
    if (/^[.\s]+$/.test(pile)) pile = '';
    const entries: TrackerEntry[] = [];
    const raw = String(r[13] ?? '').trim();
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const e of arr) {
            const litres = Number(e?.litres);
            if (!e?.name || !Number.isFinite(litres)) continue;
            entries.push({
              name: String(e.name),
              bins: Number(e.bins) || 0,
              buckets: Number(e.buckets) || 0,
              litres,
              estimated: e.estimated === true,
            });
          }
        }
      } catch { /* malformed JSON: treat as no measurements */ }
    }
    out.push({ date, names, pile, batchingDate: parseDate(r[9]), entries });
  }
  return out;
}

function capacityOf(e: TrackerEntry): number {
  return e.bins * BIN_CAPACITY_LITRES + e.buckets * BUCKET_CAPACITY_LITRES;
}

/** Fleet-wide average fullness over all measured entries (0..1) and container count. */
export function fleetFullness(tracker: TrackerRow[]): { fullness: number; containers: number } {
  let l = 0, cap = 0, n = 0;
  for (const t of tracker) for (const e of t.entries) {
    if (e.estimated) continue;
    const c = capacityOf(e);
    if (c <= 0) continue;
    l += e.litres; cap += c; n += e.bins + e.buckets;
  }
  return { fullness: cap > 0 ? l / cap : 0, containers: n };
}

// ───────────────────────── output types ─────────────────────────

export interface MonthRow {
  month: string; pickups: number; bins: number; buckets: number;
  litres: number; kg: number;
  co2eVsLandfillKg: number; // headline: vs the red bin
  co2eLandfillKg: number; // of which landfill methane (net of our composting)
  co2eTransportKg: number; // of which trucking to landfill
  co2eVsGreenBinKg: number; // secondary: vs the council food-scraps bin
  measuredLitres: number; estimatedLitres: number;
}
export interface YearRow extends Omit<MonthRow, 'month'> { year: number }
export interface PileRow {
  pile: string; batchingDate: string | null; firstCollection: string; lastCollection: string; containers: number;
}

export interface ImpactReport {
  business: string;
  settings: {
    kgPerFullBin: number; kgPerFullBinIsDefault: boolean;
    avgFullnessPct: number; fullnessSource: 'business' | 'fleet'; fullnessMeasuredContainers: number;
    fleetAvgFullnessPct: number;
    yearStartMonth: number;
  };
  months: MonthRow[]; // oldest first, gaps filled with zero months
  years: YearRow[]; // oldest first
  totals: Omit<MonthRow, 'month'> & { measuredSharePct: number };
  firstCollection: string | null;
  latestCollection: string | null;
  piles: PileRow[];
  stillMaturing: number;
  methodology: Record<string, unknown>;
  generatedAt: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Acc { pickups: number; bins: number; buckets: number; litres: number; kg: number; co2eVsLandfillKg: number; co2eLandfillKg: number; co2eTransportKg: number; co2eVsGreenBinKg: number; measuredLitres: number; estimatedLitres: number }
const blank = (): Acc => ({ pickups: 0, bins: 0, buckets: 0, litres: 0, kg: 0, co2eVsLandfillKg: 0, co2eLandfillKg: 0, co2eTransportKg: 0, co2eVsGreenBinKg: 0, measuredLitres: 0, estimatedLitres: 0 });
/** Adds the emissions for a mass of waste to an accumulator. */
function addCo2e(a: Acc, kg: number, garden: boolean) {
  const landfill = kg * (garden ? LANDFILL_PART_PER_KG_GARDEN : LANDFILL_PART_PER_KG_FOOD);
  const transport = kg * TRANSPORT_LANDFILL_PER_KG;
  a.co2eLandfillKg += landfill;
  a.co2eTransportKg += transport;
  a.co2eVsLandfillKg += landfill + transport - kg * GREEN_LOOP_TRANSPORT_KG_CO2E_PER_KG;
  a.co2eVsGreenBinKg += kg * AVOIDED_VS_GREEN_BIN_PER_KG;
}
function add(a: Acc, b: Acc) { for (const k of Object.keys(a) as (keyof Acc)[]) a[k] += b[k]; }
function round(a: Acc): Acc {
  return { pickups: a.pickups, bins: r2(a.bins), buckets: r2(a.buckets), litres: r1(a.litres), kg: r1(a.kg), co2eVsLandfillKg: r1(a.co2eVsLandfillKg), co2eLandfillKg: r1(a.co2eLandfillKg), co2eTransportKg: r1(a.co2eTransportKg), co2eVsGreenBinKg: r1(a.co2eVsGreenBinKg), measuredLitres: r1(a.measuredLitres), estimatedLitres: r1(a.estimatedLitres) };
}

// ───────────────────────── main calculation ─────────────────────────

export function computeImpact(
  invoicingRows: Row[],
  binTrackerRows: Row[],
  settings: ImpactSettings,
  today: Date = new Date(),
): ImpactReport {
  const names = nameSet(settings);
  const tracker = parseBinTracker(binTrackerRows);
  const todayS = todayIso(today);
  const kgPerFullBin = settings.kgPerFullBin && settings.kgPerFullBin > 0 ? settings.kgPerFullBin : DEFAULT_KG_PER_FULL_BIN;
  const kgPerLitre = kgPerFullBin / BIN_CAPACITY_LITRES;

  // Fullness
  const fleet = fleetFullness(tracker);
  let bl = 0, bcap = 0, bn = 0;
  for (const t of tracker) for (const e of t.entries) {
    if (e.estimated || !names.has(norm(e.name))) continue;
    const c = capacityOf(e);
    if (c <= 0) continue;
    bl += e.litres; bcap += c; bn += e.bins + e.buckets;
  }
  const fullnessSource: 'business' | 'fleet' = bcap > 0 ? 'business' : 'fleet';
  const fullness = bcap > 0 ? bl / bcap : fleet.fullness;
  const fullnessContainers = bcap > 0 ? bn : fleet.containers;

  // Measured litres on each collection date for this business
  const measuredByDate = new Map<string, number>();
  for (const t of tracker) for (const e of t.entries) {
    if (e.estimated || !names.has(norm(e.name))) continue;
    measuredByDate.set(t.date, (measuredByDate.get(t.date) ?? 0) + e.litres);
  }

  const months = new Map<string, Acc>();
  const monthAcc = (m: string) => { let a = months.get(m); if (!a) { a = blank(); months.set(m, a); } return a; };
  const dates: string[] = [];

  // Invoicing pickups
  const firstInv = firstInvoicingDate(invoicingRows);
  const pickups = parseInvoicingPickups(invoicingRows, settings.business, today);
  for (const p of pickups) {
    const k = containerKind(p.binType);
    const measured = measuredByDate.get(p.date);
    const litres = measured !== undefined ? measured : p.count * k.litres * fullness;
    const kg = litres * kgPerLitre;
    const a = monthAcc(p.date.slice(0, 7));
    a.pickups += 1;
    if (k.kind === 'bin') a.bins += p.count; else a.buckets += p.count;
    a.litres += litres; a.kg += kg;
    addCo2e(a, kg, k.garden);
    if (measured !== undefined) a.measuredLitres += litres; else a.estimatedLitres += litres;
    dates.push(p.date);
  }

  // Pre-invoicing estimate from Bin Tracker rows
  const preDates = new Map<string, Set<string>>();
  if (firstInv) {
    for (const t of tracker) {
      if (t.date >= firstInv || t.date > todayS || !t.names.length) continue;
      const mine = t.names.filter((n) => names.has(norm(n))).length;
      if (!mine) continue;
      const share = mine / t.names.length;
      const litres = share * BIN_CAPACITY_LITRES * fleet.fullness;
      const kg = litres * kgPerLitre;
      const a = monthAcc(t.date.slice(0, 7));
      a.bins += share; a.litres += litres; a.kg += kg;
      addCo2e(a, kg, false);
      a.estimatedLitres += litres;
      const s = preDates.get(t.date.slice(0, 7)) ?? new Set();
      s.add(t.date); preDates.set(t.date.slice(0, 7), s);
      dates.push(t.date);
    }
    for (const [m, s] of preDates) monthAcc(m).pickups += s.size; // distinct collection days
  }

  // Monthly rows with gaps filled
  const keys = [...months.keys()].sort();
  const monthRows: MonthRow[] = [];
  if (keys.length) {
    let [y, m] = keys[0].split('-').map(Number);
    const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      monthRows.push({ month: key, ...round(months.get(key) ?? blank()) });
      if (++m > 12) { m = 1; y++; }
    }
  }

  // Yearly + totals from unrounded accumulators
  const yearAcc = new Map<number, Acc>();
  const total = blank();
  for (const [k, a] of months) {
    const y = +k.slice(0, 4);
    if (!yearAcc.has(y)) yearAcc.set(y, blank());
    add(yearAcc.get(y)!, a); add(total, a);
  }
  const years: YearRow[] = [...yearAcc.keys()].sort().map((y) => ({ year: y, ...round(yearAcc.get(y)!) }));
  const tr = round(total);

  // Piles
  const pileMap = new Map<string, { batching: string | null; first: string; last: string; n: number }>();
  let stillMaturing = 0;
  for (const t of tracker) {
    const mine = t.names.filter((n) => names.has(norm(n))).length;
    if (!mine) continue;
    if (!t.pile) { stillMaturing += 1; continue; }
    const share = mine / t.names.length;
    const p = pileMap.get(t.pile) ?? { batching: null, first: t.date, last: t.date, n: 0 };
    p.n += share;
    if (t.batchingDate && (!p.batching || t.batchingDate < p.batching)) p.batching = t.batchingDate;
    if (t.date < p.first) p.first = t.date;
    if (t.date > p.last) p.last = t.date;
    pileMap.set(t.pile, p);
  }
  const piles: PileRow[] = [...pileMap].map(([pile, p]) => ({
    pile, batchingDate: p.batching, firstCollection: p.first, lastCollection: p.last, containers: r2(p.n),
  })).sort((a, b) => (b.batchingDate ?? b.lastCollection).localeCompare(a.batchingDate ?? a.lastCollection));

  dates.sort();

  return {
    business: settings.business.trim(),
    settings: {
      kgPerFullBin,
      kgPerFullBinIsDefault: !(settings.kgPerFullBin && settings.kgPerFullBin > 0),
      avgFullnessPct: r1(fullness * 100),
      fullnessSource,
      fullnessMeasuredContainers: fullnessContainers,
      fleetAvgFullnessPct: r1(fleet.fullness * 100),
      yearStartMonth: settings.yearStartMonth && settings.yearStartMonth >= 1 && settings.yearStartMonth <= 12 ? Math.floor(settings.yearStartMonth) : 1,
    },
    months: monthRows,
    years,
    totals: { ...tr, measuredSharePct: tr.litres > 0 ? r1((tr.measuredLitres / tr.litres) * 100) : 0 },
    firstCollection: dates[0] ?? null,
    latestCollection: dates[dates.length - 1] ?? null,
    piles,
    stillMaturing,
    methodology: {
      litresPerBin: BIN_CAPACITY_LITRES,
      litresPerBucket: BUCKET_CAPACITY_LITRES,
      kgPerFullBin,
      factors: {
        foodWasteLandfillGasRecoveryKgCo2ePerKg: FACTORS.foodLandfillGasRecovery,
        gardenWasteLandfillGasRecoveryKgCo2ePerKg: FACTORS.gardenLandfillGasRecovery,
        compostingKgCo2ePerKg: FACTORS.composting,
        truckKgCo2ePerTonneKm: TRUCK_KG_CO2E_PER_TONNE_KM,
        redBinLandfillKm: RED_BIN_LANDFILL_KM,
        councilFoodScrapsKm: COUNCIL_FOOD_SCRAPS_KM,
        redBinTransportKgCo2ePerKg: TRANSPORT_LANDFILL_PER_KG,
        councilTransportKgCo2ePerKg: TRANSPORT_COUNCIL_PER_KG,
        greenLoopTransportKgCo2ePerKg: GREEN_LOOP_TRANSPORT_KG_CO2E_PER_KG,
        avoidedVsLandfillPerKgFood: Math.round(AVOIDED_PER_KG_FOOD * 1e6) / 1e6,
        avoidedVsLandfillPerKgGarden: Math.round(AVOIDED_PER_KG_GARDEN * 1e6) / 1e6,
        avoidedVsGreenBinPerKg: Math.round(AVOIDED_VS_GREEN_BIN_PER_KG * 1e6) / 1e6,
      },
      sources: [
        { label: 'NZ Ministry for the Environment, Measuring Emissions Catalogue 2026 (materials and waste)', url: SOURCE_URL },
        { label: 'MfE Measuring Emissions Catalogue 2026, freight (Table 8.11, long-haul heavy truck)', url: FREIGHT_SOURCE_URL },
        { label: 'NPDC: where red-bin rubbish goes (Bonny Glen, Marton)', url: 'https://www.npdc.govt.nz/zero-waste/faqs/' },
        { label: 'NPDC: where food scraps go (Hampton Downs)', url: 'https://www.npdc.govt.nz/zero-waste/recycling-and-rubbish-collection/your-food-scraps-bin/' },
      ],
      source: 'NZ Ministry for the Environment, Measuring Emissions Catalogue 2026',
      sourceUrl: SOURCE_URL,
      landfillAssumption: 'Landfill with gas recovery (New Plymouth waste goes to Bonny Glen, which captures landfill gas). This is the conservative choice.',
      assumptions: [
        'Headline figure, avoided vs the red bin: (landfill-with-gas-recovery factor + ' + RED_BIN_LANDFILL_KM + ' km trucking to landfill - composting factor) x kg diverted. Garden-waste bins use the garden-waste landfill factor.',
        'Secondary figure, avoided vs the council food-scraps bin: council trucks scraps about ' + COUNCIL_FOOD_SCRAPS_KM + ' km to Hampton Downs for composting, so composting emissions cancel and only that trucking (' + COUNCIL_FOOD_SCRAPS_KM + ' km x ' + TRUCK_KG_CO2E_PER_TONNE_KM + ' kg CO2e per tonne-km) is avoided. The council local collection leg is ignored (electric trucks), which is conservative.',
        'Green Loop collects with an electric van charged from solar panels, so its transport emissions are counted as zero. Our composting still emits ' + FACTORS.composting + ' kg CO2e per kg.',
        'Volumes for pickups without a measured record = containers collected x container size x average fullness.',
        'Collections before the invoicing records began (' + (firstInv ?? 'n/a') + ') are estimated from farm bin records, splitting each farm bin equally between the businesses it contained.',
        'Weight is estimated from volume using the kg-per-full-bin density above; it is not weighed.',
      ],
      invoicingStart: firstInv,
    },
    generatedAt: new Date().toISOString(),
  };
}
