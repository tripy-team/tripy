"""
JWT Authentication utilities for FastAPI

Supports both authenticated users (Cognito JWT) and anonymous sessions (UUID v4).
Anonymous sessions allow trip generation without sign-in.
"""

import uuid
import jwt
from typing import Optional, Dict, Any
from fastapi import HTTPException, Security, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from src.config import USER_POOL_ID, USER_POOL_CLIENT_ID, AWS_REGION
import boto3
import logging

logger = logging.getLogger(__name__)

security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

# Prefix for anonymous session IDs to distinguish from Cognito user IDs
ANON_PREFIX = "anon_"


def get_jwks_url() -> str:
    """Get JWKS URL for Cognito User Pool"""
    if not USER_POOL_ID:
        raise ValueError("USER_POOL_ID not configured")
    region = AWS_REGION
    return f"https://cognito-idp.{region}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"


def get_jwks() -> Dict[str, Any]:
    """Get JWKS (JSON Web Key Set) from Cognito"""
    import httpx

    jwks_url = get_jwks_url()
    try:
        response = httpx.get(jwks_url, timeout=5)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch JWKS: {str(e)}")
        raise HTTPException(
            status_code=503, detail="Authentication service unavailable"
        )


def verify_token(token: str) -> Dict[str, Any]:
    """
    Verify JWT token and return decoded claims.

    For MVP, we'll use a simpler approach:
    - If Cognito is configured, verify the token
    - Otherwise, allow tokens to pass through (for development)
    """
    if not USER_POOL_ID:
        # Development mode: decode token without verification
        # WARNING: Only for development/testing
        try:
            decoded = jwt.decode(token, options={"verify_signature": False})
            return decoded
        except jwt.DecodeError:
            raise HTTPException(status_code=401, detail="Invalid token format")

    # Production: Verify token with Cognito
    try:
        # Get JWKS
        jwks = get_jwks()

        # Decode token header to get key ID
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        if not kid:
            raise HTTPException(status_code=401, detail="Token missing key ID")

        # Find the key in JWKS
        key = None
        for jwk in jwks.get("keys", []):
            if jwk.get("kid") == kid:
                key = jwt.algorithms.RSAAlgorithm.from_jwk(jwk)
                break

        if not key:
            raise HTTPException(status_code=401, detail="Token key not found")

        # Verify and decode token
        # For Cognito tokens:
        # - ID tokens have 'aud' claim set to client ID and 'iss' claim set to user pool
        # - Access tokens may not have 'aud' claim and may have different issuer format
        # Try multiple verification strategies
        issuer = f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{USER_POOL_ID}"

        # Try to decode with audience verification first (for ID tokens)
        audience = USER_POOL_CLIENT_ID if USER_POOL_CLIENT_ID else USER_POOL_ID
        decoded = None
        last_error = None

        # Strategy 1: Try with both audience and issuer (for ID tokens)
        try:
            decoded = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=audience,
                issuer=issuer,
            )
            logger.debug("Token verified as ID token with audience and issuer")
        except (jwt.InvalidAudienceError, jwt.InvalidTokenError) as e:
            # Audience-related problem (e.g. missing or mismatched aud claim) - treat as access token
            logger.debug(
                f"Token audience verification failed or aud missing, trying access-token strategies: {str(e)}"
            )
            # Strategy 2: Try with issuer only (for access tokens with issuer)
            try:
                decoded = jwt.decode(
                    token,
                    key,
                    algorithms=["RS256"],
                    issuer=issuer,
                    options={"verify_aud": False},
                )
                logger.debug("Token verified as access token with issuer")
            except jwt.InvalidIssuerError:
                # Strategy 3: Try without issuer verification (for access tokens without issuer claim)
                logger.debug(
                    "Token issuer verification failed, trying without issuer check"
                )
                try:
                    decoded = jwt.decode(
                        token,
                        key,
                        algorithms=["RS256"],
                        options={"verify_aud": False, "verify_iss": False},
                    )
                    # Manually verify the token is from our user pool by checking the token_use claim
                    token_use = decoded.get("token_use")
                    if token_use not in ["access", "id"]:
                        raise HTTPException(
                            status_code=401, detail="Invalid token type"
                        )
                    # Verify the client_id matches for access tokens
                    client_id = decoded.get("client_id")
                    if client_id and client_id != USER_POOL_CLIENT_ID:
                        logger.warning(
                            f"Token client_id mismatch. Expected: {USER_POOL_CLIENT_ID}, Got: {client_id}"
                        )
                        raise HTTPException(
                            status_code=401, detail="Invalid token client"
                        )
                    logger.debug("Token verified without issuer check (access token)")
                except jwt.InvalidTokenError as e_inner:
                    last_error = e_inner
        except jwt.InvalidIssuerError as e:
            # If issuer fails on first try, try without issuer
            logger.debug(
                "Token issuer verification failed on first attempt, trying without issuer check"
            )
            try:
                decoded = jwt.decode(
                    token,
                    key,
                    algorithms=["RS256"],
                    options={"verify_aud": False, "verify_iss": False},
                )
                # Manually verify token_use and client_id
                token_use = decoded.get("token_use")
                if token_use not in ["access", "id"]:
                    raise HTTPException(status_code=401, detail="Invalid token type")
                client_id = decoded.get("client_id")
                if client_id and client_id != USER_POOL_CLIENT_ID:
                    logger.warning(
                        f"Token client_id mismatch. Expected: {USER_POOL_CLIENT_ID}, Got: {client_id}"
                    )
                    raise HTTPException(status_code=401, detail="Invalid token client")
                logger.debug("Token verified without issuer check")
            except jwt.InvalidTokenError as e_inner:
                last_error = e_inner

        if decoded is None:
            if last_error:
                raise last_error
            raise HTTPException(status_code=401, detail="Token verification failed")

        return decoded
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid token error: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error(f"Token verification error: {type(e).__name__}: {str(e)}")
        raise HTTPException(
            status_code=401, detail=f"Token verification failed: {str(e)}"
        )


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> str:
    """
    Dependency to get current user ID from JWT token.
    Use this in FastAPI route dependencies.
    """
    token = credentials.credentials
    try:
        claims = verify_token(token)
        user_id = claims.get("sub")  # Cognito user ID

        if not user_id:
            logger.warning("Token verified but missing 'sub' claim")
            raise HTTPException(status_code=401, detail="Token missing user ID")

        logger.debug(f"Successfully extracted user ID: {user_id}")
        return user_id
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting user ID: {type(e).__name__}: {str(e)}")
        raise HTTPException(status_code=401, detail="Authentication failed")


