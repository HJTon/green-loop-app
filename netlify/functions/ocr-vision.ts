import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

interface VisionRequest {
  imageData: string; // Base64 encoded image
}

interface VisionResponse {
  text: string;
  confidence: number;
  suggestedSerial: string;
  error?: string;
}

// Initialize Google Auth
function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-vision'],
  });
}

export default async (request: Request, context: Context): Promise<Response> => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: VisionRequest = await request.json();
    const { imageData } = body;

    if (!imageData) {
      return new Response(JSON.stringify({
        error: 'No image data provided',
        text: '',
        confidence: 0,
        suggestedSerial: '',
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Remove data URL prefix if present
    const base64Image = imageData.replace(/^data:image\/\w+;base64,/, '');

    // Get authenticated client
    const auth = getGoogleAuth();
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      return new Response(JSON.stringify({
        error: 'Failed to get access token',
        text: '',
        confidence: 0,
        suggestedSerial: '',
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Call Cloud Vision API
    const visionResponse = await fetch(
      'https://vision.googleapis.com/v1/images:annotate',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: base64Image,
              },
              features: [
                {
                  type: 'TEXT_DETECTION',
                  maxResults: 10,
                },
              ],
            },
          ],
        }),
      }
    );

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('Vision API error:', errorText);
      return new Response(JSON.stringify({
        error: `Vision API error: ${visionResponse.status} - ${errorText}`,
        text: '',
        confidence: 0,
        suggestedSerial: '',
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const visionData = await visionResponse.json();

    // Check for API-level errors
    if (visionData.responses?.[0]?.error) {
      const apiError = visionData.responses[0].error;
      console.error('Vision API returned error:', apiError);
      return new Response(JSON.stringify({
        error: apiError.message || 'Vision API error',
        text: '',
        confidence: 0,
        suggestedSerial: '',
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Extract text from response
    const textAnnotations = visionData.responses?.[0]?.textAnnotations;

    if (!textAnnotations || textAnnotations.length === 0) {
      return new Response(JSON.stringify({
        text: '',
        confidence: 0,
        suggestedSerial: '',
        error: 'No text detected in image',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // First annotation contains all detected text
    const fullText = textAnnotations[0].description || '';

    // Clean and extract serial number (alphanumeric only)
    const cleaned = fullText.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    // Calculate confidence based on whether we found reasonable text
    const confidence = cleaned.length >= 3 ? 0.9 : 0.5;

    const result: VisionResponse = {
      text: fullText,
      confidence,
      suggestedSerial: cleaned,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('OCR error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      text: '',
      confidence: 0,
      suggestedSerial: '',
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
