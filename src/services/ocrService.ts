import { createWorker } from 'tesseract.js';

export interface OcrResult {
  text: string;
  confidence: number;
  suggestedSerial: string;
}

// Recognize serial number from image
export async function recognizeSerialNumber(imageData: string): Promise<OcrResult> {
  const worker = await createWorker('eng');

  try {
    // Configure for digit recognition
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });

    const { data } = await worker.recognize(imageData);

    // Clean result - expect numeric format like "000032344"
    const cleaned = data.text.replace(/[^0-9]/g, '');

    // Pad with leading zeros if less than 9 digits
    const suggestedSerial = cleaned.padStart(9, '0').slice(-9);

    return {
      text: data.text,
      confidence: data.confidence / 100,
      suggestedSerial,
    };
  } finally {
    await worker.terminate();
  }
}

// Validate serial number format
export function validateSerialNumber(serial: string): {
  valid: boolean;
  error?: string;
} {
  // Remove any whitespace
  const cleaned = serial.trim();

  if (!cleaned) {
    return { valid: false, error: 'Serial number is required' };
  }

  // Check if numeric only
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: 'Serial number should contain only digits' };
  }

  // Check reasonable length (6-12 digits)
  if (cleaned.length < 6) {
    return { valid: false, error: 'Serial number seems too short' };
  }

  if (cleaned.length > 12) {
    return { valid: false, error: 'Serial number seems too long' };
  }

  return { valid: true };
}

// Format serial number for display (add leading zeros if needed)
export function formatSerialNumber(serial: string): string {
  const cleaned = serial.replace(/[^0-9]/g, '');
  return cleaned.padStart(9, '0');
}
