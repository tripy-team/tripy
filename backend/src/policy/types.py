"""
Policy types for the booking reality engine.

These types are used throughout the policy engine and are included
in API responses for frontend rendering.
"""

from typing import Literal, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum


# =============================================================================
# SEVERITY LEVELS
# =============================================================================

PolicySeverity = Literal["info", "warn", "block"]
"""
Severity levels for policy messages:
- info: Informational only, no action needed
- warn: User should be aware, may require acknowledgment
- block: Cannot proceed without resolution or explicit acknowledgment
"""


class PolicySeverityEnum(str, Enum):
    """Enum version for use in Pydantic models."""
    INFO = "info"
    WARN = "warn"
    BLOCK = "block"


# =============================================================================
# POLICY MESSAGE
# =============================================================================

class PolicyMessage(BaseModel):
    """
    A single policy message with code, severity, and explanation.
    
    These are attached to flight/hotel options to explain policy decisions.
    Frontend uses these to render warnings, blocks, and acknowledgment prompts.
    """
    code: str = Field(
        ...,
        description="Namespaced reason code (e.g., FLIGHT_UNPROTECTED_CONNECTION)"
    )
    severity: PolicySeverity = Field(
        ...,
        description="info, warn, or block"
    )
    title: str = Field(
        ...,
        description="Short human-readable title for the message"
    )
    detail: str = Field(
        ...,
        description="Longer explanation with context"
    )
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional context (e.g., airport, minutes, amounts)"
    )
    
    # For acknowledgment tracking
    requires_ack: bool = Field(
        default=False,
        description="Whether this message requires explicit user acknowledgment"
    )
    ack_text: Optional[str] = Field(
        default=None,
        description="Text for the acknowledgment checkbox if requires_ack=True"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "code": "FLIGHT_BELOW_MCT",
                "severity": "block",
                "title": "Connection time is below minimum",
                "detail": "The 45 minute connection at ORD is below the 60 minute minimum for international connections. You may miss your connection even if your first flight is on time.",
                "context": {
                    "airport": "ORD",
                    "layover_minutes": 45,
                    "required_mct": 60,
                    "connection_type": "international"
                },
                "requires_ack": True,
                "ack_text": "I understand I may miss my connection"
            }
        }


# =============================================================================
# POLICY EVALUATION
# =============================================================================

class PolicyEvaluation(BaseModel):
    """
    Complete policy evaluation for an itinerary or option.
    
    Includes all blocks, warnings, info messages, and acknowledgments.
    This is attached to every flight/hotel option in API responses.
    """
    # Categorized messages
    blocks: list[PolicyMessage] = Field(
        default_factory=list,
        description="Messages that prevent selection (in safe/balanced modes)"
    )
    warnings: list[PolicyMessage] = Field(
        default_factory=list,
        description="Messages that warn but allow selection"
    )
    info: list[PolicyMessage] = Field(
        default_factory=list,
        description="Informational messages only"
    )
    
    # Acknowledgment tracking
    requires_ack: list[str] = Field(
        default_factory=list,
        description="List of reason codes that require explicit acknowledgment"
    )
    
    # Summary
    is_blocked: bool = Field(
        default=False,
        description="True if any blocks exist (in current mode)"
    )
    risk_score: int = Field(
        default=0,
        description="Aggregate risk score for ranking (higher = riskier)"
    )
    
    # Explanation
    explanations: list[str] = Field(
        default_factory=list,
        description="Plain-text explanations of policy decisions"
    )
    
    def add_message(self, message: PolicyMessage):
        """Add a message to the appropriate category."""
        if message.severity == "block":
            self.blocks.append(message)
            self.is_blocked = True
        elif message.severity == "warn":
            self.warnings.append(message)
        else:
            self.info.append(message)
        
        if message.requires_ack:
            if message.code not in self.requires_ack:
                self.requires_ack.append(message.code)
    
    def merge(self, other: "PolicyEvaluation"):
        """Merge another evaluation into this one."""
        self.blocks.extend(other.blocks)
        self.warnings.extend(other.warnings)
        self.info.extend(other.info)
        self.requires_ack.extend(
            code for code in other.requires_ack 
            if code not in self.requires_ack
        )
        self.is_blocked = self.is_blocked or other.is_blocked
        self.risk_score += other.risk_score
        self.explanations.extend(other.explanations)
    
    @classmethod
    def empty(cls) -> "PolicyEvaluation":
        """Create an empty evaluation (no issues)."""
        return cls()
    
    def to_dict(self) -> dict:
        """Convert to dict for API responses."""
        return {
            "blocks": [m.model_dump() for m in self.blocks],
            "warnings": [m.model_dump() for m in self.warnings],
            "info": [m.model_dump() for m in self.info],
            "requires_ack": self.requires_ack,
            "is_blocked": self.is_blocked,
            "risk_score": self.risk_score,
            "explanations": self.explanations,
        }
    
    class Config:
        json_schema_extra = {
            "example": {
                "blocks": [],
                "warnings": [
                    {
                        "code": "FLIGHT_SELF_TRANSFER_RISK",
                        "severity": "warn",
                        "title": "Self-transfer required",
                        "detail": "You must collect bags and re-check in at the connection.",
                        "context": {"airport": "LHR"},
                        "requires_ack": True,
                        "ack_text": "I understand this is a self-transfer"
                    }
                ],
                "info": [],
                "requires_ack": ["FLIGHT_SELF_TRANSFER_RISK"],
                "is_blocked": False,
                "risk_score": 800,
                "explanations": [
                    "This itinerary requires self-transfer at LHR"
                ]
            }
        }


# =============================================================================
# ACKNOWLEDGMENT REQUEST
# =============================================================================

class PolicyAcknowledgment(BaseModel):
    """
    User acknowledgment of policy warnings.
    
    Sent with booking/selection requests to confirm user understands risks.
    """
    acknowledged_codes: list[str] = Field(
        default_factory=list,
        description="List of reason codes the user has acknowledged"
    )
    acknowledged_at: Optional[str] = Field(
        default=None,
        description="ISO timestamp when acknowledgment was given"
    )
    
    def has_acknowledged(self, code: str) -> bool:
        """Check if a specific code has been acknowledged."""
        return code in self.acknowledged_codes


# =============================================================================
# POLICY SUMMARY (for aggregate results)
# =============================================================================

class PolicySummary(BaseModel):
    """
    Summary of policy evaluation across multiple options.
    
    Used in search results to show overall policy status.
    """
    total_options: int = 0
    blocked_count: int = 0
    warning_count: int = 0
    
    # Code distribution
    code_counts: dict[str, int] = Field(
        default_factory=dict,
        description="Count of each reason code across all options"
    )
    
    # Mode used
    risk_mode: str = "balanced"
    
    def add_evaluation(self, evaluation: PolicyEvaluation):
        """Update summary with an evaluation."""
        self.total_options += 1
        if evaluation.is_blocked:
            self.blocked_count += 1
        if evaluation.warnings:
            self.warning_count += 1
        
        for msg in evaluation.blocks + evaluation.warnings + evaluation.info:
            self.code_counts[msg.code] = self.code_counts.get(msg.code, 0) + 1
