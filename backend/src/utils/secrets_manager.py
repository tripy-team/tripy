"""
Centralized Secrets Manager for Tripy.

This module provides a unified interface for accessing secrets, supporting both:
1. AWS Secrets Manager (recommended for production)
2. Environment variables (for local development)

Usage:
    from utils.secrets_manager import secrets
    
    # Get a secret (automatically uses the right source)
    api_key = secrets.get("OPENAI_ADMIN_KEY")
    
    # Get with default value
    api_key = secrets.get("OPTIONAL_KEY", default="")
    
    # Get required secret (raises error if missing)
    api_key = secrets.get_required("OPENAI_ADMIN_KEY")

Configuration:
    Set these environment variables to enable AWS Secrets Manager:
    - USE_SECRETS_MANAGER=true
    - SECRETS_MANAGER_SECRET_NAME=tripy/production/api-keys
    - AWS_REGION=us-east-1 (optional, defaults to us-east-1)

AWS Secrets Manager Setup:
    1. Create a secret in AWS Secrets Manager with JSON format:
       {
           "OPENAI_ADMIN_KEY": "sk-...",
           "CLAUDE_API_KEY": "sk-ant-...",
           "SERP_API_KEY": "...",
           "AWARDTOOL_API_KEY": "...",
           "AMADEUS_CLIENT_ID": "...",
           "AMADEUS_CLIENT_SECRET": "..."
       }
    2. Grant IAM permissions to your application to read the secret
    3. Set USE_SECRETS_MANAGER=true in your environment
"""

import os
import json
import logging
from typing import Optional, Dict, Any
from functools import lru_cache

logger = logging.getLogger(__name__)

# List of sensitive keys that should come from Secrets Manager in production
SENSITIVE_KEYS = frozenset([
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "OPENAI_ADMIN_KEY",
    "OPENAI_API_KEY",
    "CLAUDE_API_KEY",
    "SERP_API_KEY",
    "SERPAPI_KEY",
    "AWARDTOOL_API_KEY",
    "AWARD_TOOL_API_KEY",
    "AMADEUS_CLIENT_ID",
    "AMADEUS_CLIENT_SECRET",
])


