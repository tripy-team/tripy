"""
Email service using AWS SES for sending notifications.

This service handles sending email notifications for:
- Member approval notifications
- Member denial notifications
- Trip invitations
- Solo plan sharing (magic link)
- Post-result follow-up
- Lock plan prompt
- Booking acknowledgment
- Monitoring alerts
- Gentle conversion nudges
- Support / human touch
"""
import boto3
from botocore.exceptions import ClientError
from typing import Optional, Dict, Any
import logging
import os

logger = logging.getLogger(__name__)

# Configure AWS SES client
session = boto3.Session()
ses_client = session.client(
    "ses",
    region_name=os.environ.get("AWS_REGION", "us-west-2"),
    config=boto3.session.Config(
        connect_timeout=5,
        read_timeout=10,
        retries={"max_attempts": 3, "mode": "standard"},
    ),
)

# Configuration from environment
SENDER_EMAIL = os.environ.get("SES_SENDER_EMAIL", "noreply@tripy.app")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://tripy.app")

# Email templates
TEMPLATES = {
    "member_approved": {
        "subject": "You've been approved to join {trip_name}!",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trip Approval</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">✈️ Tripy</h1>
    </div>
    <div style="background: white; padding: 30px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <h2 style="color: #1E293B; margin-top: 0;">Great news, {member_name}!</h2>
        <p>You've been approved to join <strong>{trip_name}</strong> by the trip organizer, {organizer_name}.</p>
        
        <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0; color: #166534;">✅ You're all set! Your points and preferences have been added to the group pool.</p>
        </div>
        
        <p>The trip organizer will notify you when the optimized itinerary is ready.</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{dashboard_url}" style="display: inline-block; background: #3B82F6; color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600;">View Trip Dashboard</a>
        </div>
        
        <p style="color: #64748B; font-size: 14px;">If you have any questions, reach out to your trip organizer.</p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p>© {year} Tripy. Maximize your travel points.</p>
    </div>
</body>
</html>
""",
        "text": """
Great news, {member_name}!

You've been approved to join "{trip_name}" by the trip organizer, {organizer_name}.

✅ You're all set! Your points and preferences have been added to the group pool.

The trip organizer will notify you when the optimized itinerary is ready.

View your trip dashboard: {dashboard_url}

If you have any questions, reach out to your trip organizer.

---
© {year} Tripy. Maximize your travel points.
""",
    },
    "member_denied": {
        "subject": "Update on your request to join {trip_name}",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trip Update</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">✈️ Tripy</h1>
    </div>
    <div style="background: white; padding: 30px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <h2 style="color: #1E293B; margin-top: 0;">Hi {member_name},</h2>
        <p>We wanted to let you know that your request to join <strong>{trip_name}</strong> was not approved by the trip organizer.</p>
        
        <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0; color: #991B1B;">This could be for various reasons - perhaps the group is full, or there was a change in plans.</p>
        </div>
        
        <p>Don't worry! You can always:</p>
        <ul style="color: #475569;">
            <li>Create your own trip and invite friends</li>
            <li>Join another group trip with a different invite code</li>
            <li>Plan a solo trip to maximize your own points</li>
        </ul>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{home_url}" style="display: inline-block; background: #3B82F6; color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600;">Start Planning</a>
        </div>
        
        <p style="color: #64748B; font-size: 14px;">If you think this was a mistake, please contact the trip organizer directly.</p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p>© {year} Tripy. Maximize your travel points.</p>
    </div>
</body>
</html>
""",
        "text": """
Hi {member_name},

We wanted to let you know that your request to join "{trip_name}" was not approved by the trip organizer.

This could be for various reasons - perhaps the group is full, or there was a change in plans.

Don't worry! You can always:
- Create your own trip and invite friends
- Join another group trip with a different invite code
- Plan a solo trip to maximize your own points

Start planning: {home_url}

If you think this was a mistake, please contact the trip organizer directly.

---
© {year} Tripy. Maximize your travel points.
""",
    },
    "trip_invitation": {
        "subject": "You're invited to join {trip_name} on Tripy!",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trip Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">✈️ Tripy</h1>
    </div>
    <div style="background: white; padding: 30px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <h2 style="color: #1E293B; margin-top: 0;">You're invited! ✨</h2>
        <p><strong>{organizer_name}</strong> has invited you to join their group trip: <strong>{trip_name}</strong></p>
        
        <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #1E40AF;">Trip Details:</p>
            <p style="margin: 5px 0; color: #1E3A8A;">📍 Destinations: {destinations}</p>
            <p style="margin: 5px 0; color: #1E3A8A;">📅 Dates: {dates}</p>
        </div>
        
        <p>Pool your points with the group to unlock better flight options and maximize savings!</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{join_url}" style="display: inline-block; background: #FBBF24; color: #1E293B; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600;">Join This Trip</a>
        </div>
        
        <p style="color: #64748B; font-size: 14px;">Or use invite code: <strong>{invite_code}</strong></p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p>© {year} Tripy. Maximize your travel points.</p>
    </div>
</body>
</html>
""",
        "text": """
You're invited! ✨

{organizer_name} has invited you to join their group trip: "{trip_name}"

Trip Details:
📍 Destinations: {destinations}
📅 Dates: {dates}

Pool your points with the group to unlock better flight options and maximize savings!

Join this trip: {join_url}

Or use invite code: {invite_code}

---
© {year} Tripy. Maximize your travel points.
""",
    },
    # =========================================================================
    # Solo Plan / Confidence Engine Templates
    # =========================================================================
    "magic_link": {
        "subject": "Your Tripy flight plan",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Tripy Plan</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 28px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 600;">Tripy</h1>
    </div>
    <div style="background: white; padding: 32px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <p style="margin-top: 0;">Hi there,</p>
        <p>You asked us to save your Tripy flight plan — here it is.</p>

        <div style="text-align: center; margin: 28px 0;">
            <a href="{magic_link}" style="display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">View your plan</a>
        </div>

        <p>This link restores the exact recommendation you saw, including:</p>
        <ul style="color: #475569; padding-left: 20px;">
            <li>The flight we suggested</li>
            <li>Why it's the best option</li>
            <li>What to watch out for</li>
            <li>How to book it step by step</li>
        </ul>

        <p>No account required.<br>
        If you want to save or monitor this plan later, you'll have the option to do that when you're ready.</p>

        <p style="margin-bottom: 0;">Safe travels,<br><strong>Tripy</strong></p>

        <div style="border-top: 1px solid #E2E8F0; margin-top: 24px; padding-top: 16px;">
            <p style="color: #94A3B8; font-size: 13px; margin: 0; font-style: italic;">
                P.S. Flight availability can change quickly. If you want us to keep an eye on this for you, just sign in after opening the link.
            </p>
        </div>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p style="margin: 0;">&copy; {year} Tripy &middot; Book with confidence.</p>
    </div>
</body>
</html>
""",
        "text": """Hi there,

You asked us to save your Tripy flight plan — here it is.

View your plan: {magic_link}

This link restores the exact recommendation you saw, including:
- The flight we suggested
- Why it's the best option
- What to watch out for
- How to book it step by step

No account required.
If you want to save or monitor this plan later, you'll have the option to do that when you're ready.

Safe travels,
Tripy

P.S. Flight availability can change quickly. If you want us to keep an eye on this for you, just sign in after opening the link.

---
© {year} Tripy. Book with confidence.
""",
    },
    "post_result_followup": {
        "subject": "Your Tripy plan is still ready",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quick check-in from Tripy</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 28px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 600;">Tripy</h1>
    </div>
    <div style="background: white; padding: 32px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <p style="margin-top: 0;">Hi,</p>
        <p>Quick check-in.</p>
        <p>We wanted to make sure your Tripy recommendation helped you feel more confident about your booking decision.</p>

        <p>If you haven't booked yet, your plan is still available here:</p>

        <div style="text-align: center; margin: 24px 0;">
            <a href="{magic_link}" style="display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">View your plan</a>
        </div>

        <p>If you already booked — nice work.<br>
        You avoided the most common traps we see people fall into.</p>

        <p>If you want Tripy to remember this plan or alert you if something better appears, you can save it anytime after signing in.</p>

        <p style="margin-bottom: 0;">Thanks for trusting us,<br><strong>Tripy</strong></p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p style="margin: 0;">&copy; {year} Tripy &middot; Book with confidence.</p>
    </div>
</body>
</html>
""",
        "text": """Hi,

Quick check-in.

We wanted to make sure your Tripy recommendation helped you feel more confident about your booking decision.

If you haven't booked yet, your plan is still available here:
{magic_link}

If you already booked — nice work.
You avoided the most common traps we see people fall into.

If you want Tripy to remember this plan or alert you if something better appears, you can save it anytime after signing in.

Thanks for trusting us,
Tripy

---
© {year} Tripy. Book with confidence.
""",
    },
    "lock_plan_prompt": {
        "subject": "Save your Tripy plan?",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Save your Tripy plan</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 28px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 600;">Tripy</h1>
    </div>
    <div style="background: white; padding: 32px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <p style="margin-top: 0;">Hi,</p>
        <p>You recently looked at a Tripy flight plan and chose not to save it yet — totally fine.</p>

        <p>If you'd like us to:</p>
        <ul style="color: #475569; padding-left: 20px;">
            <li>Remember this plan</li>
            <li>Keep it available across devices</li>
            <li>Notify you if prices or availability change</li>
        </ul>

        <p>You can lock it with one click here:</p>

        <div style="text-align: center; margin: 24px 0;">
            <a href="{lock_plan_link}" style="display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">Lock this plan</a>
        </div>

        <p>No pressure. Tripy works just fine without an account — this just lets us work a little harder for you.</p>

        <p style="margin-bottom: 0;">Best,<br><strong>Tripy</strong></p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p style="margin: 0;">&copy; {year} Tripy &middot; Book with confidence.</p>
    </div>
</body>
</html>
""",
        "text": """Hi,

You recently looked at a Tripy flight plan and chose not to save it yet — totally fine.

If you'd like us to:
- Remember this plan
- Keep it available across devices
- Notify you if prices or availability change

You can lock it with one click here:
{lock_plan_link}

No pressure. Tripy works just fine without an account — this just lets us work a little harder for you.

Best,
Tripy

---
© {year} Tripy. Book with confidence.
""",
    },
    "i_booked_it": {
        "subject": "Congrats on booking your flight",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Booking confirmed</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 28px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 600;">Tripy</h1>
    </div>
    <div style="background: white; padding: 32px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <p style="margin-top: 0; font-size: 18px;">Congrats on booking your flight &#9992;&#65039;</p>

        <p>Here are a few quick reminders to keep things smooth:</p>
        <ul style="color: #475569; padding-left: 20px;">
            <li>Save your booking confirmation and ticket number</li>
            <li>Keep your point transfer receipt (if you transferred points)</li>
            <li>Double-check seat selection and baggage rules</li>
        </ul>

        <p>Your Tripy plan is still available if you want to review it later:</p>

        <div style="text-align: center; margin: 24px 0;">
            <a href="{trip_link}" style="display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">View your plan</a>
        </div>

        <p>If anything changes — prices, schedules, or better options — Tripy can watch this trip for you once it's saved.</p>

        <p style="margin-bottom: 0;">Enjoy the trip,<br><strong>Tripy</strong></p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p style="margin: 0;">&copy; {year} Tripy &middot; Book with confidence.</p>
    </div>
</body>
</html>
""",
        "text": """Congrats on booking your flight!

Here are a few quick reminders to keep things smooth:
- Save your booking confirmation and ticket number
- Keep your point transfer receipt (if you transferred points)
- Double-check seat selection and baggage rules

Your Tripy plan is still available if you want to review it later:
{trip_link}

If anything changes — prices, schedules, or better options — Tripy can watch this trip for you once it's saved.

Enjoy the trip,
Tripy

---
© {year} Tripy. Book with confidence.
""",
    },
    "monitoring_alert": {
        "subject": "Something changed with your Tripy plan",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Plan update</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 28px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 600;">Tripy</h1>
    </div>
    <div style="background: white; padding: 32px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <p style="margin-top: 0;">Hi,</p>
        <p>We're keeping an eye on your Tripy flight plan, and something changed.</p>

        <div style="text-align: center; margin: 24px 0;">
            <a href="{trip_update_link}" style="display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">View the update</a>
        </div>

        <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0; font-weight: 600; color: #1E40AF;">What this means:</p>
            <ul style="margin: 0; padding-left: 20px; color: #1E3A8A;">
                <li>A better option may be available, <strong>or</strong></li>
                <li>Pricing or availability shifted</li>
            </ul>
        </div>

        <p>We'll explain exactly what changed and whether it's worth acting — no guesswork.</p>

        <p>As always, you're in control.<br>
        We're just here to help you decide.</p>

        <p style="margin-bottom: 0;">— <strong>Tripy</strong></p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p style="margin: 0;">&copy; {year} Tripy &middot; Book with confidence.</p>
    </div>
</body>
</html>
""",
        "text": """Hi,

We're keeping an eye on your Tripy flight plan, and something changed.

View the update: {trip_update_link}

What this means:
- A better option may be available, or
- Pricing or availability shifted

We'll explain exactly what changed and whether it's worth acting — no guesswork.

As always, you're in control.
We're just here to help you decide.

— Tripy

---
© {year} Tripy. Book with confidence.
""",
    },
    "gentle_nudge": {
        "subject": "Tripy noticed a pattern",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Save your preferences</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 28px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 600;">Tripy</h1>
    </div>
    <div style="background: white; padding: 32px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <p style="margin-top: 0;">Hi,</p>
        <p>You've used Tripy a couple of times now, and we noticed a pattern in how you like to travel.</p>

        <p>If you want, you can save your preferences so Tripy can:</p>
        <ul style="color: #475569; padding-left: 20px;">
            <li>Skip setup next time</li>
            <li>Optimize faster</li>
            <li>Match recommendations more closely to how you decide</li>
        </ul>

        <div style="text-align: center; margin: 24px 0;">
            <a href="{sign_in_link}" style="display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px;">Save my preferences</a>
        </div>

        <p>Totally optional — Tripy works without an account too.</p>

        <p style="margin-bottom: 0;">Thanks for using Tripy,<br><strong>Tripy</strong></p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p style="margin: 0;">&copy; {year} Tripy &middot; Book with confidence.</p>
    </div>
</body>
</html>
""",
        "text": """Hi,

You've used Tripy a couple of times now, and we noticed a pattern in how you like to travel.

If you want, you can save your preferences so Tripy can:
- Skip setup next time
- Optimize faster
- Match recommendations more closely to how you decide

You can do that here: {sign_in_link}

Totally optional — Tripy works without an account too.

Thanks for using Tripy,
Tripy

---
© {year} Tripy. Book with confidence.
""",
    },
    "support_touch": {
        "subject": "Was your Tripy recommendation helpful?",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>We'd love your feedback</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #334155; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
    <div style="background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); padding: 28px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 600;">Tripy</h1>
    </div>
    <div style="background: white; padding: 32px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 16px 16px;">
        <p style="margin-top: 0;">Hi,</p>
        <p>If anything about your Tripy recommendation felt unclear or off, we want to hear about it.</p>

        <p>You can reply directly to this email — it goes to a real person.</p>

        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
            <p style="margin: 0; color: #475569; font-size: 15px;">Our goal is simple:<br>
            <strong style="color: #1E293B;">Help you book with confidence and avoid regret.</strong></p>
        </div>

        <p style="margin-bottom: 0;">— <strong>Tripy Support</strong></p>
    </div>
    <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 12px;">
        <p style="margin: 0;">&copy; {year} Tripy &middot; Book with confidence.</p>
    </div>
</body>
</html>
""",
        "text": """Hi,

If anything about your Tripy recommendation felt unclear or off, we want to hear about it.

You can reply directly to this email — it goes to a real person.

Our goal is simple:
Help you book with confidence and avoid regret.

— Tripy Support

---
© {year} Tripy. Book with confidence.
""",
    },
}


