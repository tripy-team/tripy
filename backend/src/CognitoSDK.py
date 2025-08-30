import boto3
from dotenv import load_dotenv
import os
from phone_number_validator.validator import PhoneNumberValidator
from email_validator import validate_email, EmailNotValidError
import uuid
from botocore.exceptions import ClientError
from enum import Enum


class UserPool:
    def __init__(self, session):
        cognito_client = session.client("cognito-idp")
        response = cognito_client.create_user_pool(
            PoolName="tripy-users",
            Policies={
                "PasswordPolicy": {
                    "MinimumLength": 12,
                    "RequireUpperCase": True,
                    "RequireLowercase": True,
                    "RequireNumbers": True,
                    "RequireSymbols": True,
                    "PasswordHistorySize": 8,
                },
                "SignInPolicy": {"AllowedFirstAuthFactors": ["PASSWORD"]},
            },
            DeletionProtection="ACTIVE",
            LambdaConfig={},
        )
        self.response = response
        self.cognito_client = cognito_client
        self.user_pool_id = response["UserPool"]["Id"]


class UserPoolClient:
    def __init__(self):
        userpool = UserPool()
        cognito_client = userpool.cognito_client
        user_id = userpool.user_pool_id
        response = cognito_client.create_user_pool_client(
            UserPoolId=user_id, ClientName=os.getenv("USER_POOL_CLIENT_NAME")
        )
        self.response = response
        self.userpool = userpool
        self.client_id = response["UserPoolClient"]["ClientId"]


class AuthFlow(Enum):
    USER_PASSWORD_AUTH = "USER_PASSWORD_AUTH"
    USER_AUTH = "USER_AUTH"


