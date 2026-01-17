"""
JWT Authentication utilities for FastAPI
"""
import jwt
from typing import Optional, Dict, Any
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from src.config import USER_POOL_ID, AWS_REGION
import boto3
import logging

logger = logging.getLogger(__name__)

security = HTTPBearer()


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
            status_code=503,
            detail="Authentication service unavailable"
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
            raise HTTPException(
                status_code=401,
                detail="Invalid token format"
            )
    
    # Production: Verify token with Cognito
    try:
        # Get JWKS
        jwks = get_jwks()
        
        # Decode token header to get key ID
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        
        if not kid:
            raise HTTPException(
                status_code=401,
                detail="Token missing key ID"
            )
        
        # Find the key in JWKS
        key = None
        for jwk in jwks.get("keys", []):
            if jwk.get("kid") == kid:
                key = jwt.algorithms.RSAAlgorithm.from_jwk(jwk)
                break
        
        if not key:
            raise HTTPException(
                status_code=401,
                detail="Token key not found"
            )
        
        # Verify and decode token
        decoded = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=USER_POOL_ID,  # Verify audience
        )
        
        return decoded
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token has expired"
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=401,
            detail=f"Invalid token: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Token verification error: {str(e)}")
        raise HTTPException(
            status_code=401,
            detail="Token verification failed"
        )


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Security(security)
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
            raise HTTPException(
                status_code=401,
                detail="Token missing user ID"
            )
        
        return user_id
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting user ID: {str(e)}")
        raise HTTPException(
            status_code=401,
            detail="Authentication failed"
        )


def get_optional_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security, auto_error=False)
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
