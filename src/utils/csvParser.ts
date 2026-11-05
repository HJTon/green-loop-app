// CSV parsing utilities for Google Sheet data

import type { DateColumn } from '@/types/sheet';

/**
 * Parse CSV content into a 2D array of strings
 * Handles quoted fields with commas and newlines
 */
export function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
      } else if (char === ',') {
        // Field separator
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        // Row separator
        currentRow.push(currentField.trim());
        if (currentRow.some(field => field !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        if (char === '\r') i++; // Skip \n in \r\n
      } else if (char !== '\r') {
        currentField += char;
      }
    }
  }

  // Don't forget the last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Parse a date string from sheet header (e.g., "12 Feb 2026", "4 Feb 2026")
 * Returns null if parsing fails
 */
export function parseSheetDate(dateString: string): Date | null {
  if (!dateString || dateString.trim() === '') return null;

  const trimmed = dateString.trim();

  // Try format: "12 Feb 2026" or "4 Feb 2026"
  const monthNames: Record<string, number> = {
    'jan': 0, 'january': 0,
    'feb': 1, 'february': 1,
    'mar': 2, 'march': 2,
    'apr': 3, 'april': 3,
    'may': 4,
    'jun': 5, 'june': 5,
    'jul': 6, 'july': 6,
    'aug': 7, 'august': 7,
    'sep': 8, 'september': 8,
    'oct': 9, 'october': 9,
    'nov': 10, 'november': 10,
    'dec': 11, 'december': 11
  };

  // Pattern: "12 Feb 2026" or "4 Feb 2026"
  const dayMonthYear = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dayMonthYear) {
    const day = parseInt(dayMonthYear[1], 10);
    const monthStr = dayMonthYear[2].toLowerCase();
    const year = parseInt(dayMonthYear[3], 10);
    const month = monthNames[monthStr];

    if (month !== undefined && day >= 1 && day <= 31) {
      return new Date(year, month, day);
    }
  }

  // Try format: "12/02/2026" (DD/MM/YYYY)
  const slashFormat = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashFormat) {
    const day = parseInt(slashFormat[1], 10);
    const month = parseInt(slashFormat[2], 10) - 1; // 0-indexed
    const year = parseInt(slashFormat[3], 10);

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day);
    }
  }

  // Try ISO format: "2026-02-12"
  const isoFormat = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoFormat) {
    const year = parseInt(isoFormat[1], 10);
    const month = parseInt(isoFormat[2], 10) - 1;
    const day = parseInt(isoFormat[3], 10);

    return new Date(year, month, day);
  }

  return null;
}

/**
 * Format a Date object to match sheet date format for comparison
 * Returns format like "2026-02-12" for reliable comparison
 */
export function formatDateForComparison(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a cell value indicates a scheduled pickup
 */
export function isPickupMarked(cellValue: string): boolean {
  if (!cellValue) return false;
  const normalized = cellValue.toLowerCase().trim();
  // Covers 'pick up' / 'pickup' / 'pick-up' plus overwritten markers like
  // 'Pick Up (Aborted)' — those still need to show up as a route stop.
  return normalized.startsWith('pick');
}

/**
 * Parse date columns from CSV headers (starting at column index startIndex)
 * Returns array of DateColumn objects for valid date headers
 */
export function parseDateColumns(headers: string[], startIndex: number): DateColumn[] {
  const dateColumns: DateColumn[] = [];

  for (let i = startIndex; i < headers.length; i++) {
    const header = headers[i];
    const date = parseSheetDate(header);

    if (date) {
      dateColumns.push({
        index: i,
        date,
        dateString: header
      });
    }
  }

  return dateColumns;
}

/**
 * Find the column index for a specific date
 * Returns -1 if not found
 */
export function findDateColumnIndex(dateColumns: DateColumn[], targetDate: Date): number {
  const targetStr = formatDateForComparison(targetDate);

  for (const col of dateColumns) {
    if (formatDateForComparison(col.date) === targetStr) {
      return col.index;
    }
  }

  return -1;
}

/**
 * Get all dates that have pickups scheduled (have at least one "Pick Up" cell)
 */
export function getDatesWithPickups(
  dataRows: string[][],
  dateColumns: DateColumn[]
): Date[] {
  const datesWithPickups: Set<string> = new Set();

  for (const row of dataRows) {
    for (const dateCol of dateColumns) {
      const cellValue = row[dateCol.index] || '';
      if (isPickupMarked(cellValue)) {
        datesWithPickups.add(formatDateForComparison(dateCol.date));
      }
    }
  }

  return Array.from(datesWithPickups)
    .map(dateStr => {
      // Parse "YYYY-MM-DD" format correctly in local timezone
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    })
    .sort((a, b) => a.getTime() - b.getTime());
}
