import type { Config } from '@netlify/functions';
import { getSheetsClient, runImpactSync } from './_lib/impact-settings';
import { syncBusinessList } from './_lib/business-list';
import { syncChaffHighlights } from './_lib/chaff-highlight';

// Runs the same sync as impact-sync daily so new businesses get a report link
// automatically, and adds them to the Bin Tracker's "Content from" dropdown list.
export default async () => {
  const plan = await runImpactSync(false);
  console.log(`impact-sync-daily: added ${plan.added.length}, filled ${plan.filled.length}, writes ${plan.writes.length}`);
  try {
    const list = await syncBusinessList(getSheetsClient());
    console.log(`impact-sync-daily: business list +${list.added.length} (${list.names.length} total)`);
  } catch (e) {
    console.error('impact-sync-daily: business list sync failed', e);
  }
  try {
    const chaff = await syncChaffHighlights(getSheetsClient());
    console.log(`impact-sync-daily: chaff highlights ${chaff.cellsPainted} cells changed (${chaff.cpRows} CP rows, ${chaff.cpCells} CP name cells)`);
  } catch (e) {
    console.error('impact-sync-daily: chaff highlight sync failed', e);
  }
};

export const config: Config = { schedule: '@daily' };
