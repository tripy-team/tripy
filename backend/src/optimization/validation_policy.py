"""
Validation policy configuration for connection protection.

This makes protection level requirements a PRODUCT DECISION, not a hardcoded rule.
"""

from dataclasses import dataclass, field
from typing import Set

from .enums import ConnectionProtection


@dataclass
class ValidationPolicy:
    """
    Policy for what connection types are allowed.
    
    This allows product teams to tune strictness without changing validator code.
    """
    
    # Which protection levels are allowed for connections?
    # Default (strict MVP): only airline protected
    allowed_protection_levels: Set[ConnectionProtection] = field(
        default_factory=lambda: {ConnectionProtection.AIRLINE_PROTECTED}
    )
    
    # Require explicit self_transfer=NO, or allow unknown?
    require_explicit_no_self_transfer: bool = True
    
    # Allow incomplete segments if protection is confirmed?
    allow_incomplete_with_protection: bool = True
    
    # Log dropped flights for debugging?
    log_drops: bool = True


# =============================================================================
# PREDEFINED POLICIES
# =============================================================================

STRICT_MVP_POLICY = ValidationPolicy(
    allowed_protection_levels={ConnectionProtection.AIRLINE_PROTECTED},
    require_explicit_no_self_transfer=True,
    allow_incomplete_with_protection=True,
)

# Future: allow OTA guarantees for users who opt-in
PERMISSIVE_POLICY = ValidationPolicy(
    allowed_protection_levels={
        ConnectionProtection.AIRLINE_PROTECTED,
        ConnectionProtection.OTA_GUARANTEE,  # Include OTA-protected
    },
    require_explicit_no_self_transfer=True,
    allow_incomplete_with_protection=True,
)

# For testing / debugging
ALLOW_ALL_POLICY = ValidationPolicy(
    allowed_protection_levels={
        ConnectionProtection.AIRLINE_PROTECTED,
        ConnectionProtection.OTA_GUARANTEE,
        ConnectionProtection.UNPROTECTED,
        ConnectionProtection.UNKNOWN,
    },
    require_explicit_no_self_transfer=False,
    allow_incomplete_with_protection=True,
)
