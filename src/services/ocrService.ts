import { apiFetch } from '@/utils/apiClient';

export interface OcrResult {
  text: string;
  confidence: number;
  suggestedSerial: string;
}

// Recognize serial number from image using Google Cloud Vision API
export async function recognizeSerialNumber(imageData: string): Promise<OcrResult> {
  try {
    const response = await apiFetch('/.netlify/functions/ocr-vision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageData }),
    });

    if (!response.ok) {
      throw new Error(`OCR request failed: ${response.status}`);
    }

    const result = await response.json();

    return {
      text: result.text || '',
      confidence: result.confidence || 0,
      suggestedSerial: result.suggestedSerial || '',
    };
  } catch (error) {
    console.error('OCR error:', error);
    throw error;
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

  // Check if alphanumeric only
  if (!/^[A-Za-z0-9]+$/.test(cleaned)) {
    return { valid: false, error: 'Serial number should contain only letters and digits' };
  }

  // Check reasonable length (3-15 characters)
  if (cleaned.length < 3) {
    return { valid: false, error: 'Serial number seems too short' };
  }

  if (cleaned.length > 15) {
    return { valid: false, error: 'Serial number seems too long' };
  }

  return { valid: true };
}

// Format serial number for display
export function formatSerialNumber(serial: string): string {
  return serial.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
