import type { PickupRecord, Client, Collector, BinFullness, DropOffRecord, Farm } from '@/types';
import { getCurrentDate } from './storage';

function formatFullness(fullness: BinFullness[]): string {
  return fullness.join(',');
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportPickupsToCSV(
  pickups: PickupRecord[],
  clients: Client[],
  collectors: Collector[]
): string {
  const headers = [
    'date',
    'time',
    'business_name',
    'address',
    'collection_type',
    'bins_collected',
    'bin_fullness',
    'notes',
    'report_issue',
    'report_action',
    'urgency',
    'collector_name',
    'status',
  ];

  const rows = pickups.map(pickup => {
    const client = clients.find(c => c.id === pickup.client_id);
    const collector = collectors.find(c => c.id === pickup.collector_id);

    return [
      pickup.date,
      pickup.time,
      escapeCSV(client?.business_name || 'Unknown'),
      escapeCSV(client?.address || ''),
      client?.collection_type || '',
      pickup.bins_collected.toString(),
      formatFullness(pickup.bin_fullness),
      escapeCSV(pickup.notes || ''),
      escapeCSV(pickup.report?.issue || ''),
      escapeCSV(pickup.report?.action || ''),
      pickup.report?.urgency || '',
      collector?.name || 'Unknown',
      pickup.status,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export function exportTodayData(
  pickups: PickupRecord[],
  clients: Client[],
  collectors: Collector[],
  dropOff?: DropOffRecord | null,
  farms?: Farm[]
): void {
  const today = getCurrentDate();
  const todayPickups = pickups.filter(p => p.date === today);

  if (todayPickups.length === 0) {
    alert('No pickups to export for today');
    return;
  }

  let csv = exportPickupsToCSV(todayPickups, clients, collectors);

  // Add drop-off section if available
  if (dropOff && farms) {
    const farm = farms.find(f => f.id === dropOff.farm_id);
    const collector = collectors.find(c => c.id === dropOff.collector_id);

    csv += '\n\n--- DROP OFF ---\n';
    csv += 'date,time,farm_name,address,total_dropped,notes,report_issue,report_action,urgency,collector_name\n';
    csv += [
      dropOff.date,
      dropOff.time,
      escapeCSV(farm?.farm_name || 'Unknown'),
      escapeCSV(farm?.address || ''),
      dropOff.bins_dropped.toString(),
      escapeCSV(dropOff.notes || ''),
      escapeCSV(dropOff.report?.issue || ''),
      escapeCSV(dropOff.report?.action || ''),
      dropOff.report?.urgency || '',
      collector?.name || 'Unknown',
    ].join(',');
  }

  const filename = `greenloop_collections_${today}.csv`;

  downloadCSV(csv, filename);
}
