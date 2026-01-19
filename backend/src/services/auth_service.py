"""
AWS Cognito authentication service
"""
import boto3
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError
from src.config import USER_POOL_ID, USER_POOL_CLIENT_ID, AWS_REGION

_cognito_client = None


def get_cognito_client():
    """Get or create Cognito client"""
    global _cognito_client
    if _cognito_client is None:
        _cognito_client = boto3.client("cognito-idp", region_name=AWS_REGION)
    return _cognito_client


def authenticate_user(email: str, password: str) -> Dict[str, Any]:
    """
    Authenticate user with Cognito
    
    Args:
        email: User email
        password: User password
        
    Returns:
        Dictionary with authentication tokens and user info
        
    Raises:
        Exception: If authentication fails
    """
    if not USER_POOL_ID:
        raise ValueError("USER_POOL_ID not configured")
    if not USER_POOL_CLIENT_ID:
        raise ValueError("USER_POOL_CLIENT_ID not configured")
    
    client = get_cognito_client()
    
    try:
        # Authenticate using USER_PASSWORD_AUTH flow
        response = client.initiate_auth(
            ClientId=USER_POOL_CLIENT_ID,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={
                "USERNAME": email,
                "PASSWORD": password,
            },
        )
        
        authentication_result = response.get("AuthenticationResult", {})
        
        # Validate that all required tokens are present
        access_token = authentication_result.get("AccessToken")
        id_token = authentication_result.get("IdToken")
        refresh_token = authentication_result.get("RefreshToken")
        expires_in = authentication_result.get("ExpiresIn")
        
        if not access_token:
            raise Exception("Authentication failed: Access token not received")
        if not id_token:
            raise Exception("Authentication failed: ID token not received")
        if not refresh_token:
            raise Exception("Authentication failed: Refresh token not received")
        if not expires_in:
            raise Exception("Authentication failed: Token expiration not received")
        
        return {
            "AccessToken": access_token,
            "IdToken": id_token,
            "RefreshToken": refresh_token,
            "ExpiresIn": expires_in,
            "TokenType": authentication_result.get("TokenType", "Bearer"),
        }
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        
        if error_code == "NotAuthorizedException":
            raise Exception("Invalid email or password")
        elif error_code == "UserNotConfirmedException":
            raise Exception("User account is not confirmed. Please check your email.")
        elif error_code == "UserNotFoundException":
            raise Exception("User not found")
        else:
            raise Exception(f"Authentication failed: {error_message}")


def get_user_from_token(access_token: str) -> Dict[str, Any]:
    """
    Get user information from Cognito access token
    
    Args:
        access_token: Cognito access token
        
    Returns:
        Dictionary with user information
    """
    client = get_cognito_client()
    
    try:
        response = client.get_user(AccessToken=access_token)
        
        user_attributes = {attr["Name"]: attr["Value"] for attr in response.get("UserAttributes", [])}
        username = response.get("Username", "")
        
        return {
            "username": username,
            "email": user_attributes.get("email", ""),
            "email_verified": user_attributes.get("email_verified", "false") == "true",
            "sub": user_attributes.get("sub", username),  # Cognito user ID (sub)
            "user_status": response.get("UserStatus", ""),
        }
    except ClientError as e:
        raise Exception(f"Failed to get user info: {e.response.get('Error', {}).get('Message', '')}")


