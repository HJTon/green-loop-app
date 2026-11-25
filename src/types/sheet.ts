// Types for Google Sheet data integration

// Raw row from Google Sheet / CSV (columns A-L, date columns from M onwards)
export interface SheetRow {
  businessName: string;             // Column A
  address: string;                  // Column B
  contactPerson: string;            // Column C
  phoneNumber: string;              // Column D
  deliveryInstructions: string;     // Column E
  pickupType: 'Week' | 'Fortnight' | 'FourWeek'; // Column F
  startDate: string;                // Column G
  pickupDay: string;                // Column H (day of week)
  payingFrom: string;               // Column I
  binType: 'W-Bins' | 'Bkts' | 'Soil'; // Column K (W-Bins / Bkts / Soil green-waste)
  numberOfBins: number;             // Column K
  extraPickup: string;              // Column L (Paper towels/-)
  // Manual lat/lng override (columns N / O). Null when empty (no override) or
  // when the cell value won't parse as a number — old rows lacking these
  // columns also read as null.
  manualLat: number | null;         // Column N
  manualLng: number | null;         // Column O
  rowIndex: number;                 // Original row number in sheet (for write-back)
  dateColumns: Map<string, string>; // P onwards: date string -> cell value
}

// Parsed pickup for a specific date
export interface SheetPickup {
  businessName: string;
  address: string;
  contactPerson: string;
  phoneNumber: string;
  deliveryInstructions: string;
  binType: 'bins' | 'buckets' | 'soil';
  numberOfBins: number;
  hasPaperTowels: boolean;
  pickupFrequency: 'Weekly' | 'Fortnightly' | 'Four-weekly';
  startDate: string;              // Raw Start Date cell (column H)
  isFirstVisit: boolean;          // True if the target date is this business's first visit
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
