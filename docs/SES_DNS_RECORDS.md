# SES DNS Records — tripshacker.com (us-east-1)

Add these records at your DNS provider for `tripshacker.com`. SES verification and
DKIM signing complete automatically once they propagate (usually minutes–hours).

## DKIM (3 × CNAME) — required for verification + signing
| Name (Host) | Type | Value |
|---|---|---|
| `2dqlwyzbkivaodo3ua7vmec3pdiqdbz2._domainkey.tripshacker.com` | CNAME | `2dqlwyzbkivaodo3ua7vmec3pdiqdbz2.dkim.amazonses.com` |
| `lfjoixkp6uzpnejgbsjgxptmec3mcw25._domainkey.tripshacker.com` | CNAME | `lfjoixkp6uzpnejgbsjgxptmec3mcw25.dkim.amazonses.com` |
| `5zs26djhmlybxx7wdewczlwopizx5zl5._domainkey.tripshacker.com` | CNAME | `5zs26djhmlybxx7wdewczlwopizx5zl5.dkim.amazonses.com` |

## Custom MAIL FROM (mail.tripshacker.com) — improves deliverability (SPF alignment)
| Name (Host) | Type | Value | Priority |
|---|---|---|---|
| `mail.tripshacker.com` | MX | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| `mail.tripshacker.com` | TXT | `v=spf1 include:amazonses.com ~all` | — |

## Optional but recommended: DMARC
| Name (Host) | Type | Value |
|---|---|---|
| `_dmarc.tripshacker.com` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc@tripshacker.com` |

## Check verification status
```bash
aws sesv2 get-email-identity --email-identity tripshacker.com --region us-east-1 \
  --query '{Verified:VerifiedForSendingStatus,DKIM:DkimAttributes.Status,MailFrom:MailFromAttributes.MailFromDomainStatus}'
```
`Verified: true` and `DKIM: SUCCESS` means Cognito can send from `no-reply@tripshacker.com`.