def send_email(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
    reply_to: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send an email using AWS SES.
    
    Args:
        to_email: Recipient email address
        subject: Email subject
        html_body: HTML version of the email body
        text_body: Plain text version of the email body
        reply_to: Optional reply-to email address
        
    Returns:
        Dict with 'success' boolean and 'message_id' or 'error'
    """
    try:
        destination = {"ToAddresses": [to_email]}
        message = {
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Html": {"Data": html_body, "Charset": "UTF-8"},
                "Text": {"Data": text_body, "Charset": "UTF-8"},
            },
        }
        
        kwargs = {
            "Source": SENDER_EMAIL,
            "Destination": destination,
            "Message": message,
        }
        
        if reply_to:
            kwargs["ReplyToAddresses"] = [reply_to]
        
        response = ses_client.send_email(**kwargs)
        
        logger.info(f"Email sent successfully to {to_email}, MessageId: {response['MessageId']}")
        return {"success": True, "message_id": response["MessageId"]}
        
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        logger.error(f"SES send_email error: {error_code} - {error_message}")
        
        if error_code == "MessageRejected":
            return {"success": False, "error": f"Email rejected: {error_message}"}
        elif error_code == "MailFromDomainNotVerifiedException":
            return {"success": False, "error": "Sender email domain not verified"}
        elif error_code == "ConfigurationSetDoesNotExistException":
            return {"success": False, "error": "SES configuration error"}
        else:
            return {"success": False, "error": f"Email failed: {error_message}"}
    except Exception as e:
        logger.error(f"Unexpected error sending email: {str(e)}")
        return {"success": False, "error": f"Email failed: {str(e)}"}


def _render_template(template_name: str, **kwargs) -> Dict[str, str]:
    """
    Render an email template with the given variables.
    
    Args:
        template_name: Name of the template to render
        **kwargs: Variables to substitute in the template
        
    Returns:
        Dict with 'subject', 'html', and 'text' keys
    """
    from datetime import datetime
    
    template = TEMPLATES.get(template_name)
    if not template:
        raise ValueError(f"Unknown email template: {template_name}")
    
    # Add default variables
    kwargs.setdefault("year", datetime.now().year)
    kwargs.setdefault("home_url", FRONTEND_URL)
    
    return {
        "subject": template["subject"].format(**kwargs),
        "html": template["html"].format(**kwargs),
        "text": template["text"].format(**kwargs),
    }


def send_member_approved_email(
    member_email: str,
    member_name: str,
    trip_id: str,
    trip_name: str,
    organizer_name: str,
) -> Dict[str, Any]:
    """
    Send an approval notification email to a member.
    
    Args:
        member_email: Email address of the approved member
        member_name: Name of the approved member
        trip_id: ID of the trip
        trip_name: Name of the trip
        organizer_name: Name of the trip organizer
        
    Returns:
        Result dict with 'success' and optionally 'message_id' or 'error'
    """
    dashboard_url = f"{FRONTEND_URL}/group/dashboard?tripId={trip_id}"
    
    rendered = _render_template(
        "member_approved",
        member_name=member_name,
        trip_name=trip_name,
        organizer_name=organizer_name,
        dashboard_url=dashboard_url,
    )
    
    return send_email(
        to_email=member_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
    )


def send_member_denied_email(
    member_email: str,
    member_name: str,
    trip_name: str,
) -> Dict[str, Any]:
    """
    Send a denial notification email to a member.
    
    Args:
        member_email: Email address of the denied member
        member_name: Name of the denied member
        trip_name: Name of the trip
        
    Returns:
        Result dict with 'success' and optionally 'message_id' or 'error'
    """
    rendered = _render_template(
        "member_denied",
        member_name=member_name,
        trip_name=trip_name,
    )
    
    return send_email(
        to_email=member_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
    )


def send_trip_invitation_email(
    invitee_email: str,
    organizer_name: str,
    trip_name: str,
    invite_code: str,
    destinations: str,
    dates: str,
) -> Dict[str, Any]:
    """
    Send a trip invitation email.
    
    Args:
        invitee_email: Email address to send the invitation to
        organizer_name: Name of the trip organizer
        trip_name: Name of the trip
        invite_code: The invite code for joining
        destinations: Comma-separated list of destinations
        dates: Trip dates as a string
        
    Returns:
        Result dict with 'success' and optionally 'message_id' or 'error'
    """
    join_url = f"{FRONTEND_URL}/group/join/{invite_code}"
    
    rendered = _render_template(
        "trip_invitation",
        organizer_name=organizer_name,
        trip_name=trip_name,
        invite_code=invite_code,
        destinations=destinations,
        dates=dates,
        join_url=join_url,
    )
    
    return send_email(
        to_email=invitee_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
    )


# =========================================================================
# Solo Plan / Confidence Engine Email Helpers
# =========================================================================

SUPPORT_EMAIL = "support@traveltripy.com"


def send_magic_link_email(
    to_email: str,
    magic_link: str,
) -> Dict[str, Any]:
    """
    Send a magic link email so the user can restore their flight plan.
    Template: magic_link (Phase 14 — "Email Me This Plan")
    """
    rendered = _render_template("magic_link", magic_link=magic_link)
    return send_email(
        to_email=to_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
    )


def send_post_result_followup_email(
    to_email: str,
    magic_link: str,
) -> Dict[str, Any]:
    """
    Send a calm follow-up after a user generated results but hasn't booked.
    Template: post_result_followup
    """
    rendered = _render_template("post_result_followup", magic_link=magic_link)
    return send_email(
        to_email=to_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
    )


def send_lock_plan_prompt_email(
    to_email: str,
    lock_plan_link: str,
) -> Dict[str, Any]:
    """
    Prompt a signed-in user to lock/save their plan.
    Template: lock_plan_prompt
    """
    rendered = _render_template("lock_plan_prompt", lock_plan_link=lock_plan_link)
    return send_email(
        to_email=to_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
    )


def send_i_booked_it_email(
    to_email: str,
    trip_link: str,
) -> Dict[str, Any]:
    """
    Acknowledge a booking and remind the user to keep key documents.
    Template: i_booked_it
    """
    rendered = _render_template("i_booked_it", trip_link=trip_link)
    return send_email(
        to_email=to_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
    )


def send_monitoring_alert_email(
    to_email: str,
    trip_update_link: str,
    unsubscribe_link: str = "",
    manage_link: str = "",
    consent_date: str = "",
) -> Dict[str, Any]:
    """
    Alert a user that something changed on a monitored plan.
    Template: monitoring_alert

    Includes:
    - Unsubscribe footer with consent date
    - List-Unsubscribe + List-Unsubscribe-Post headers (RFC 8058)
    """
    rendered = _render_template("monitoring_alert", trip_update_link=trip_update_link)

    # Append unsubscribe footer to rendered HTML/text
    footer_html = ""
    footer_text = ""
    if unsubscribe_link:
        consent_str = f" on {consent_date}" if consent_date else ""
        footer_html = f"""
        <div style="text-align: center; padding: 16px 20px; color: #94A3B8; font-size: 11px; border-top: 1px solid #E2E8F0; margin-top: 20px;">
            <p style="margin: 0 0 4px 0;">You signed up for trip monitoring{consent_str}.</p>
            <p style="margin: 0;"><a href="{unsubscribe_link}" style="color: #64748B;">Unsubscribe from this trip</a>"""
        if manage_link:
            footer_html += f""" &middot; <a href="{manage_link}" style="color: #64748B;">Manage all alerts</a>"""
        footer_html += """</p></div>"""

        footer_text = f"\n---\nYou signed up for trip monitoring{consent_str}.\nUnsubscribe: {unsubscribe_link}"
        if manage_link:
            footer_text += f"\nManage all alerts: {manage_link}"

    html_body = rendered["html"]
    text_body = rendered["text"]
    if footer_html:
        # Insert footer before closing </body> tag
        html_body = html_body.replace("</body>", f"{footer_html}</body>")
        text_body = text_body + footer_text

    # Use SES send_raw_email for custom headers (List-Unsubscribe)
    if unsubscribe_link:
        return _send_email_with_headers(
            to_email=to_email,
            subject=rendered["subject"],
            html_body=html_body,
            text_body=text_body,
            extra_headers={
                "List-Unsubscribe": f"<{unsubscribe_link}>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
        )

    return send_email(
        to_email=to_email,
        subject=rendered["subject"],
        html_body=html_body,
        text_body=text_body,
    )


def _send_email_with_headers(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
    extra_headers: Dict[str, str] = None,
) -> Dict[str, Any]:
    """
    Send email via SES send_raw_email to include custom headers (e.g., List-Unsubscribe).
    """
    import email.mime.multipart
    import email.mime.text

    try:
        msg = email.mime.multipart.MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SENDER_EMAIL
        msg["To"] = to_email

        if extra_headers:
            for key, value in extra_headers.items():
                msg[key] = value

        part_text = email.mime.text.MIMEText(text_body, "plain", "utf-8")
        part_html = email.mime.text.MIMEText(html_body, "html", "utf-8")
        msg.attach(part_text)
        msg.attach(part_html)

        response = ses_client.send_raw_email(
            Source=SENDER_EMAIL,
            Destinations=[to_email],
            RawMessage={"Data": msg.as_string()},
        )

        logger.info(f"Raw email sent to {to_email}, MessageId: {response['MessageId']}")
        return {"success": True, "message_id": response["MessageId"]}
    except Exception as e:
        logger.error(f"Error sending raw email: {e}")
        return {"success": False, "error": str(e)}


def send_gentle_nudge_email(
    to_email: str,
    sign_in_link: str,
) -> Dict[str, Any]:
    """
    Gently encourage a repeat user to save their preferences.
    Template: gentle_nudge
    """
    rendered = _render_template("gentle_nudge", sign_in_link=sign_in_link)
    return send_email(
        to_email=to_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
    )


def send_support_touch_email(
    to_email: str,
) -> Dict[str, Any]:
    """
    Human-touch email inviting feedback. Reply goes to a real person.
    Template: support_touch
    """
    rendered = _render_template("support_touch")
    return send_email(
        to_email=to_email,
        subject=rendered["subject"],
        html_body=rendered["html"],
        text_body=rendered["text"],
        reply_to=SUPPORT_EMAIL,
    )


# Check if SES is properly configured
def is_email_enabled() -> bool:
    """
    Check if email sending is enabled (SES sender email is configured).
    
    Returns:
        True if email sending is enabled, False otherwise
    """
    return bool(SENDER_EMAIL and SENDER_EMAIL != "noreply@tripy.app")


def verify_ses_configuration() -> Dict[str, Any]:
    """
    Verify SES configuration by checking if the sender email is verified.
    
    Returns:
        Dict with 'configured', 'sender_email', and optionally 'verified' status
    """
    result = {
        "configured": is_email_enabled(),
        "sender_email": SENDER_EMAIL,
    }
    
    if not result["configured"]:
        result["message"] = "SES_SENDER_EMAIL not configured in environment"
        return result
    
    try:
        # Check if the sender email/domain is verified
        response = ses_client.get_identity_verification_attributes(
            Identities=[SENDER_EMAIL]
        )
        attributes = response.get("VerificationAttributes", {})
        sender_status = attributes.get(SENDER_EMAIL, {})
        result["verified"] = sender_status.get("VerificationStatus") == "Success"
        
        if not result["verified"]:
            # Check if the domain is verified instead
            domain = SENDER_EMAIL.split("@")[1] if "@" in SENDER_EMAIL else ""
            if domain:
                domain_response = ses_client.get_identity_verification_attributes(
                    Identities=[domain]
                )
                domain_attrs = domain_response.get("VerificationAttributes", {})
                domain_status = domain_attrs.get(domain, {})
                result["domain_verified"] = domain_status.get("VerificationStatus") == "Success"
                result["verified"] = result.get("domain_verified", False)
        
    except ClientError as e:
        logger.warning(f"Could not verify SES configuration: {e}")
        result["verified"] = None
        result["error"] = str(e)
    
    return result
