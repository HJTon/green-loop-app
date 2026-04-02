import type { PickupReport } from '@/types';

interface SendReportEmailParams {
  businessName: string;
  collectorName: string;
  reportType: 'pickup' | 'dropoff';
  report: PickupReport;
}

/**
 * Send a report email notification to accounts
 * Silently fails if email service is not configured
 */
export async function sendReportEmail({
  businessName,
  collectorName,
  reportType,
  report,
}: SendReportEmailParams): Promise<boolean> {
  // Don't send if no actual report content
  if (!report.issue || report.issue.trim() === '') {
    return false;
  }

  try {
    const now = new Date();
    const date = now.toLocaleDateString('en-NZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const time = now.toLocaleTimeString('en-NZ', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const response = await fetch('/.netlify/functions/send-report-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        businessName,
        collectorName,
        reportType,
        urgency: report.urgency,
        issue: report.issue,
        date,
        time,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to send report email:', error);
      return false;
    }

    const result = await response.json();
    console.log('Report email sent:', result);
    return true;

  } catch (error) {
    // Silently fail - email is a nice-to-have, not critical
    console.error('Error sending report email:', error);
    return false;
  }
}