def get_optional_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_security),
) -> Optional[str]:
    """
    Dependency to optionally get current user ID from JWT token.
    Returns None if no token is provided (for endpoints that work with or without auth).
    """
    if not credentials:
        return None

    try:
        return get_current_user_id(credentials)
    except HTTPException:
        return None


def is_anonymous(user_or_anon_id: str) -> bool:
    """Check if the given ID is an anonymous session ID."""
    return user_or_anon_id.startswith(ANON_PREFIX)


def get_user_or_anon_id(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_security),
) -> str:
    """
    Dependency that returns either:
    - Authenticated user ID (from JWT token), OR
    - Anonymous session ID (from X-Anon-Session header, or generates a new one)

    This allows trip generation without sign-in.
    The returned ID is always a string:
    - Cognito user IDs look like UUIDs (e.g., "a1b2c3d4-...")
    - Anonymous session IDs are prefixed with "anon_" (e.g., "anon_a1b2c3d4-...")
    """
    # Try authenticated user first
    if credentials:
        try:
            user_id = get_current_user_id(credentials)
            if user_id:
                return user_id
        except HTTPException:
            pass  # Fall through to anonymous

    # Check for anonymous session header
    anon_session_id = request.headers.get("X-Anon-Session-Id")
    if anon_session_id:
        validated = _validate_anon_session_id(anon_session_id)
        if validated:
            logger.debug(f"Using anonymous session: {validated}")
            return validated
        else:
            # Invalid header — generate a new one instead of erroring
            logger.warning(f"Invalid X-Anon-Session-Id header (length={len(anon_session_id)}), generating new")

    # Generate a new anonymous session ID
    new_anon_id = f"{ANON_PREFIX}{uuid.uuid4()}"
    logger.info(f"Generated new anonymous session: {new_anon_id}")
    return new_anon_id


def _validate_anon_session_id(raw: str) -> Optional[str]:
    """
    Validate and normalize an anonymous session ID.
    
    Rules:
    - Must start with "anon_" (or we prepend it)
    - Must contain a valid UUID after the prefix
    - Reject overly long values (> 100 chars) to prevent header abuse
    - Returns normalized ID or None if invalid
    """
    if not raw or not isinstance(raw, str):
        return None
    
    # Reject overly long values
    if len(raw) > 100:
        return None
    
    # Strip whitespace
    raw = raw.strip()
    
    # Extract the UUID part
    if raw.startswith(ANON_PREFIX):
        uuid_part = raw[len(ANON_PREFIX):]
    else:
        uuid_part = raw
    
    # Validate UUID format
    try:
        parsed = uuid.UUID(uuid_part)
        return f"{ANON_PREFIX}{parsed}"
    except (ValueError, AttributeError):
        return None
