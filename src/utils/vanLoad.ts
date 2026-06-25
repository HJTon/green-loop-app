// Van load accounting. Only *bins* count toward the van's capacity — buckets and
// soil/green-waste containers ride along in spare space, so they never push a day
// over the limit. This is the single source of truth for "how full is the van",
// used both by the Load-van summary and the split planner.

import type { Client, RouteStop } from '@/types';

// A van holds 12 bins. Above this a day is offered the option to split into two
// runs (see SplitPlannerPage). Buckets/soil are not constrained by this.
export const BIN_CAPACITY = 12;

// Bins this client contributes to the van load. Buckets and soil contribute 0.
export function binLoad(client: Client): number {
  if (client.collection_type !== 'bins') return 0;
  return client.expected_quantity || 1;
}

// Total bins across a set of route stops. Stops whose client can't be resolved
// are skipped (matches how the rest of the app treats dangling client ids).
export function binsForStops(
  stops: RouteStop[],
  getClientById: (id: string) => Client | undefined
): number {
  let total = 0;
  for (const stop of stops) {
    const client = getClientById(stop.client_id);
    if (client) total += binLoad(client);
  }
  return total;
}
