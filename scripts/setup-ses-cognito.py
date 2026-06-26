#!/usr/bin/env python3
"""
Set up AWS SES as the email sender for Cognito sign-up verification emails.

Why this exists
---------------
Sign-up verification codes are sent by the Cognito User Pool, NOT by the app's
SES email_service. By default Cognito uses its own low-volume sender
(no-reply@verificationemail.com, 50/day, poor deliverability). This script
switches the pool to send via *your* verified SES identity so codes come from
e.g. no-reply@tripshacker.com with real deliverability.

What it does (each step is idempotent and prints what it changed):
  1. Verify an SES identity (domain or single email) in the pool's region.
  2. If the domain lives in Route 53, auto-add the DKIM CNAME records.
  3. (Optional) Request SES production access — REQUIRED to email codes to
     brand-new (unverified) signups. While in the SES sandbox, Cognito can only
     email addresses you've separately verified.
  4. Point the Cognito User Pool's EmailConfiguration at the SES identity
     (EmailSendingAccount=DEVELOPER), preserving all other pool settings.

Usage:
  python3 scripts/setup-ses-cognito.py \
      --domain tripshacker.com \
      --from "TripsHacker <no-reply@tripshacker.com>" \
      --user-pool-id us-east-1_lmxrQk9sf \
      --region us-east-1

  # verify a single address instead of a whole domain:
  python3 scripts/setup-ses-cognito.py --email no-reply@tripshacker.com ...

  # also file the sandbox-exit request (AWS reviews it, ~24h):
  python3 scripts/setup-ses-cognito.py ... --request-production \
      --website https://tripshacker.com \
      --use-case "Transactional sign-up verification codes for our travel app."

Dry run (no changes): add --dry-run
"""
import argparse
import sys

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    sys.exit("boto3 is required:  pip install boto3")


def log(msg):
    print(msg, flush=True)


def verify_domain_identity(sesv2, domain, dry_run):
    """Create (or fetch) a domain identity and return its DKIM CNAME records."""
    try:
        existing = sesv2.get_email_identity(EmailIdentity=domain)
        log(f"✓ SES domain identity already exists: {domain} "
            f"(verified={existing.get('VerifiedForSendingStatus')})")
        dkim = existing.get("DkimAttributes", {})
    except ClientError as e:
        if e.response["Error"]["Code"] != "NotFoundException":
            raise
        if dry_run:
            log(f"[dry-run] would create SES domain identity {domain}")
            return []
        resp = sesv2.create_email_identity(EmailIdentity=domain)
        log(f"✓ Created SES domain identity {domain}")
        dkim = resp.get("DkimAttributes", {})

    tokens = dkim.get("Tokens", [])
    records = [
        (f"{t}._domainkey.{domain}", f"{t}.dkim.amazonses.com")
        for t in tokens
    ]
    if records:
        log("  DKIM CNAME records required for verification:")
        for name, value in records:
            log(f"    {name}  CNAME  {value}")
    return records


def verify_email_identity(sesv2, email, dry_run):
    try:
        existing = sesv2.get_email_identity(EmailIdentity=email)
        log(f"✓ SES email identity already exists: {email} "
            f"(verified={existing.get('VerifiedForSendingStatus')})")
        return
    except ClientError as e:
        if e.response["Error"]["Code"] != "NotFoundException":
            raise
    if dry_run:
        log(f"[dry-run] would create SES email identity {email}")
        return
    sesv2.create_email_identity(EmailIdentity=email)
    log(f"✓ Verification email sent to {email}. Click the link in it to finish "
        f"(you must control that mailbox).")


def find_hosted_zone_id(route53, domain):
    """Return the Route 53 hosted-zone id that owns `domain`, or None."""
    paginator = route53.get_paginator("list_hosted_zones")
    best = None
    for page in paginator.paginate():
        for zone in page["HostedZones"]:
            zname = zone["Name"].rstrip(".")
            if domain == zname or domain.endswith("." + zname):
                # Prefer the most specific (longest) matching zone.
                if best is None or len(zname) > len(best[1]):
                    best = (zone["Id"], zname)
    return best[0] if best else None


def upsert_dkim_records(route53, zone_id, records, dry_run):
    changes = [
        {
            "Action": "UPSERT",
            "ResourceRecordSet": {
                "Name": name,
                "Type": "CNAME",
                "TTL": 1800,
                "ResourceRecords": [{"Value": value}],
            },
        }
        for name, value in records
    ]
    if dry_run:
        log(f"[dry-run] would UPSERT {len(changes)} DKIM CNAME records into {zone_id}")
        return
    route53.change_resource_record_sets(
        HostedZoneId=zone_id, ChangeBatch={"Changes": changes}
    )
    log(f"✓ Added {len(changes)} DKIM CNAME records to Route 53 zone {zone_id}. "
        f"Verification usually completes within a few minutes.")


