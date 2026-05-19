/**
 * Email sender using Resend API.
 *
 * Works in Cloudflare Workers (SSR) via the Resend SDK.
 * Falls back to console logging if RESEND_API_KEY is not configured,
 * so local dev and tests don't break without a key.
 */
import { Resend } from 'resend';

const DEFAULT_FROM = 'fanfiction.fyi <noreply@kaleb.one>';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Get a Resend client instance. Creates a new one per request
 * (cheap — just wraps an API key).
 */
function getClient(apiKey: string): Resend {
  return new Resend(apiKey);
}

/**
 * Send an email via Resend.
 *
 * @param apiKey - RESEND_API_KEY from the Cloudflare env
 * @param payload - Email details (to, subject, html, optional text)
 * @returns true if sent successfully, false if skipped or failed
 */
export async function sendEmail(
  apiKey: string | undefined,
  payload: EmailPayload,
  fromAddress?: string,
): Promise<boolean> {
  if (!apiKey) {
    console.log(`[EMAIL] No RESEND_API_KEY configured — skipping send to ${payload.to}`);
    console.log(`[EMAIL] Subject: ${payload.subject}`);
    return false;
  }

  try {
    const resend = getClient(apiKey);
    const { data, error } = await resend.emails.send({
      from: fromAddress || DEFAULT_FROM,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    if (error) {
      console.error(`[EMAIL] Resend error: ${error.name} — ${error.message}`);
      return false;
    }

    console.log(`[EMAIL] Sent to ${payload.to} (id: ${data?.id})`);
    return true;
  } catch (err) {
    console.error('[EMAIL] Failed to send:', err);
    return false;
  }
}

// ─── Templated emails ────────────────────────────────────────────────

/**
 * Send a password reset email.
 */
export async function sendPasswordResetEmail(
  apiKey: string | undefined,
  to: string,
  resetUrl: string,
): Promise<boolean> {
  return sendEmail(apiKey, {
    to,
    subject: 'Reset your password — fanfiction.fyi',
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="font-size: 20px; margin-bottom: 16px;">Reset your password</h1>
        <p style="font-size: 15px; line-height: 1.5; color: #444;">
          We received a request to reset the password for your fanfiction.fyi account.
          Click the button below to choose a new password:
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #1a73e8; color: #fff; text-decoration: none;
                  padding: 12px 24px; border-radius: 8px; font-size: 15px; margin: 16px 0;">
          Reset password
        </a>
        <p style="font-size: 13px; color: #888; line-height: 1.5;">
          This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="font-size: 12px; color: #aaa;">
          If the button doesn't work, copy this link into your browser:<br>
          <a href="${resetUrl}" style="word-break: break-all; color: #1a73e8;">${resetUrl}</a>
        </p>
      </div>
    `,
    text: `Reset your fanfiction.fyi password by visiting this link (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
  });
}

/**
 * Send a notification email (for in-app notifications that warrant email delivery).
 */
export async function sendNotificationEmail(
  apiKey: string | undefined,
  to: string,
  opts: { title: string; body: string; link?: string },
): Promise<boolean> {
  const linkHtml = opts.link
    ? `<a href="${opts.link}" style="display: inline-block; background: #1a73e8; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; margin-top: 12px;">View on fanfiction.fyi</a>`
    : '';
  const linkText = opts.link ? `\n\nView on fanfiction.fyi: ${opts.link}` : '';

  return sendEmail(apiKey, {
    to,
    subject: opts.title,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <h2 style="font-size: 18px; margin-bottom: 12px;">${escHtml(opts.title)}</h2>
        <p style="font-size: 15px; line-height: 1.5; color: #444;">${escHtml(opts.body)}</p>
        ${linkHtml}
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="font-size: 12px; color: #aaa;">— fanfiction.fyi</p>
      </div>
    `,
    text: `${opts.title}\n\n${opts.body}${linkText}\n\n— fanfiction.fyi`,
  });
}

/** Minimal HTML escaper to prevent injection in email templates. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}