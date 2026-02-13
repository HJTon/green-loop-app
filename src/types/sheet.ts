// Types for Google Sheet data integration

// Raw row from Google Sheet / CSV (columns A-J)
export interface SheetRow {
  businessName: string;           // Column A
  address: string;                // Column B
  deliveryInstructions: string;   // Column C
  pickupType: 'Week' | 'Fortnight'; // Column D
  startDate: string;              // Column E
  pickupDay: string;              // Column F (day of week)
  payingFrom: string;             // Column G
  binType: 'W-Bins' | 'Bkts';     // Column H
  numberOfBins: number;           // Column I
  extraPickup: string;            // Column J (Paper towels/-)
  rowIndex: number;               // Original row number in sheet (for write-back)
  dateColumns: Map<string, string>; // K onwards: date string -> cell value
}

// Parsed pickup for a specific date
export interface SheetPickup {
  businessName: string;
  address: string;
  deliveryInstructions: string;
  binType: 'bins' | 'buckets';
  numberOfBins: number;
  hasPaperTowels: boolean;
  pickupFrequency: 'Weekly' | 'Fortnightly';
  rowIndex: number;               // For writing back
  dateColumnIndex: number;        // Column index for the date
}

// Pending write operation (for offline tracking)
export interface PendingWrite {
  id: string;
  rowIndex: number;               // Row in sheet (0-indexed from data rows)
  dateColumnIndex: number;        // Column index for the date
  value: string;                  // The bin count to write
  businessName: string;           // For display purposes
  date: string;                   // Date of the pickup
  timestamp: string;              // When the write was queued
}

// Date column info
export interface DateColumn {
  index: number;                  // Column index (0-based from start of date columns)
  date: Date;                     // Parsed date
  dateString: string;             // Original header string
}