def request_production_access(sesv2, website, use_case, dry_run):
    if dry_run:
        log("[dry-run] would request SES production access")
        return
    try:
        sesv2.put_account_details(
            MailType="TRANSACTIONAL",
            WebsiteURL=website,
            UseCaseDescription=use_case,
            ProductionAccessEnabled=True,
            ContactLanguage="EN",
        )
        log("✓ Production-access request submitted. AWS typically reviews within 24h. "
            "Until approved, Cognito can only email SES-verified addresses.")
    except ClientError as e:
        log(f"! Could not submit production-access request: {e}. "
            f"You can also do it in the SES console → Account dashboard → "
            f"'Request production access'.")


def update_cognito_email(cognito, region, account_id, user_pool_id,
                         identity, from_addr, reply_to, dry_run):
    """Point the pool at SES, preserving all existing pool settings."""
    pool = cognito.describe_user_pool(UserPoolId=user_pool_id)["UserPool"]
    source_arn = f"arn:aws:ses:{region}:{account_id}:identity/{identity}"

    email_cfg = {
        "EmailSendingAccount": "DEVELOPER",
        "SourceArn": source_arn,
        "From": from_addr,
    }
    if reply_to:
        email_cfg["ReplyToEmailAddress"] = reply_to

    # update_user_pool resets any field you omit, so echo back the existing ones.
    kwargs = {"UserPoolId": user_pool_id, "EmailConfiguration": email_cfg}
    for key in (
        "Policies", "DeletionProtection", "AutoVerifiedAttributes",
        "SmsVerificationMessage", "EmailVerificationMessage",
        "EmailVerificationSubject", "VerificationMessageTemplate",
        "SmsAuthenticationMessage", "UserAttributeUpdateSettings",
        "MfaConfiguration", "DeviceConfiguration", "SmsConfiguration",
        "AdminCreateUserConfig", "UserPoolTags", "AccountRecoverySetting",
        "UserPoolAddOns", "LambdaConfig",
    ):
        if key in pool and pool[key]:
            kwargs[key] = pool[key]

    if dry_run:
        log(f"[dry-run] would set pool {user_pool_id} EmailConfiguration to:\n"
            f"          {email_cfg}")
        return
    cognito.update_user_pool(**kwargs)
    log(f"✓ Cognito pool {user_pool_id} now sends verification emails via SES "
        f"as {from_addr}")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--domain", help="Verify a whole domain (recommended)")
    g.add_argument("--email", help="Verify a single from-address instead")
    p.add_argument("--from", dest="from_addr", required=True,
                   help='From header, e.g. "TripsHacker <no-reply@tripshacker.com>"')
    p.add_argument("--user-pool-id", required=True)
    p.add_argument("--region", default="us-east-1")
    p.add_argument("--reply-to", help="Optional Reply-To address")
    p.add_argument("--request-production", action="store_true",
                   help="Also file the SES sandbox-exit request")
    p.add_argument("--website", default="", help="Site URL (for production request)")
    p.add_argument("--use-case", default="", help="Use-case text (for production request)")
    p.add_argument("--skip-cognito", action="store_true",
                   help="Only set up SES; don't touch the Cognito pool")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    session = boto3.Session(region_name=args.region)
    account_id = session.client("sts").get_caller_identity()["Account"]
    log(f"AWS account {account_id}, region {args.region}"
        + ("  (DRY RUN)" if args.dry_run else ""))

    sesv2 = session.client("sesv2")
    identity = args.domain or args.email

    if args.domain:
        records = verify_domain_identity(sesv2, args.domain, args.dry_run)
        if records:
            zone_id = find_hosted_zone_id(session.client("route53"), args.domain)
            if zone_id:
                upsert_dkim_records(session.client("route53"), zone_id,
                                    records, args.dry_run)
            else:
                log(f"! {args.domain} is not in Route 53 — add the DKIM CNAME "
                    f"records above at your DNS provider manually.")
    else:
        verify_email_identity(sesv2, args.email, args.dry_run)

    if args.request_production:
        if not (args.website and args.use_case):
            log("! --request-production needs --website and --use-case; skipping.")
        else:
            request_production_access(sesv2, args.website, args.use_case, args.dry_run)

    if not args.skip_cognito:
        update_cognito_email(
            session.client("cognito-idp"), args.region, account_id,
            args.user_pool_id, identity, args.from_addr, args.reply_to,
            args.dry_run,
        )

    log("\nDone. Next: confirm the identity shows 'Verified' in the SES console, "
        "then sign up a test account to confirm the code arrives.")


if __name__ == "__main__":
    main()
