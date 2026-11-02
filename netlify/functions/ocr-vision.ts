import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

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

// Collapse an exact whole-string duplication, e.g. "14651465" -> "1465"
// (a reflection or twin sticker read as one run of digits).
function collapseDuplication(s: string): string {
  const n = s.length;
  if (n >= 6 && n % 2 === 0) {
    const half = s.slice(0, n / 2);
    if (half + half === s) return half;
  }
  return s;
}

// Pick the single most plausible serial from Vision's annotations rather than
// concatenating every detected character. Vision returns the full text in
// annotation[0] and one annotation per detected word in [1..]. We prefer the
// longest individual token of serial shape (containing at least one digit),
// then fall back to the cleaned full text.
function extractSerial(
  annotations: Array<{ description?: string }>
): string {
  const clean = (t: string) => t.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  const tokens = annotations
    .slice(1)
    .map(a => clean(a.description || ''))
    .filter(t => /^[A-Za-z0-9]{3,15}$/.test(t) && /[0-9]/.test(t));

  if (tokens.length > 0) {
    // Longest token wins; tie-break on the one with the most digits.
    tokens.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const digits = (s: string) => (s.match(/[0-9]/g) || []).length;
      return digits(b) - digits(a);
    });
    return collapseDuplication(tokens[0]);
  }

  // No clean single token — fall back to the whole-frame text, de-duplicated.
  const fullCleaned = clean(annotations[0]?.description || '');
  return collapseDuplication(fullCleaned);
}

export default async (request: Request, context: Context): Promise<Response> => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') return preflightResponse();
  const authFail = checkAuth(request);
  if (authFail) return authFail;

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
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // First annotation contains ALL detected text concatenated; the rest are
    // individual word/token annotations. We pick the single best serial token
    // rather than gluing everything together, so a duplicate sticker or
    // reflection caught in frame can't double the number.
    const fullText = textAnnotations[0].description || '';
    const cleaned = extractSerial(textAnnotations);

    // Calculate confidence based on whether we found reasonable text
    const confidence = cleaned.length >= 3 ? 0.9 : 0.5;

    const result: VisionResponse = {
      text: fullText,
      confidence,
      suggestedSerial: cleaned,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
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
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
}