def sign_up_user(email: str, password: str, attributes: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """
    Sign up a new user in Cognito
    
    Args:
        email: User email
        password: User password
        attributes: Optional additional user attributes
        
    Returns:
        Dictionary with signup confirmation info
    """
    if not USER_POOL_ID:
        raise ValueError("USER_POOL_ID not configured")
    if not USER_POOL_CLIENT_ID:
        raise ValueError("USER_POOL_CLIENT_ID not configured")
    
    client = get_cognito_client()
    
    user_attributes = [{"Name": "email", "Value": email}]
    if attributes:
        for key, value in attributes.items():
            user_attributes.append({"Name": key, "Value": value})
    
    try:
        response = client.sign_up(
            ClientId=USER_POOL_CLIENT_ID,
            Username=email,
            Password=password,
            UserAttributes=user_attributes,
        )
        
        return {
            "UserSub": response.get("UserSub"),
            "CodeDeliveryDetails": response.get("CodeDeliveryDetails"),
            "UserConfirmed": response.get("UserConfirmed", False),
        }
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        
        if error_code == "UsernameExistsException":
            raise Exception("User already exists with this email")
        else:
            raise Exception(f"Sign up failed: {error_message}")


def confirm_sign_up(email: str, confirmation_code: str) -> bool:
    """
    Confirm user sign up with verification code
    
    Args:
        email: User email
        confirmation_code: Verification code sent to email
        
    Returns:
        True if successful
    """
    if not USER_POOL_CLIENT_ID:
        raise ValueError("USER_POOL_CLIENT_ID not configured")
    
    client = get_cognito_client()
    
    try:
        client.confirm_sign_up(
            ClientId=USER_POOL_CLIENT_ID,
            Username=email,
            ConfirmationCode=confirmation_code,
        )
        return True
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        
        if error_code == "CodeMismatchException":
            raise Exception("Invalid confirmation code")
        elif error_code == "ExpiredCodeException":
            raise Exception("Confirmation code has expired")
        else:
            raise Exception(f"Confirmation failed: {error_message}")


def refresh_tokens(refresh_token: str) -> Dict[str, Any]:
    """
    Refresh access and ID tokens using refresh token
    
    Args:
        refresh_token: Cognito refresh token
        
    Returns:
        Dictionary with new tokens
    """
    if not USER_POOL_CLIENT_ID:
        raise ValueError("USER_POOL_CLIENT_ID not configured")
    
    client = get_cognito_client()
    
    try:
        response = client.initiate_auth(
            ClientId=USER_POOL_CLIENT_ID,
            AuthFlow="REFRESH_TOKEN_AUTH",
            AuthParameters={
                "REFRESH_TOKEN": refresh_token,
            },
        )
        
        authentication_result = response.get("AuthenticationResult", {})
        
        access_token = authentication_result.get("AccessToken")
        id_token = authentication_result.get("IdToken")
        expires_in = authentication_result.get("ExpiresIn")
        
        if not access_token:
            raise Exception("Token refresh failed: Access token not received")
        if not id_token:
            raise Exception("Token refresh failed: ID token not received")
        
        return {
            "AccessToken": access_token,
            "IdToken": id_token,
            "ExpiresIn": expires_in,
            "TokenType": authentication_result.get("TokenType", "Bearer"),
        }
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        
        if error_code == "NotAuthorizedException":
            raise Exception("Invalid or expired refresh token")
        else:
            raise Exception(f"Token refresh failed: {error_message}")


def forgot_password(email: str) -> Dict[str, Any]:
    """
    Initiate password reset flow - sends verification code to user's email
    
    Args:
        email: User email
        
    Returns:
        Dictionary with code delivery details
    """
    if not USER_POOL_CLIENT_ID:
        raise ValueError("USER_POOL_CLIENT_ID not configured")
    
    client = get_cognito_client()
    
    try:
        response = client.forgot_password(
            ClientId=USER_POOL_CLIENT_ID,
            Username=email,
        )
        
        return {
            "CodeDeliveryDetails": response.get("CodeDeliveryDetails"),
        }
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        
        if error_code == "UserNotFoundException":
            # Don't reveal if user exists for security
            raise Exception("If an account exists with this email, a password reset code has been sent.")
        elif error_code == "LimitExceededException":
            raise Exception("Too many attempts. Please try again later.")
        else:
            raise Exception(f"Password reset failed: {error_message}")


def confirm_forgot_password(email: str, confirmation_code: str, new_password: str) -> bool:
    """
    Confirm password reset with verification code
    
    Args:
        email: User email
        confirmation_code: Verification code sent to email
        new_password: New password
        
    Returns:
        True if successful
    """
    if not USER_POOL_CLIENT_ID:
        raise ValueError("USER_POOL_CLIENT_ID not configured")
    
    client = get_cognito_client()
    
    try:
        client.confirm_forgot_password(
            ClientId=USER_POOL_CLIENT_ID,
            Username=email,
            ConfirmationCode=confirmation_code,
            Password=new_password,
        )
        return True
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        
        if error_code == "CodeMismatchException":
            raise Exception("Invalid confirmation code")
        elif error_code == "ExpiredCodeException":
            raise Exception("Confirmation code has expired")
        elif error_code == "InvalidPasswordException":
            raise Exception("Password does not meet requirements")
        else:
            raise Exception(f"Password reset failed: {error_message}")
