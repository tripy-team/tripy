/**
 * Email utility for TripsHacker — sends via AWS SES.
 * Falls back to console logging when SES is not configured.
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const SENDER_EMAIL =
  process.env.SES_SENDER_EMAIL || "noreply@tripy.app";
const FRONTEND_URL =
  process.env.NEXT_PUBLIC_FRONTEND_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://tripy.app";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

function getSESClient(): SESClient | null {
  // SES only works in server environments with credentials
  if (typeof window !== "undefined") return null;
  try {
    return new SESClient({ region: AWS_REGION });
  } catch {
    return null;
  }
}

async function sendRawEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const client = getSESClient();
  if (!client) {
    console.log("[email] SES not available — logging email instead:");
    console.log(`  To: ${params.to}`);
    console.log(`  Subject: ${params.subject}`);
    console.log(`  Body: ${params.text}`);
    return;
  }
  const command = new SendEmailCommand({
    Source: SENDER_EMAIL,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: params.subject, Charset: "UTF-8" },
      Body: {
        Html: { Data: params.html, Charset: "UTF-8" },
        Text: { Data: params.text, Charset: "UTF-8" },
      },
    },
  });
  try {
    await client.send(command);
  } catch (err) {
    console.error("[email] SES send failed:", err);
    // Don't throw — email failure shouldn't break the request
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function sendFormInvitation(params: {
  recipientEmail: string;
  recipientName?: string;
  clientName: string;
  advisorName: string;
  formTitle: string;
  formLink: string;
  expiresAt: Date;
}): Promise<void> {
  const { recipientEmail, recipientName, advisorName, formTitle, formLink, expiresAt } = params;
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const expiry = expiresAt.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;color:#334155;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#3B82F6 0%,#1D4ED8 100%);padding:30px;border-radius:16px 16px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">TripsHacker</h1>
  </div>
  <div style="background:white;padding:30px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 16px 16px;">
    <p style="margin-top:0;">${greeting}</p>
    <p>Your trip hacker <strong>${advisorName}</strong> has sent you a form to complete: <strong>${formTitle}</strong>.</p>
    <p>This takes about 3–5 minutes and helps your trip hacker plan the perfect trip for you.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${formLink}" style="display:inline-block;background:#3B82F6;color:white;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;">Complete Your Form</a>
    </div>
    <p style="color:#64748B;font-size:13px;">This link expires on ${expiry}. If you have questions, reply to this email or contact your trip hacker directly.</p>
  </div>
  <div style="text-align:center;padding:20px;color:#94A3B8;font-size:12px;">
    <p>© ${new Date().getFullYear()} TripsHacker. Better travel starts here.</p>
  </div>
</body>
</html>`;

  const text = `${greeting}

Your trip hacker ${advisorName} has sent you a form to complete: ${formTitle}.

Complete your form here: ${formLink}

This link expires on ${expiry}.

© ${new Date().getFullYear()} TripsHacker`;

  await sendRawEmail({
    to: recipientEmail,
    subject: `${advisorName} sent you a travel form`,
    html,
    text,
  });
}

export async function sendFormCompletionNotification(params: {
  advisorEmail: string;
  advisorName: string;
  clientName: string;
  formTitle: string;
  clientUrl: string;
  formVariant: string;
}): Promise<void> {
  const { advisorEmail, advisorName, clientName, formTitle, clientUrl } = params;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;color:#334155;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#10B981 0%,#059669 100%);padding:30px;border-radius:16px 16px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">TripsHacker</h1>
  </div>
  <div style="background:white;padding:30px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 16px 16px;">
    <p style="margin-top:0;">Hi ${advisorName},</p>
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px;margin:20px 0;">
      <p style="margin:0;color:#166534;">✅ <strong>${clientName}</strong> has completed their form: <strong>${formTitle}</strong></p>
    </div>
    <p>Their responses have been automatically added to their preference profile. Review their answers and plan their next trip.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${clientUrl}" style="display:inline-block;background:#10B981;color:white;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;">View Client Profile</a>
    </div>
  </div>
  <div style="text-align:center;padding:20px;color:#94A3B8;font-size:12px;">
    <p>© ${new Date().getFullYear()} TripsHacker. Better travel starts here.</p>
  </div>
</body>
</html>`;

  const text = `Hi ${advisorName},

${clientName} has completed their form: ${formTitle}.

Their responses have been automatically added to their preference profile.

View the client profile: ${clientUrl}

© ${new Date().getFullYear()} TripsHacker`;

  await sendRawEmail({
    to: advisorEmail,
    subject: `${clientName} completed their travel form`,
    html,
    text,
  });
}

export async function sendFormSubmissionConfirmation(params: {
  recipientEmail: string;
  recipientName?: string;
  advisorName: string;
  formTitle: string;
  answers: Array<{ label: string; value: string }>;
}): Promise<void> {
  const { recipientEmail, recipientName, advisorName, formTitle, answers } = params;
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";

  const answersHtml = answers
    .map(
      ({ label, value }) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #F1F5F9;color:#64748B;font-size:14px;vertical-align:top;width:45%;">${label}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #F1F5F9;color:#1E293B;font-size:14px;vertical-align:top;">${value || "—"}</td>
    </tr>`,
    )
    .join("");

  const answersText = answers
    .map(({ label, value }) => `${label}: ${value || "—"}`)
    .join("\n");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;color:#334155;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#3B82F6 0%,#1D4ED8 100%);padding:30px;border-radius:16px 16px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">TripsHacker</h1>
  </div>
  <div style="background:white;padding:30px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 16px 16px;">
    <p style="margin-top:0;">${greeting}</p>
    <p>Thanks for completing <strong>${formTitle}</strong>. Your advisor <strong>${advisorName}</strong> will review your responses shortly.</p>
    <p style="font-weight:600;margin-bottom:8px;">Your submitted answers:</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
      ${answersHtml}
    </table>
    <p style="color:#64748B;font-size:13px;margin-top:24px;">If anything looks incorrect or you'd like to update your preferences, reach out to your trip hacker directly.</p>
  </div>
  <div style="text-align:center;padding:20px;color:#94A3B8;font-size:12px;">
    <p>© ${new Date().getFullYear()} TripsHacker. Better travel starts here.</p>
  </div>
</body>
</html>`;

  const text = `${greeting}

Thanks for completing ${formTitle}. Your advisor ${advisorName} will review your responses shortly.

Your submitted answers:
${answersText}

If anything looks incorrect, reach out to your trip hacker directly.

© ${new Date().getFullYear()} TripsHacker`;

  await sendRawEmail({
    to: recipientEmail,
    subject: `Your ${formTitle} has been received`,
    html,
    text,
  });
}

export function buildFormLink(token: string): string {
  return `${FRONTEND_URL}/intake/${token}`;
}

export function buildClientUrl(clientId: string): string {
  return `${FRONTEND_URL}/clients/${clientId}?tab=forms`;
}

