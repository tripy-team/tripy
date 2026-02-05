"""
Email service using AWS SES for sending notifications.

This service handles sending email notifications for:
- Member approval notifications
- Member denial notifications
- Trip invitations
- Other transactional emails
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
