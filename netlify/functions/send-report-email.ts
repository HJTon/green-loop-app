import type { Context } from '@netlify/functions';

interface ReportEmailRequest {
  businessName: string;
  collectorName: string;
  reportType: 'pickup' | 'dropoff';
  urgency: 'normal' | 'urgent';
  issue: string;
  date: string;
  time: string;
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
    const body: ReportEmailRequest = await request.json();
    const { businessName, collectorName, reportType, urgency, issue, date, time } = body;

    // Validate required fields
    if (!issue || !collectorName) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const accountsEmail = process.env.ACCOUNTS_EMAIL || 'accounts@greenloop.co.nz';

    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Build email content
    const isUrgent = urgency === 'urgent';
    const subjectPrefix = isUrgent ? '🚨 URGENT: ' : '';
    const reportTypeLabel = reportType === 'pickup' ? 'Pickup' : 'Drop-off';
    const subject = `${subjectPrefix}${reportTypeLabel} Report - ${businessName || 'Green Loop'}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${isUrgent ? '#dc2626' : '#2D8B4E'}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">
            ${isUrgent ? '🚨 Urgent Report' : '📋 Report to Accounts'}
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
        </div>

        <p style="margin-top: 20px; font-size: 12px; color: #9ca3af; text-align: center;">
          Sent from Green Loop Collector App
        </p>
      </div>
    `;

    const textContent = `
${isUrgent ? '🚨 URGENT REPORT' : 'Report to Accounts'}

Type: ${reportTypeLabel}
Business: ${businessName || 'N/A'}
Collector: ${collectorName}
Date/Time: ${date} at ${time}
Urgency: ${isUrgent ? 'URGENT' : 'Normal'}

Report Details:
${issue}

---
Sent from Green Loop Collector App
    `.trim();

    // Send via Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Green Loop <reports@greenloop.co.nz>',
        to: [accountsEmail],
        subject,
        html: htmlContent,
        text: textContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Resend API error:', errorData);
      return new Response(JSON.stringify({ error: 'Failed to send email', details: errorData }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const result = await response.json();
    console.log('Email sent successfully:', result);

    return new Response(JSON.stringify({ success: true, messageId: result.id }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Send email error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