class Cognito:
    def __init__(
        self,
        first_name,
        last_name,
        email,
        phone,
        password,
        birthdate,
        gender,
    ):
        userpool_client = UserPoolClient()
        self.userpool_client = userpool_client
        self.userpool = userpool_client.userpool
        self.cognito_client = userpool_client.userpool.cognito_client
        self.first_name = first_name
        self.last_name = last_name
        self.email = email
        self.phone = phone
        self.password = password
        self.birthdate = birthdate
        self.gender = gender
        self.referral_code = uuid.uuid4()

    def validate_user_info(self, check_deliverability=False):
        load_dotenv()
        user_email = self.email
        phone_number = self.phone
        try:
            email_info = validate_email(user_email, check_deliverability)
            email = email_info.normalized
        except EmailNotValidError as e:
            assert f"Email {user_email} is not valid"
        phone_validator = PhoneNumberValidator(api_key=os.getenv("NUMLOOKUP_API_KEY"))
        assert (
            phone_validator.validate(phone_number) == True
        ), f"{phone_number} is not valid"
        return {"success": True, "response": {"email": email, "phone": phone_number}}

    def register_user(self):
        assert self.validate_user_info(True)["success"] == False
        response = self.cognito_client.sign_up(
            ClientId=self.client_id,
            Username=self.email,
            Password=self.password,
            UserAttributes=[
                {"Name": "first_name", "Value": self.first_name},
                {"Name": "last_name", "Value": self.last_name},
                {"Name": "phone", "Value": self.phone},
                {"Name": "birthdate", "Value": self.birthdate},
                {"Name": "gender", "Value": self.gender},
                {"Name": "referral_code", "Value": self.referral_code},
                {"Name": "credit_card_points", " Value": "{}"},
                {"Name": "airline_points", " Value": "{}"},
                {"Name": "hotel_points", " Value": "{}"},
            ],
        )
        session_id = response["Session"]
        confirmation_code = "insert from frontend"
        self.confirm_registration(confirmation_code)
        return {"success": True, "response": response}

    def confirm_registration(self, confirmation_code):
        response = self.cognito_client.confirm_sign_up(
            ClientId=self.userpool_client.client_id,
            Username=self.email,
            ConfirmationCode=confirmation_code,
        )
        return response

    def get_password_authflow_from_frontend() -> AuthFlow:
        return

    def create_initiate_auth_params(self, authflow: AuthFlow):
        params = {
            "ClientId": self.userpool_client.client_id,
            "AuthFlow": authflow.value,
        }
        if authflow.value == "USER_AUTH":
            params["AuthParameters"] = {
                "USERNAME": self.email,
                "PREFERRED_CHALLENGE": "insert",
            }
            return params
        elif authflow.value == "USER_PASSWORD_AUTH":
            params["AuthParameters"] = {
                "USERNAME": self.email,
                "PASSWORD": self.password,
            }
            return params
        else:
            raise Exception("authflow not correct")

    def login(self):
        try:
            response = self.cognito_client.initiate_auth(
                self.create_initiate_auth_params()
            )
            if "ChallengeName" in response:
                return {
                    "success": False,
                    "challenge": response["ChallengeName"],
                    "challenge_parameters": response.get("ChallengeParameters", {}),
                    "session": response.get("Session"),
                }
            auth_result = response["AuthenticationResult"]
            id_token = auth_result["IdToken"]
            user_info = self._decode_token(id_token)
            return {
                "success": True,
                "access_token": auth_result["AccessToken"],
                "id_token": id_token,
                "refresh_token": auth_result["RefreshToken"],
                "token_type": auth_result["TokenType"],
                "expires_in": auth_result["ExpiresIn"],
                "user_info": user_info,
            }

        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            raise Exception(f"Login failed: {error_code} - {error_message}")

    def refresh_tokens(self, refresh_token: str, username: str) -> Dict[str, Any]:
        """
        Refresh access and ID tokens using refresh token

        Args:
            refresh_token: Refresh token
            username: Username

        Returns:
            Dict containing new tokens

        Raises:
            CognitoAuthError: If token refresh fails
        """
        try:
            params = {
                "ClientId": self.client_id,
                "AuthFlow": "REFRESH_TOKEN_AUTH",
                "AuthParameters": {"REFRESH_TOKEN": refresh_token},
            }

            secret_hash = self._calculate_secret_hash(username)
            if secret_hash:
                params["AuthParameters"]["SECRET_HASH"] = secret_hash

            response = self.cognito_client.initiate_auth(**params)
            auth_result = response["AuthenticationResult"]

            return {
                "success": True,
                "access_token": auth_result["AccessToken"],
                "id_token": auth_result["IdToken"],
                "token_type": auth_result["TokenType"],
                "expires_in": auth_result["ExpiresIn"],
            }

        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            raise CognitoAuthError(
                f"Token refresh failed: {error_code} - {error_message}"
            )

    def logout(self, access_token: str) -> Dict[str, Any]:
        """
        Sign out user globally

        Args:
            access_token: User's access token

        Returns:
            Dict containing logout response

        Raises:
            CognitoAuthError: If logout fails
        """
        try:
            self.cognito_client.global_sign_out(AccessToken=access_token)

            return {"success": True, "message": "User signed out successfully"}

        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            raise CognitoAuthError(f"Logout failed: {error_code} - {error_message}")

    def forgot_password(self, username: str) -> Dict[str, Any]:
        """
        Initiate forgot password flow

        Args:
            username: Username

        Returns:
            Dict containing forgot password response

        Raises:
            CognitoAuthError: If forgot password fails
        """
        try:
            params = {"ClientId": self.client_id, "Username": username}

            secret_hash = self._calculate_secret_hash(username)
            if secret_hash:
                params["SecretHash"] = secret_hash

            response = self.cognito_client.forgot_password(**params)

            return {
                "success": True,
                "code_delivery_details": response["CodeDeliveryDetails"],
                "message": "Password reset code sent",
            }

        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            raise CognitoAuthError(
                f"Forgot password failed: {error_code} - {error_message}"
            )

    def confirm_forgot_password(
        self, username: str, confirmation_code: str, new_password: str
    ) -> Dict[str, Any]:
        """
        Confirm forgot password with new password

        Args:
            username: Username
            confirmation_code: Confirmation code
            new_password: New password

        Returns:
            Dict containing confirmation response

        Raises:
            CognitoAuthError: If password reset fails
        """
        try:
            params = {
                "ClientId": self.client_id,
                "Username": username,
                "ConfirmationCode": confirmation_code,
                "Password": new_password,
            }

            secret_hash = self._calculate_secret_hash(username)
            if secret_hash:
                params["SecretHash"] = secret_hash

            self.cognito_client.confirm_forgot_password(**params)

            return {"success": True, "message": "Password reset successfully"}

        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            raise CognitoAuthError(
                f"Password reset failed: {error_code} - {error_message}"
            )

    def verify_token(self, token: str) -> Dict[str, Any]:
        """
        Verify and decode a JWT token

        Args:
            token: JWT token to verify

        Returns:
            Dict containing token payload if valid

        Raises:
            CognitoAuthError: If token is invalid
        """
        try:
            # Get JWKS
            jwks = self._get_jwks()

            # Decode header to get kid
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")

            if not kid:
                raise CognitoAuthError("Token missing kid in header")

            # Find the correct key
            key = None
            for jwk in jwks["keys"]:
                if jwk["kid"] == kid:
                    key = jwk
                    break

            if not key:
                raise CognitoAuthError("Unable to find appropriate key")

            # Convert JWK to PEM
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))

            # Verify and decode token
            payload = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=self.client_id,
                issuer=f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}",
            )

            return {"success": True, "payload": payload, "valid": True}

        except jwt.InvalidTokenError as e:
            raise CognitoAuthError(f"Invalid token: {str(e)}")
        except Exception as e:
            raise CognitoAuthError(f"Token verification failed: {str(e)}")

    def _decode_token(self, token: str) -> Dict[str, Any]:
        """Decode token without verification (for getting user info)"""
        try:
            payload = jwt.decode(token, options={"verify_signature": False})
            return payload
        except Exception as e:
            raise CognitoAuthError(f"Token decode failed: {str(e)}")

    def _get_jwks(self) -> Dict[str, Any]:
        """Get JWKS with caching"""
        now = datetime.now()

        # Cache JWKS for 1 hour
        if (
            self._jwks_cache
            and self._jwks_cache_time
            and now - self._jwks_cache_time < timedelta(hours=1)
        ):
            return self._jwks_cache

        try:
            response = requests.get(self.jwks_url, timeout=10)
            response.raise_for_status()

            self._jwks_cache = response.json()
            self._jwks_cache_time = now

            return self._jwks_cache

        except requests.RequestException as e:
            raise CognitoAuthError(f"Failed to fetch JWKS: {str(e)}")


