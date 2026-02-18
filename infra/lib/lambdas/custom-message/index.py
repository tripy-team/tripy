"""
Cognito Custom Message Lambda trigger.

Intercepts ForgotPassword messages and replaces the default "here is your code"
email with a clickable reset link that embeds the email + code as query params:

    https://<FRONTEND_URL>/reset-password?email=<email>&code=<code>

Sign-up confirmation emails are left untouched (Cognito sends the 6-digit code).
"""

import os
import urllib.parse

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://tripy.app")


def handler(event, context):
    trigger = event.get("triggerSource", "")

    if trigger == "CustomMessage_ForgotPassword":
        email = event["request"]["userAttributes"].get("email", "")
        code = event["request"]["codeParameter"]

        encoded_email = urllib.parse.quote(email, safe="")
        reset_url = (
            f"{FRONTEND_URL}/reset-password"
            f"?email={encoded_email}&code={code}"
        )

        event["response"]["emailSubject"] = "Reset your Tripy password"
        event["response"]["emailMessage"] = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1e40af;">Reset your password</h2>
            <p>We received a request to reset the password for your Tripy account.
               Click the button below to choose a new password.</p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{reset_url}"
                   style="display: inline-block; background: #2563eb; color: white;
                          text-decoration: none; padding: 14px 32px; border-radius: 10px;
                          font-weight: 600;">
                    Reset password
                </a>
            </div>
            <p style="color: #64748b; font-size: 14px;">
                This link expires in 1 hour.
                If you didn't request this, you can safely ignore this email.
            </p>
            <p style="color: #94a3b8; font-size: 12px;">
                &copy; 2026 Tripy &middot; Book with confidence.
            </p>
        </div>
        """

    return event
