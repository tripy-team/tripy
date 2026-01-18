# Cognito Email Verification Template

## 📧 Email Template for Verification Code

Use this template in AWS Cognito Console to customize the verification email users receive.

---

## 🎨 Email Template (HTML)

### Subject Line
```
Welcome to Tripy! Verify Your Account
```

### Email Body (HTML)
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 32px;
            font-weight: bold;
            color: #2563eb;
            margin-bottom: 10px;
        }
        .title {
            font-size: 24px;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 20px;
        }
        .intro {
            font-size: 16px;
            color: #4b5563;
            margin-bottom: 30px;
        }
        .code-container {
            background-color: #f9fafb;
            border: 2px dashed #d1d5db;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            margin: 30px 0;
        }
        .code-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 10px;
        }
        .code {
            font-size: 36px;
            font-weight: bold;
            color: #2563eb;
            letter-spacing: 8px;
            font-family: 'Courier New', monospace;
        }
        .instructions {
            background-color: #eff6ff;
            border-left: 4px solid #2563eb;
            padding: 15px;
            margin: 30px 0;
            border-radius: 4px;
        }
        .instructions-title {
            font-weight: 600;
            color: #1e40af;
            margin-bottom: 8px;
        }
        .instructions-text {
            font-size: 14px;
            color: #1e3a8a;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            font-size: 12px;
            color: #9ca3af;
        }
        .button {
            display: inline-block;
            background-color: #2563eb;
            color: #ffffff;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            margin-top: 20px;
            font-weight: 500;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">✈️ Tripy</div>
        </div>
        
        <div class="title">Welcome to Tripy! 🎉</div>
        
        <div class="intro">
            <p>Thank you for joining Tripy! We're excited to help you spend less and travel smarter by maximizing your credit card points.</p>
            
            <p>To get started, please verify your email address by entering the verification code below:</p>
        </div>
        
        <div class="code-container">
            <div class="code-label">Your Verification Code</div>
            <div class="code">{####}</div>
        </div>
        
        <div class="instructions">
            <div class="instructions-title">How to verify:</div>
            <div class="instructions-text">
                1. Copy the 6-digit code above<br>
                2. Return to the Tripy website<br>
                3. Enter the code on the verification page<br>
                4. Start planning your next adventure!
            </div>
        </div>
        
        <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
            <strong>Note:</strong> This code will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
        </p>
        
        <div class="footer">
            <p>Happy travels!</p>
            <p>The Tripy Team</p>
            <p style="margin-top: 15px;">
                <a href="https://your-app.amplifyapp.com" style="color: #2563eb; text-decoration: none;">Visit Tripy</a>
            </p>
        </div>
    </div>
</body>
</html>
```

---

## 📝 Plain Text Version (Fallback)

If HTML emails aren't supported or as a fallback:

```
Welcome to Tripy!

Thank you for joining Tripy! We're excited to help you spend less and travel smarter by maximizing your credit card points.

To get started, please verify your email address by entering the verification code below:

Your Verification Code: {####}

How to verify:
1. Copy the 6-digit code above
2. Return to the Tripy website
3. Enter the code on the verification page
4. Start planning your next adventure!

Note: This code will expire in 24 hours. If you didn't create an account, you can safely ignore this email.

Happy travels!
The Tripy Team

Visit Tripy: https://your-app.amplifyapp.com
```

---

## 🔧 How to Set This Template in AWS Cognito

### Step 1: Go to Cognito Console

1. Navigate to: https://console.aws.amazon.com/cognito/
2. Select your User Pool (e.g., `us-east-1_zCMCjyTLJ`)
3. Click **Messaging** in the left sidebar

### Step 2: Configure Email Templates

1. Click **Email** tab
2. Under **Email templates**, find **Verification code**
3. Click **Edit**

### Step 3: Set Email Template

**Option A: HTML Email (Recommended)**
1. Select **Email type**: `HTML`
2. Enter **Subject**: `Welcome to Tripy! Verify Your Account`
3. Enter **Message**: Paste the HTML template above
4. Replace `{####}` with `{####}` (Cognito placeholder for verification code)
5. Click **Save changes**

**Option B: Plain Text Email**
1. Select **Email type**: `Plain text`
2. Enter **Subject**: `Welcome to Tripy! Verify Your Account`
3. Enter **Message**: Paste the plain text version above
4. Replace `{####}` with `{####}` (Cognito placeholder)
5. Click **Save changes**

### Step 4: Verify Email Settings

1. Go to **Messaging** → **Email** tab
2. Check **Email sending method**:
   - **Cognito default**: Uses Amazon SES (configured automatically)
   - **Developer**: Uses your own SES configuration
3. Ensure email is verified in Amazon SES (if using developer mode)

---

## 📋 Cognito Placeholder Variables

Cognito supports these placeholders in email templates:

- `{####}` - The 6-digit verification code
- `{username}` - User's username (email)
- `{####}` - Same as above (alternative syntax)

**Note**: Use `{####}` (exactly 4 hash symbols) for the verification code placeholder.

---

## 🎨 Customization Tips

### Change Colors
- Primary blue: `#2563eb` → Change to your brand color
- Background: `#f5f5f5` → Adjust as needed

### Change Logo
- Replace `✈️ Tripy` with your logo image:
  ```html
  <img src="https://your-domain.com/logo.png" alt="Tripy" style="height: 40px;">
  ```

### Update Links
- Replace `https://your-app.amplifyapp.com` with your actual frontend URL

### Add Branding
- Add your company address in the footer
- Add social media links
- Customize the closing message

---

## ✅ Testing the Email

After setting the template:

1. **Test via Signup**:
   ```bash
   curl -X POST https://xezfenhu6t.us-east-1.awsapprunner.com/auth/signup \
     -H "Content-Type: application/json" \
     -d '{"email":"your-test@email.com","password":"Test123456","firstName":"Test","lastName":"User"}'
   ```

2. **Check Email**:
   - Check the inbox for `your-test@email.com`
   - Verify the template renders correctly
   - Test the verification code works

---

## 🚨 Troubleshooting

### Email not received

1. **Check Cognito settings**:
   - Messaging → Email → Verify email sending is enabled
   - Check if email is in verification queue

2. **Check SES (if using developer mode)**:
   - Verify sender email is verified in Amazon SES
   - Check SES sending quotas

3. **Check spam folder**:
   - Cognito emails sometimes go to spam
   - Verify sender: `no-reply@verificationemail.com` (Cognito default)

### Template not updating

1. **Wait a few minutes**: Template changes can take 1-2 minutes to propagate
2. **Clear cache**: Try signing up a new user to see new template
3. **Verify save**: Make sure "Save changes" was clicked successfully

---

## 📝 Quick Reference

**Cognito Console**: https://console.aws.amazon.com/cognito/

**Path**: User Pool → Messaging → Email → Email templates → Verification code

**Placeholder**: `{####}` (4 hash symbols for verification code)

**Template Type**: HTML (recommended) or Plain text

---

## 📱 SMS Verification Code Template

Cognito can also send verification codes via SMS. Use this template for SMS messages.

---

## 📲 SMS Message Template

### Recommended Version (Under 160 characters)
```
Welcome to Tripy! 🎉 Your verification code is {####}. Enter this code to verify your account and start planning amazing trips with your points!
```
**Length**: ~140 characters

### Detailed Version (Under 300 characters)
```
Welcome to Tripy! Thank you for joining us. Your verification code is {####}. Enter this code on the verification page to activate your account and start maximizing your travel points. Happy travels!
```
**Length**: ~180 characters

### Simple & Direct (Under 100 characters)
```
Tripy verification code: {####}. Enter this code to complete your registration.
```
**Length**: ~75 characters

### Minimal Version (Under 50 characters)
```
Tripy code: {####}
```
**Length**: ~15 characters (plus code)

---

## 🔧 How to Set SMS Template in AWS Cognito

### Step 1: Go to Cognito Console

1. Navigate to: https://console.aws.amazon.com/cognito/
2. Select your User Pool (e.g., `us-east-1_zCMCjyTLJ`)
3. Click **Messaging** in the left sidebar

### Step 2: Configure SMS Templates

1. Click **SMS** tab
2. Under **SMS templates**, find **Verification code**
3. Click **Edit**

### Step 3: Set SMS Template

1. Enter **Message**: Paste one of the SMS templates above (recommended: Recommended Version)
2. **Important**: Replace `{####}` with `{####}` (Cognito placeholder - 4 hash symbols)
3. Click **Save changes**

### Step 4: Configure SMS Settings

**If you haven't set up SMS yet:**

1. Go to **Messaging** → **SMS** tab
2. Under **SMS configuration**:
   - **SMS delivery method**: 
     - **Cognito default**: Uses AWS SNS (configured automatically)
     - **Developer**: Use your own SNS configuration
3. **Default message type**: Select `Transactional`
4. **Spending limit**: Set a monthly limit to prevent unexpected charges (e.g., $10)

### Step 5: Verify Phone Number Format

Cognito requires phone numbers in E.164 format:
- US: `+1234567890`
- UK: `+44123456789`
- International: `+[country code][number]`

---

## 📝 SMS Template Options

### Option 1: Professional & Friendly (Recommended)
```
Welcome to Tripy! 🎉 Your verification code is {####}. Enter this code to verify your account and start planning amazing trips with your points!
```
**Length**: ~140 characters

### Option 2: Simple & Direct
```
Tripy verification code: {####}. Enter this code to complete your registration.
```
**Length**: ~75 characters

### Option 3: Branded with Instructions
```
✈️ Welcome to Tripy! Your 6-digit verification code is {####}. Go to the verification page and enter this code to activate your account. Happy travels!
```
**Length**: ~155 characters

### Option 4: Minimal
```
Tripy code: {####}
```
**Length**: ~15 characters (plus code)

---

## 🎨 SMS Best Practices

### Keep It Short
- SMS messages are typically limited to 160 characters (single message)
- Longer messages may be split into multiple parts (costs more)
- Recommended: Keep under 160 characters when possible

### Include Key Information
- ✅ Brand name (Tripy)
- ✅ Purpose (verification)
- ✅ Verification code (with placeholder)
- ✅ Brief next step (optional)

### Use Clear Formatting
- Use spaces around the code: `{####}` not `{####}`
- Keep sentences short and clear
- Avoid special characters that might cause encoding issues

### Cognito Placeholder
- Use `{####}` (exactly 4 hash symbols) for the verification code
- Cognito will replace this with the actual 6-digit code

---

## 📋 SMS Configuration Checklist

- [ ] SMS template set in Cognito Console
- [ ] Verification code placeholder `{####}` included
- [ ] SMS delivery method configured (Cognito default or custom SNS)
- [ ] Spending limit set to prevent unexpected charges
- [ ] Phone number format verified (E.164 format)
- [ ] Test SMS sent to verify template works

---

## 💰 SMS Costs & Limits

### AWS SNS Pricing (Cognito Default)
- **US**: ~$0.00645 per SMS
- **International**: Varies by country (typically $0.01-$0.10 per SMS)
- **Free tier**: Not available for SMS

### Spending Limits
1. Go to **Messaging** → **SMS** tab
2. Set **Monthly spending limit** (recommended: $10-50)
3. This prevents unexpected charges if there's unusual activity

### Best Practices
- Use SMS only when necessary (not for every action)
- Consider email verification as primary method
- Use SMS for critical actions (password reset, account recovery)

---

## 🔍 Testing SMS Template

After setting the template:

1. **Test via Signup** (with phone number):
   ```bash
   curl -X POST https://xezfenhu6t.us-east-1.awsapprunner.com/auth/signup \
     -H "Content-Type: application/json" \
     -d '{
       "email":"test@example.com",
       "password":"Test123456",
       "firstName":"Test",
       "lastName":"User",
       "phoneNumber":"+1234567890"
     }'
   ```

2. **Check Phone**:
   - Verify SMS is received
   - Check formatting and code display
   - Test verification with the code

---

## 🚨 SMS Troubleshooting

### SMS not received

1. **Check phone number format**:
   - Must be in E.164 format: `+[country code][number]`
   - Example: `+15551234567` (US), `+447911123456` (UK)

2. **Verify SMS configuration**:
   - Messaging → SMS → Check "SMS delivery method" is configured
   - Ensure spending limit hasn't been exceeded

3. **Check carrier delivery**:
   - Some carriers may block automated SMS
   - Verify phone number is not on a blocklist
   - Test with a different phone number

### Template not working

1. **Verify placeholder**:
   - Must use exactly `{####}` (4 hash symbols)
   - Case-sensitive, no spaces

2. **Check character limits**:
   - Very long messages may be rejected
   - Keep under 160 characters for single message

3. **Verify save**:
   - Make sure "Save changes" was clicked successfully
   - Wait 1-2 minutes for changes to propagate

### High SMS costs

1. **Set spending limits**:
   - Messaging → SMS → Monthly spending limit
   - Set a reasonable limit (e.g., $10-50/month)

2. **Review usage**:
   - Check AWS Cost Explorer for SNS SMS charges
   - Monitor verification requests

3. **Consider email as primary**:
   - Use SMS only for critical verifications
   - Prefer email for regular communications

---

## 📱 SMS Quick Reference

**Cognito Console**: https://console.aws.amazon.com/cognito/

**Path**: User Pool → Messaging → SMS → SMS templates → Verification code

**Placeholder**: `{####}` (4 hash symbols for verification code)

**Recommended Length**: Under 160 characters

**Phone Format**: E.164 (`+1234567890`)

**Cost**: ~$0.00645 per SMS (US), varies internationally

---

## 📧 Trip Invitation Email Template

Use these templates when sending trip invitations to users via email. These can be implemented in your application to send invites when users share trip invite codes.

---

## 🎨 Trip Invitation Email (HTML)

### Subject Line
```
You're Invited to a Trip on Tripy! 🎉
```

### Email Body (HTML)
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 32px;
            font-weight: bold;
            color: #2563eb;
            margin-bottom: 10px;
        }
        .title {
            font-size: 24px;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 20px;
            text-align: center;
        }
        .intro {
            font-size: 16px;
            color: #4b5563;
            margin-bottom: 30px;
        }
        .invite-code-container {
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            margin: 30px 0;
            color: white;
        }
        .invite-code-label {
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.9;
            margin-bottom: 10px;
        }
        .invite-code {
            font-size: 42px;
            font-weight: bold;
            letter-spacing: 4px;
            font-family: 'Courier New', monospace;
            margin: 15px 0;
        }
        .invite-link {
            display: inline-block;
            background-color: #fbbf24;
            color: #1f2937;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            margin-top: 20px;
            transition: background-color 0.3s;
        }
        .invite-link:hover {
            background-color: #f59e0b;
        }
        .trip-details {
            background-color: #f9fafb;
            border-left: 4px solid #2563eb;
            padding: 20px;
            margin: 30px 0;
            border-radius: 4px;
        }
        .trip-details-title {
            font-weight: 600;
            color: #1e40af;
            margin-bottom: 12px;
            font-size: 16px;
        }
        .trip-detail-item {
            margin: 8px 0;
            color: #4b5563;
            font-size: 14px;
        }
        .instructions {
            background-color: #eff6ff;
            border-left: 4px solid #2563eb;
            padding: 20px;
            margin: 30px 0;
            border-radius: 4px;
        }
        .instructions-title {
            font-weight: 600;
            color: #1e40af;
            margin-bottom: 12px;
        }
        .instructions-list {
            margin: 0;
            padding-left: 20px;
            color: #1e3a8a;
            font-size: 14px;
        }
        .instructions-list li {
            margin: 8px 0;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            font-size: 12px;
            color: #9ca3af;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">✈️ Tripy</div>
        </div>
        
        <div class="title">You're Invited to a Trip! 🎉</div>
        
        <div class="intro">
            <p>Hello!</p>
            
            <p><strong>{InviterName}</strong> has invited you to join a group trip on Tripy. Join your friends and start planning an amazing adventure together!</p>
            
            <p>Tripy helps you maximize your credit card points and find the best flight and hotel deals for your trip.</p>
        </div>
        
        <div class="invite-code-container">
            <div class="invite-code-label">Your Invite Code</div>
            <div class="invite-code">{INVITE_CODE}</div>
            <a href="{INVITE_URL}" class="invite-link">Join Trip Now →</a>
        </div>
        
        <div class="trip-details">
            <div class="trip-details-title">Trip Details</div>
            <div class="trip-detail-item"><strong>Trip:</strong> {TripName}</div>
            <div class="trip-detail-item"><strong>Dates:</strong> {StartDate} - {EndDate}</div>
            <div class="trip-detail-item"><strong>Destinations:</strong> {Destinations}</div>
            <div class="trip-detail-item"><strong>Organizer:</strong> {InviterName}</div>
        </div>
        
        <div class="instructions">
            <div class="instructions-title">How to Join:</div>
            <ol class="instructions-list">
                <li>Click the "Join Trip Now" button above, or visit: <strong>{INVITE_URL}</strong></li>
                <li>Sign in to your Tripy account (or create one if you're new)</li>
                <li>Enter your invite code: <strong>{INVITE_CODE}</strong></li>
                <li>Add your credit card points (optional but recommended)</li>
                <li>Start collaborating on the trip plan!</li>
            </ol>
        </div>
        
        <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
            <strong>Note:</strong> This invite link will expire in 7 days. If you have any questions, reach out to {InviterName} or reply to this email.
        </p>
        
        <div class="footer">
            <p>Looking forward to traveling with you!</p>
            <p>The Tripy Team</p>
            <p style="margin-top: 15px;">
                <a href="https://your-app.amplifyapp.com" style="color: #2563eb; text-decoration: none;">Visit Tripy</a>
            </p>
        </div>
    </div>
</body>
</html>
```

---

## 📝 Trip Invitation Email (Plain Text)

```
Subject: You're Invited to a Trip on Tripy! 🎉

Hello!

{InviterName} has invited you to join a group trip on Tripy. Join your friends and start planning an amazing adventure together!

Tripy helps you maximize your credit card points and find the best flight and hotel deals for your trip.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR INVITE CODE: {INVITE_CODE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Join Trip: {INVITE_URL}

Trip Details:
• Trip: {TripName}
• Dates: {StartDate} - {EndDate}
• Destinations: {Destinations}
• Organizer: {InviterName}

How to Join:
1. Click the invite link above or visit: {INVITE_URL}
2. Sign in to your Tripy account (or create one if you're new)
3. Enter your invite code: {INVITE_CODE}
4. Add your credit card points (optional but recommended)
5. Start collaborating on the trip plan!

Note: This invite link will expire in 7 days. If you have any questions, reach out to {InviterName}.

Looking forward to traveling with you!
The Tripy Team

Visit Tripy: https://your-app.amplifyapp.com
```

---

## 📱 Trip Invitation SMS Template

### Recommended Version (Under 160 characters)
```
🎉 {InviterName} invited you to join "{TripName}" on Tripy! Code: {INVITE_CODE}. Join: {INVITE_URL}
```
**Length**: ~120 characters (varies with names/URL)

### Detailed Version (Under 300 characters)
```
You're invited to a trip on Tripy! 🎉 {InviterName} wants you to join "{TripName}" ({StartDate}). Your invite code is {INVITE_CODE}. Join here: {INVITE_URL} Start planning your adventure!
```
**Length**: ~180 characters (varies with details)

### Simple Version (Under 100 characters)
```
Tripy invite from {InviterName}! Code: {INVITE_CODE} Join: {INVITE_URL}
```
**Length**: ~75 characters (varies)

### Minimal Version (Under 60 characters)
```
Tripy invite: {INVITE_CODE} {INVITE_URL}
```
**Length**: ~40 characters (varies)

---

## 🔧 Placeholder Variables for Invites

Replace these placeholders with actual values when sending:

- `{INVITE_CODE}` - The 8-character invite code (e.g., `a1b2c3d4`)
- `{INVITE_URL}` - Full invite URL (e.g., `https://your-app.amplifyapp.com/group/join/a1b2c3d4`)
- `{InviterName}` - Name of person sending invite (e.g., `John Doe`)
- `{TripName}` - Name of the trip (e.g., `European Adventure 2025`)
- `{StartDate}` - Trip start date (e.g., `June 15, 2025`)
- `{EndDate}` - Trip end date (e.g., `June 30, 2025`)
- `{Destinations}` - List of destinations (e.g., `Paris, Barcelona, Rome`)

---

## 💻 Implementation Example

These templates are designed to be used by your application code. Example implementation:

```python
# Example: Sending invite email via AWS SES
import boto3

ses_client = boto3.client('ses', region_name='us-east-1')

def send_trip_invite_email(
    recipient_email: str,
    invite_code: str,
    inviter_name: str,
    trip_name: str,
    start_date: str,
    end_date: str,
    destinations: str,
    frontend_url: str
):
    invite_url = f"{frontend_url}/group/join/{invite_code}"
    
    # Load HTML template
    html_template = open('trip_invite_email.html').read()
    
    # Replace placeholders
    html_body = html_template.format(
        INVITE_CODE=invite_code,
        INVITE_URL=invite_url,
        InviterName=inviter_name,
        TripName=trip_name,
        StartDate=start_date,
        EndDate=end_date,
        Destinations=destinations
    )
    
    # Send email via SES
    ses_client.send_email(
        Source='noreply@tripy.app',
        Destination={'ToAddresses': [recipient_email]},
        Message={
            'Subject': {'Data': "You're Invited to a Trip on Tripy! 🎉"},
            'Body': {'Html': {'Data': html_body}}
        }
    )
```

---

## ✅ Template Checklist

**Email Template**:
- [ ] Subject line set
- [ ] HTML template created
- [ ] Plain text version created (fallback)
- [ ] All placeholders documented
- [ ] Branding consistent with Tripy
- [ ] Clear call-to-action included

**SMS Template**:
- [ ] Short version under 160 characters
- [ ] Detailed version available
- [ ] Placeholders documented
- [ ] Invite code clearly displayed
- [ ] Invite URL included (shortened if needed)

---

## 📋 Quick Reference

**Email Subject**: `You're Invited to a Trip on Tripy! 🎉`

**SMS Format**: `🎉 {InviterName} invited you to join "{TripName}" on Tripy! Code: {INVITE_CODE}. Join: {INVITE_URL}`

**Invite URL Format**: `https://your-app.amplifyapp.com/group/join/{INVITE_CODE}`

**Invite Code Format**: 8-character alphanumeric (e.g., `a1b2c3d4`)

**Expiration**: 7 days (configurable in your application)
