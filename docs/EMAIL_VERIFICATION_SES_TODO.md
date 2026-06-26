# Email Verification & SES — Current State + Future TODO

_Last reviewed: 2026-06-26_

## TL;DR

Sign-up email verification currently runs on **Cognito's built-in email sender
(`COGNITO_DEFAULT`)** — **no SES, no cost, no setup**. This is fine for now.
**SES is a deliberate future TODO**, to be turned on as email volume grows or
deliverability becomes a problem. The SES artifacts are already provisioned and
left in place so the switch is a one-command flip later.

---

## How verification email works today

- Verification codes are sent by the **Cognito User Pool**, not the app's SES
  `email_service`.
- Live pool: `us-east-1_lmxrQk9sf` — `EmailConfiguration.EmailSendingAccount =
  COGNITO_DEFAULT`.
- Cost: **$0**. Sender: `no-reply@verificationemail.com` (fixed, not brandable).
- The "resend code" button on the confirm-signup page calls Cognito
  `ResendConfirmationCode`, which uses this same default sender.

### Limitations we are accepting for now
- **50 emails/day** hard cap across the whole pool.
- Mediocre deliverability — can land in Gmail/Outlook spam.
- No custom from-address or DKIM branding.

---

## 🔜 FUTURE TODO: Switch Cognito to send via SES

**Why we'll need it (triggers — adopt when ANY of these is true):**
1. **Volume:** approaching/exceeding **~50 verification + password-reset emails
   per day** (the Cognito default cap). This is the hard one — once hit, codes
   silently stop sending until the next day.
2. **Deliverability:** users report codes landing in spam or not arriving.
3. **Branding:** we want codes to come from `no-reply@tripshacker.com` instead of
   `no-reply@verificationemail.com`.

**Cost when we do switch:** negligible — SES is **$0.10 per 1,000 emails**
(~$0.0001 each), no monthly fee. At a few hundred emails/day that's pennies/month.
Do **not** enable a dedicated IP (~$25/mo) — not needed for transactional volume.

### What's already provisioned (left in place on purpose, $0 to keep)
- ✅ SES **domain identity** `tripshacker.com` (region `us-east-1`).
- ✅ **DKIM CNAME records** added to Route 53 zone `Z09889411MZ9NT67BHCF5`
  (see [SES_DNS_RECORDS.md](./SES_DNS_RECORDS.md)). _Note: as of last review the
  domain showed `DKIM: PENDING` — re-check status before relying on it._
- ✅ Test recipient `ezhong0211@gmail.com` verified for sandbox testing.
- ✅ One-command setup script: [`scripts/setup-ses-cognito.py`](../scripts/setup-ses-cognito.py).

### Steps to activate SES later
1. Confirm the domain is verified:
   ```bash
   aws sesv2 get-email-identity --email-identity tripshacker.com --region us-east-1 \
     --query '{Verified:VerifiedForSendingStatus,DKIM:DkimAttributes.Status}'
   ```
   Need `DKIM: SUCCESS`. If still pending, confirm the CNAMEs from
   `SES_DNS_RECORDS.md` resolve.
2. **Request SES production access** (required to email real, unverified signups —
   the sandbox only delivers to pre-verified addresses).
   ⚠️ A prior request was **DENIED** (Support CaseId `178234985400618`). The
   `put-account-details` API now returns `ConflictException`, so this must be
   resubmitted/appealed in the **SES console → Account dashboard → Request
   production access**. Reading the denial reason needs a paid AWS Support plan.
   Justification text to paste is in the project history / draft below.
3. Flip the Cognito pool to SES (preserves all other pool settings):
   ```bash
   python3 scripts/setup-ses-cognito.py \
     --domain tripshacker.com \
     --from "TripsHacker <no-reply@tripshacker.com>" \
     --user-pool-id us-east-1_lmxrQk9sf \
     --region us-east-1
   ```
4. Sign up a test account and confirm the code arrives from
   `no-reply@tripshacker.com`.

### Production-access justification (for the console resubmit)
> TripsHacker (https://tripshacker.com) is a travel-planning web app. We use
> Amazon Cognito backed by SES to send transactional emails only — account
> sign-up verification codes and password-reset codes. Every email goes only to
> an address the user themselves entered on our sign-up/reset form; we never email
> purchased or third-party lists and send no marketing. Volume is low (tens to
> low-hundreds/day). We have a verified domain identity with DKIM, SES bounce/
> complaint suppression enabled, and monitor bounce/complaint rates in CloudWatch.
> These are mandatory account-security messages, so unsubscribe does not apply.

---

## Related
- [SES_DNS_RECORDS.md](./SES_DNS_RECORDS.md) — the DKIM / MAIL FROM / DMARC records.
- [`scripts/setup-ses-cognito.py`](../scripts/setup-ses-cognito.py) — idempotent SES + Cognito setup.