class SecretsManager:
    """
    Unified secrets management with support for AWS Secrets Manager and env vars.
    
    In production (USE_SECRETS_MANAGER=true):
        - Fetches secrets from AWS Secrets Manager
        - Caches secrets to avoid repeated API calls
        - Falls back to environment variables for non-sensitive config
    
    In development (USE_SECRETS_MANAGER=false or unset):
        - Uses environment variables (from .env file via python-dotenv)
    """
    
    def __init__(self):
        self._secrets_cache: Optional[Dict[str, Any]] = None
        self._initialized = False
        self._use_secrets_manager = False
        self._secret_name: Optional[str] = None
        self._aws_region: str = "us-east-1"
    
    def _initialize(self):
        """Lazy initialization to avoid import-time AWS calls."""
        if self._initialized:
            return
        
        self._use_secrets_manager = (
            os.environ.get("USE_SECRETS_MANAGER", "false").lower() == "true"
        )
        self._secret_name = os.environ.get("SECRETS_MANAGER_SECRET_NAME")
        self._aws_region = os.environ.get("AWS_REGION", "us-east-1")
        
        if self._use_secrets_manager:
            if not self._secret_name:
                logger.error(
                    "USE_SECRETS_MANAGER=true but SECRETS_MANAGER_SECRET_NAME not set. "
                    "Falling back to environment variables."
                )
                self._use_secrets_manager = False
            else:
                logger.info(
                    f"[SECRETS] Using AWS Secrets Manager: {self._secret_name} "
                    f"(region: {self._aws_region})"
                )
                self._load_secrets_from_aws()
        else:
            logger.info("[SECRETS] Using environment variables for configuration")
        
        self._initialized = True
    
    def _load_secrets_from_aws(self) -> None:
        """Load secrets from AWS Secrets Manager and cache them."""
        try:
            import boto3
            from botocore.exceptions import ClientError
            
            client = boto3.client(
                service_name="secretsmanager",
                region_name=self._aws_region
            )
            
            response = client.get_secret_value(SecretId=self._secret_name)
            
            if "SecretString" in response:
                self._secrets_cache = json.loads(response["SecretString"])
                logger.info(
                    f"[SECRETS] Loaded {len(self._secrets_cache)} secrets from "
                    f"AWS Secrets Manager"
                )
            else:
                # Binary secrets not supported
                logger.error("[SECRETS] Binary secrets not supported")
                self._secrets_cache = {}
                
        except ImportError:
            logger.error(
                "[SECRETS] boto3 not installed. Install with: pip install boto3"
            )
            self._secrets_cache = {}
            self._use_secrets_manager = False
            
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code == "ResourceNotFoundException":
                logger.error(
                    f"[SECRETS] Secret '{self._secret_name}' not found in "
                    f"AWS Secrets Manager"
                )
            elif error_code == "AccessDeniedException":
                logger.error(
                    f"[SECRETS] Access denied to secret '{self._secret_name}'. "
                    f"Check IAM permissions."
                )
            else:
                logger.error(f"[SECRETS] AWS Secrets Manager error: {e}")
            
            self._secrets_cache = {}
            self._use_secrets_manager = False
            
        except json.JSONDecodeError as e:
            logger.error(f"[SECRETS] Invalid JSON in secret: {e}")
            self._secrets_cache = {}
            self._use_secrets_manager = False
        
        except Exception as e:
            logger.error(f"[SECRETS] Unexpected error loading secrets: {e}")
            self._secrets_cache = {}
            self._use_secrets_manager = False
    
    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """
        Get a secret or configuration value.
        
        Priority:
        1. AWS Secrets Manager (if enabled and key exists)
        2. Environment variable
        3. Default value
        
        Args:
            key: The secret/config key name
            default: Default value if not found
            
        Returns:
            The secret value or default
        """
        self._initialize()
        
        # Try AWS Secrets Manager first (for sensitive keys)
        if self._use_secrets_manager and self._secrets_cache:
            if key in self._secrets_cache:
                return self._secrets_cache[key]
        
        # Fall back to environment variable
        value = os.environ.get(key)
        if value is not None:
            return value
        
        return default
    
    def get_required(self, key: str) -> str:
        """
        Get a required secret. Raises error if not found.
        
        Args:
            key: The secret/config key name
            
        Returns:
            The secret value
            
        Raises:
            ValueError: If the secret is not found
        """
        value = self.get(key)
        if value is None:
            source = "AWS Secrets Manager" if self._use_secrets_manager else ".env"
            raise ValueError(
                f"Required secret '{key}' not found. "
                f"Please set it in {source} or environment variables."
            )
        return value
    
    def is_using_secrets_manager(self) -> bool:
        """Check if AWS Secrets Manager is being used."""
        self._initialize()
        return self._use_secrets_manager
    
    def get_all_secrets(self) -> Dict[str, str]:
        """
        Get all cached secrets (for debugging, use with caution).
        Only returns keys, not values, for security.
        """
        self._initialize()
        if self._secrets_cache:
            return {k: "***" for k in self._secrets_cache.keys()}
        return {}
    
    def refresh(self) -> None:
        """Force refresh secrets from AWS Secrets Manager."""
        if self._use_secrets_manager:
            logger.info("[SECRETS] Refreshing secrets from AWS Secrets Manager")
            self._load_secrets_from_aws()
    
    def is_sensitive_key(self, key: str) -> bool:
        """Check if a key is considered sensitive (should use Secrets Manager)."""
        return key in SENSITIVE_KEYS


# Global singleton instance
secrets = SecretsManager()


# Convenience functions
def get_secret(key: str, default: Optional[str] = None) -> Optional[str]:
    """Get a secret value. See SecretsManager.get() for details."""
    return secrets.get(key, default)


def get_required_secret(key: str) -> str:
    """Get a required secret. See SecretsManager.get_required() for details."""
    return secrets.get_required(key)


# =============================================================================
# MIGRATION HELPERS
# =============================================================================

def get_api_keys() -> Dict[str, Optional[str]]:
    """
    Get all API keys in a single call.
    Useful for modules that need multiple keys.
    """
    return {
        "OPENAI_ADMIN_KEY": secrets.get("OPENAI_ADMIN_KEY"),
        "CLAUDE_API_KEY": secrets.get("CLAUDE_API_KEY"),
        "SERP_API_KEY": secrets.get("SERP_API_KEY") or secrets.get("SERPAPI_KEY"),
        "AWARDTOOL_API_KEY": (
            secrets.get("AWARDTOOL_API_KEY") or secrets.get("AWARD_TOOL_API_KEY")
        ),
        "AMADEUS_CLIENT_ID": secrets.get("AMADEUS_CLIENT_ID"),
        "AMADEUS_CLIENT_SECRET": secrets.get("AMADEUS_CLIENT_SECRET"),
    }


def validate_api_keys(required_keys: list[str]) -> tuple[bool, list[str]]:
    """
    Validate that required API keys are present.
    
    Args:
        required_keys: List of key names to check
        
    Returns:
        Tuple of (all_present, missing_keys)
    """
    api_keys = get_api_keys()
    missing = [k for k in required_keys if not api_keys.get(k)]
    return len(missing) == 0, missing
