# Cognito Integration - Assumptions and Setup

## Implementation Summary

The login workflow has been integrated with AWS Cognito and DynamoDB. The following describes the implementation and assumptions.

## Workflow

### Login Flow
1. User submits email and password
2. Backend authenticates with AWS Cognito using `USER_PASSWORD_AUTH` flow
3. On successful authentication, Cognito returns access token, ID token, and refresh token
4. Backend retrieves user information from Cognito using the access token
5. Backend ensures user record exists in DynamoDB (creates if new, updates if exists)
6. Backend returns user info and tokens to frontend
7. Frontend stores tokens in localStorage

### Sign Up Flow
1. User submits email, password, and optional name
2. Backend creates user in Cognito
3. Backend creates user record in DynamoDB
4. Cognito sends verification code to user's email
5. User confirms sign up with verification code
6. User can then log in

## Assumptions

### 1. Cognito Configuration
- **Assumption**: AWS Cognito User Pool is already created and configured
- **Assumption**: User Pool Client is configured with `USER_PASSWORD_AUTH` flow enabled
- **Assumption**: Self-signup is enabled in the User Pool
- **Assumption**: Email is used as the username/alias
- **Assumption**: Email verification is required (users receive confirmation code)

### 2. Environment Variables
The following environment variables MUST be set in your `.env` file:

```bash
# Required
USER_POOL_ID=<your-cognito-user-pool-id>
USER_POOL_CLIENT_ID=<your-cognito-user-pool-client-id>
AWS_REGION=us-west-2  # or your region
AWS_ACCESS_KEY_ID=<your-aws-access-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-key>

# Database tables (required)
USERS_TABLE=<your-users-table-name>
# ... other tables
```

### 3. AWS IAM Permissions
The application needs the following IAM permissions:

**Cognito Permissions:**
- `cognito-idp:InitiateAuth` - For login
- `cognito-idp:SignUp` - For user registration
- `cognito-idp:ConfirmSignUp` - For email verification
- `cognito-idp:GetUser` - For retrieving user info from token
- `cognito-idp:AdminGetUser` - (Optional, if using admin APIs)

**DynamoDB Permissions:**
- `dynamodb:PutItem` - For creating users
- `dynamodb:GetItem` - For reading users
- `dynamodb:UpdateItem` - For updating users
- `dynamodb:Query` - For querying users by email

### 4. Database Schema
**Assumption**: The `USERS_TABLE` in DynamoDB has the following structure:
- **Primary Key**: `userId` (String) - This matches Cognito's `sub` (subject) claim
- **Optional GSI**: `email-index` on `email` field for email lookups
- **Attributes**:
  - `userId` (String, required) - Cognito user ID (sub)
  - `email` (String, required)
  - `name` (String, optional)
  - `createdAt` (String, ISO timestamp)

### 5. Token Storage
- **Assumption**: Tokens are stored in `localStorage` on the frontend
- **Note**: In production, consider using httpOnly cookies or secure storage
- **Assumption**: Frontend will include `Authorization: Bearer <access_token>` header in subsequent API requests

### 6. Password Policy
- **Assumption**: Password policy matches Cognito User Pool configuration:
  - Minimum 8 characters
  - Requires digits
  - Requires lowercase letters
  - Uppercase and symbols optional (based on your Cognito config)

### 7. User ID Mapping
- **Assumption**: Cognito's `sub` (subject) claim is used as the `userId` in DynamoDB
- This ensures consistent user identification across systems
- The `sub` is immutable and unique per user

### 8. Error Handling
- **Assumption**: Authentication errors return 401 status code
- **Assumption**: Validation/configuration errors return 400 status code
- **Assumption**: Frontend handles token expiration and refresh logic (or uses refresh tokens)

### 9. Email Verification
- **Assumption**: Users must verify their email before logging in (if configured in Cognito)
- **Assumption**: Verification codes are sent via email
- **Assumption**: Verification codes expire (typically 24 hours, configurable in Cognito)

### 10. User Pool Client Configuration
- **Assumption**: User Pool Client is configured with:
  - `generateSecret: false` (public client, no client secret)
  - `authFlows: ["USER_PASSWORD_AUTH", "USER_SRP"]`
  - This allows password-based authentication from the backend

## API Endpoints

### POST /auth/login
- **Request**: `{ "email": string, "password": string }`
- **Response**: User info + tokens
- **Auth**: None (public endpoint)

### POST /auth/signup
- **Request**: `{ "email": string, "password": string, "firstName": string (optional), "lastName": string (optional) }`
- **Response**: User info + confirmation status
- **Auth**: None (public endpoint)

### POST /auth/confirm
- **Request**: `{ "email": string, "confirmation_code": string }`
- **Response**: Success message
- **Auth**: None (public endpoint)

## Security Considerations

1. **Token Storage**: Currently using localStorage (acceptable for MVP, but consider httpOnly cookies for production)
2. **HTTPS**: All API calls should use HTTPS in production
3. **Token Refresh**: Implement refresh token logic to handle expired access tokens
4. **CORS**: Configure CORS properly for your frontend domain
5. **Rate Limiting**: Consider adding rate limiting to prevent brute force attacks

## Testing

### Test Login
```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test1234"}'
```

### Test Sign Up
```bash
curl -X POST http://localhost:8000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@example.com", "password": "Test1234", "firstName": "Test", "lastName": "User"}'
```

### Test Confirm
```bash
curl -X POST http://localhost:8000/auth/confirm \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@example.com", "confirmation_code": "123456"}'
```

## Next Steps

1. **Update Frontend Login Page**: Connect the login form to use the new `/auth/login` endpoint
2. **Add Registration Page**: Create/update registration page to use `/auth/signup` and `/auth/confirm`
3. **Token Management**: Implement token refresh logic in frontend
4. **Protected Routes**: Add middleware to validate tokens on protected API endpoints
5. **Error Handling**: Improve error messages for better UX
