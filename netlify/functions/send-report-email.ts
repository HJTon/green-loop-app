import type { Context } from '@netlify/functions';
import { checkAuth, corsHeaders, preflightResponse } from './_lib/auth';

type OptionalRecipient = 'sophie' | 'mieke' | 'joe';

interface ReportEmailRequest {
  businessName: string;
  collectorName: string;
  reportType: 'pickup' | 'dropoff';
  urgency: 'normal' | 'urgent';
  issue: string;
  date: string;
  time: string;
  photos?: string[];   // URLs (may be relative like "/.netlify/functions/media-serve?key=...")
  recipients?: OptionalRecipient[];  // additional CC recipients beyond the always-on recipient
}

/**
 * Resolve optional recipient slugs to email addresses using env vars.
 * Slugs are validated so the frontend can't send to arbitrary addresses.
 */
function resolveRecipients(slugs: OptionalRecipient[]): string[] {
  const map: Record<OptionalRecipient, string | undefined> = {
    sophie: process.env.REPORT_EMAIL_SOPHIE,
    mieke: process.env.REPORT_EMAIL_MIEKE,
    joe: process.env.REPORT_EMAIL_JOE,
  };
  return slugs
    .filter((s): s is OptionalRecipient => s === 'sophie' || s === 'mieke' || s === 'joe')
    .map(s => map[s])
    .filter((e): e is string => typeof e === 'string' && e.length > 0);
}

/**
 * Convert a photo URL to an absolute URL using the deploy's site URL.
 * Relative paths (e.g. /.netlify/functions/...) are prefixed with the site origin.
 * Data URLs and absolute URLs are returned unchanged.
 */
function toAbsoluteUrl(photo: string, siteUrl: string): string {
  if (photo.startsWith('http://') || photo.startsWith('https://') || photo.startsWith('data:')) {
    return photo;
  }
  const origin = siteUrl.replace(/\/$/, '');
  const path = photo.startsWith('/') ? photo : `/${photo}`;
  return `${origin}${path}`;
}

/**
 * Format subject line: "[Urgent] {Business} pickup - 17 Apr"
 */
function buildSubject(businessName: string, reportType: 'pickup' | 'dropoff', isUrgent: boolean, date: string): string {
  const label = reportType === 'pickup' ? 'pickup' : 'drop-off';
  // Date comes through as "Fri, 17 Apr 2026" from emailService; pull the "17 Apr" part
  const shortDate = (() => {
    const m = date.match(/(\d{1,2}\s+\w+)/);
    return m ? m[1] : date;
  })();
  const prefix = isUrgent ? '[Urgent] ' : '';
  const name = businessName || 'Green Loop';
  return `${prefix}${name} ${label} — ${shortDate}`;
}

export default async (request: Request, _context: Context): Promise<Response> => {
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
    const body: ReportEmailRequest = await request.json();
    const { businessName, collectorName, reportType, urgency, issue, date, time, photos = [], recipients: recipientSlugs = [] } = body;

    // Validate required fields
    if (!issue || !collectorName) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const resendApiKey = process.env.RESEND_API_KEY;

    // Jermaine always receives every report; additional recipients are opt-in per report.
    const primaryRecipient = process.env.REPORT_EMAIL_JERMAINE;
    if (!primaryRecipient) {
      console.error('REPORT_EMAIL_JERMAINE not configured');
      return new Response(JSON.stringify({ error: 'Primary recipient not configured' }), {
        status: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }
    const optional = resolveRecipients(recipientSlugs);
    // De-dup in case Jermaine happens to also be in an optional slot
    const recipients = Array.from(new Set([primaryRecipient, ...optional]));

    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // Resolve the site's public origin for absolute photo URLs.
    // Netlify sets process.env.URL to the main site URL; fall back to the request.
    const siteUrl = process.env.URL || new URL(request.url).origin;
    const absolutePhotos = photos
      .filter(p => typeof p === 'string' && p.length > 0)
      .map(p => toAbsoluteUrl(p, siteUrl));

    // Build email content
    const isUrgent = urgency === 'urgent';
    const reportTypeLabel = reportType === 'pickup' ? 'Pickup' : 'Drop-off';
    const subject = buildSubject(businessName, reportType, isUrgent, date);

    const photosHtml = absolutePhotos.length > 0 ? `
      <div style="margin-top: 20px;">
        <h3 style="margin: 0 0 10px 0; color: #374151; font-size: 16px;">Photos (${absolutePhotos.length}):</h3>
        <div>
          ${absolutePhotos.map((url, i) => `
            <a href="${url}" target="_blank" style="display: inline-block; margin: 0 8px 8px 0;">
              <img src="${url}" alt="Photo ${i + 1}" style="max-width: 220px; max-height: 220px; border-radius: 8px; border: 1px solid #e5e7eb; display: block;" />
            </a>
          `).join('')}
        </div>
      </div>
    ` : '';

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${isUrgent ? '#dc2626' : '#2D8B4E'}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">
            ${isUrgent ? 'Urgent Report' : 'Report to Accounts'}
          </h1>
        </div>

        <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; width: 120px;">Type:</td>
              <td style="padding: 8px 0; font-weight: bold;">${reportTypeLabel}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Business:</td>
              <td style="padding: 8px 0; font-weight: bold;">${businessName || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Collector:</td>
              <td style="padding: 8px 0;">${collectorName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Date/Time:</td>
              <td style="padding: 8px 0;">${date} at ${time}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Urgency:</td>
              <td style="padding: 8px 0;">
                <span style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: bold; ${
                  isUrgent
                    ? 'background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;'
                    : 'background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0;'
                }">
                  ${isUrgent ? 'URGENT' : 'Normal'}
                </span>
              </td>
            </tr>
          </table>

          <div style="margin-top: 20px; padding: 16px; background: white; border-radius: 8px; border: 1px solid #e5e7eb;">
            <h3 style="margin: 0 0 10px 0; color: #374151; font-size: 16px;">Report Details:</h3>
            <p style="margin: 0; color: #4b5563; line-height: 1.6; white-space: pre-wrap;">${issue}</p>
          </div>

          ${photosHtml}
        </div>

        <p style="margin-top: 20px; font-size: 12px; color: #9ca3af; text-align: center;">
          Sent from Green Loop Collector App
        </p>
      </div>
    `;

    const photosText = absolutePhotos.length > 0
      ? `\n\nPhotos:\n${absolutePhotos.map((url, i) => `${i + 1}. ${url}`).join('\n')}`
      : '';

    const textContent = `
${isUrgent ? 'URGENT REPORT' : 'Report to Accounts'}

Type: ${reportTypeLabel}
Business: ${businessName || 'N/A'}
Collector: ${collectorName}
Date/Time: ${date} at ${time}
Urgency: ${isUrgent ? 'URGENT' : 'Normal'}

Report Details:
${issue}${photosText}

---
Sent from Green Loop Collector App
    `.trim();

    // Attach photos so the recipient can download them directly from the email.
    // Resend fetches each `path` URL at send time.
    const attachments = absolutePhotos.map((url, i) => ({
      filename: `photo-${i + 1}.jpg`,
      path: url,
    }));

    // Send via Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Green Loop <noreply@sustainabletaranaki.org.nz>',
        to: recipients,
        subject,
        html: htmlContent,
        text: textContent,
        ...(attachments.length > 0 ? { attachments } : {}),
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Resend API error:', errorData);
      return new Response(JSON.stringify({ error: 'Failed to send email', details: errorData }), {
        status: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const result = await response.json();
    console.log('Email sent successfully:', result);

    return new Response(JSON.stringify({ success: true, messageId: result.id }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send email error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
};
