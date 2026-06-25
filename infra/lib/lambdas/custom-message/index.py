"""
Cognito Custom Message Lambda trigger.

Customizes two emails:
  - ForgotPassword: a clickable reset link embedding email + code as query params:
        https://<FRONTEND_URL>/reset-password?email=<email>&code=<code>
  - SignUp / ResendCode: a branded 6-digit confirmation code email.

Any message we don't customize is left untouched so Cognito uses its defaults.
"""

import os
import urllib.parse

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://tripshacker.com")


def handler(event, context):
    trigger = event.get("triggerSource", "")

    if trigger in ("CustomMessage_SignUp", "CustomMessage_ResendCode"):
        # {####} is the placeholder Cognito replaces with the verification code.
        code = event["request"]["codeParameter"]

        event["response"]["emailSubject"] = "Your TripsHacker confirmation code"
        event["response"]["emailMessage"] = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1e40af;">Confirm your email</h2>
            <p>Welcome to TripsHacker! Use the code below to verify your email
               address and activate your account.</p>
            <div style="text-align: center; margin: 24px 0;">
                <span style="display: inline-block; background: #f1f5f9; color: #1e293b;
                             font-size: 32px; font-weight: 700; letter-spacing: 8px;
                             padding: 16px 28px; border-radius: 10px;">
                    {code}
                </span>
            </div>
            <p style="color: #64748b; font-size: 14px;">
                This code expires shortly. If you didn't create a TripsHacker
                account, you can safely ignore this email.
            </p>
            <p style="color: #94a3b8; font-size: 12px;">
                &copy; 2026 TripsHacker &middot; Book with confidence.
            </p>
        </div>
        """

    elif trigger == "CustomMessage_ForgotPassword":
        email = event["request"]["userAttributes"].get("email", "")
        code = event["request"]["codeParameter"]

        encoded_email = urllib.parse.quote(email, safe="")
        reset_url = (
            f"{FRONTEND_URL}/reset-password"
            f"?email={encoded_email}&code={code}"
        )

        event["response"]["emailSubject"] = "Reset your TripsHacker password"
        event["response"]["emailMessage"] = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1e40af;">Reset your password</h2>
            <p>We received a request to reset the password for your TripsHacker account.
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
                &copy; 2026 TripsHacker &middot; Book with confidence.
            </p>
        </div>
        """

    return event