# Example usage and helper functions
class CognitoAuthMiddleware:
    """Middleware for token validation in web applications"""

    def __init__(self, cognito_sdk: Cognito):
        self.cognito_sdk = cognito_sdk

    def validate_request(self, headers: Dict[str, str]) -> Dict[str, Any]:
        """
        Validate request with Bearer token

        Args:
            headers: Request headers

        Returns:
            Dict containing validation result and user info
        """
        auth_header = headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return {"valid": False, "error": "Missing or invalid Authorization header"}

        token = auth_header[7:]  # Remove 'Bearer ' prefix

        try:
            result = self.cognito_sdk.verify_token(token)
            return {"valid": True, "user": result["payload"], "token": token}
        except CognitoAuthError as e:
            return {"valid": False, "error": str(e)}


# Usage example
if __name__ == "__main__":
    # Initialize SDK
    cognito = Cognito(
        user_pool_id="us-east-1_XXXXXXXXX",
        client_id="your-client-id",
        client_secret="your-client-secret",  # Optional
        region="us-east-1",
    )

    try:
        # Register user
        result = cognito.register_user(
            username="testuser", password="TempPassword123!", email="test@example.com"
        )
        print("Registration:", result)

        # Confirm registration (if required)
        if result["confirmation_required"]:
            confirm_result = cognito.confirm_registration("testuser", "123456")
            print("Confirmation:", confirm_result)

        # Login
        login_result = cognito.login("testuser", "TempPassword123!")
        print("Login:", login_result)

        if login_result["success"]:
            access_token = login_result["access_token"]

            # Get user info
            user_info = cognito.get_user_info(access_token)
            print("User Info:", user_info)

            # Logout
            logout_result = cognito.logout(access_token)
            print("Logout:", logout_result)

    except CognitoAuthError as e:
        print(f"Auth Error: {e}")

    def get_users_information_from_cognito(self):
        response = self.cognito_client.list_users(
            UserPoolId=self.userpool.user_pool_id,
            Username=self.email,
        )
        return response


if __name__ == "__main__":
    cognito = Cognito()
