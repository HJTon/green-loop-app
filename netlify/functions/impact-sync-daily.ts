import type { Config } from '@netlify/functions';
import { runImpactSync } from './_lib/impact-settings';

// Runs the same sync as impact-sync daily so new businesses get a report link
// automatically.
export default async () => {
  const plan = await runImpactSync(false);
  console.log(`impact-sync-daily: added ${plan.added.length}, filled ${plan.filled.length}, writes ${plan.writes.length}`);
};

export const config: Config = { schedule: '@daily' };
