"""
Booking Workflow Service

Implements the complete booking workflow including:
- TASK 09: Booking order dependency flags
- TASK 10: Risk score calculation
- TASK 11: Approvals and veto workflow
- TASK 12: Booking checklist and confirmation tracking

This aligns with docs/GROUP_TRIP_WORKFLOW.md specification.
"""

import uuid
from enum import Enum
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Set, Any, Tuple
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


# =============================================================================
# TASK 09: BOOKING ORDER DEPENDENCY FLAGS
# =============================================================================

class BookingDependencyType(str, Enum):
    """Types of booking dependencies."""
    HOLD_BEFORE_TRANSFER = "hold_before_transfer"
    BOOKING_BEFORE_TRANSFER = "booking_before_transfer"
    TRANSFER_BEFORE_BOOKING = "transfer_before_booking"
    SEQUENTIAL_BOOKING = "sequential_booking"


@dataclass
class BookingDependency:
    """A dependency between booking steps."""
    dependency_id: str
    dependency_type: BookingDependencyType
    
    # What must happen first
    prerequisite_step_id: str
    prerequisite_description: str
    
    # What depends on it
    dependent_step_id: str
    dependent_description: str
    
    # Why this dependency exists
    reason: str
    
    # Is this a hard blocker or just recommended?
    is_hard_blocker: bool = True


def get_booking_dependencies(
    plan_allocation: Dict[str, Any],
    transfer_plan: List[Dict[str, Any]],
) -> List[BookingDependency]:
    """
    Analyze a plan and return booking dependencies.
    
    Args:
        plan_allocation: The plan draft allocation
        transfer_plan: List of transfer instructions
        
    Returns:
        List of dependencies that must be respected
    """
    dependencies = []
    dep_id = 1
    
    # Check for transfers that require hold/booking first
    for transfer in transfer_plan:
        # Some programs require booking before transfer completes
        requires_hold = transfer.get("requires_hold_before_transfer", False)
        requires_booking = transfer.get("requires_booking_before_transfer", False)
        
        # Transfer time affects dependency urgency
        transfer_hours = transfer.get("transfer_time_hours", 48)
        
        if requires_hold:
            dependencies.append(BookingDependency(
                dependency_id=f"dep_{dep_id}",
                dependency_type=BookingDependencyType.HOLD_BEFORE_TRANSFER,
                prerequisite_step_id=f"hold_{transfer.get('for_items', ['unknown'])[0]}",
                prerequisite_description=f"Hold seats for {transfer.get('to_program_name', 'program')}",
                dependent_step_id=transfer.get("transfer_id", "unknown"),
                dependent_description=f"Transfer {transfer.get('points_to_transfer', 0):,} points",
                reason="Award space may disappear before transfer completes",
                is_hard_blocker=transfer_hours > 24,
            ))
            dep_id += 1
        
        if requires_booking:
            dependencies.append(BookingDependency(
                dependency_id=f"dep_{dep_id}",
                dependency_type=BookingDependencyType.BOOKING_BEFORE_TRANSFER,
                prerequisite_step_id=f"book_{transfer.get('for_items', ['unknown'])[0]}",
                prerequisite_description=f"Book flight using cash first",
                dependent_step_id=transfer.get("transfer_id", "unknown"),
                dependent_description=f"Transfer points to reimburse",
                reason="Speculative transfer: only transfer if booking succeeds",
                is_hard_blocker=False,
            ))
            dep_id += 1
        
        # Default: transfer before booking (most common)
        if not requires_hold and not requires_booking:
            for item_id in transfer.get("for_items", []):
                dependencies.append(BookingDependency(
                    dependency_id=f"dep_{dep_id}",
                    dependency_type=BookingDependencyType.TRANSFER_BEFORE_BOOKING,
                    prerequisite_step_id=transfer.get("transfer_id", "unknown"),
                    prerequisite_description=f"Transfer {transfer.get('points_to_transfer', 0):,} points to {transfer.get('to_program_name', 'program')}",
                    dependent_step_id=f"book_{item_id}",
                    dependent_description=f"Book flight with award points",
                    reason="Points must be available in loyalty account before booking",
                    is_hard_blocker=True,
                ))
                dep_id += 1
    
    return dependencies


def validate_booking_sequence(
    completed_steps: List[str],
    next_step: str,
    dependencies: List[BookingDependency],
) -> Tuple[bool, Optional[str]]:
    """
    Validate that a booking step can be executed.
    
    Args:
        completed_steps: List of step IDs already completed
        next_step: Step ID about to be executed
        dependencies: All dependencies for the plan
        
    Returns:
        (is_valid, error_message)
    """
    for dep in dependencies:
        if dep.dependent_step_id == next_step:
            if dep.prerequisite_step_id not in completed_steps:
                if dep.is_hard_blocker:
                    return False, f"Must complete '{dep.prerequisite_description}' before '{dep.dependent_description}': {dep.reason}"
                else:
                    logger.warning(f"Soft dependency not met: {dep.prerequisite_description} -> {dep.dependent_description}")
    
    return True, None


# =============================================================================
# TASK 10: RISK SCORE
# =============================================================================

class RiskFactor(str, Enum):
    """Factors contributing to booking risk."""
    TRANSFER_IRREVERSIBILITY = "transfer_irreversibility"
    AVAILABILITY_VOLATILITY = "availability_volatility"
    CANCELLATION_RIGIDITY = "cancellation_rigidity"
    EXPIRATION_PRESSURE = "expiration_pressure"
    MULTI_PARTY_COORDINATION = "multi_party_coordination"
    AWARD_AVAILABILITY = "award_availability"


@dataclass
class RiskComponent:
    """A single risk factor and its score."""
    factor: RiskFactor
    score: float  # 0.0 to 1.0
    weight: float  # Importance weight
    explanation: str


@dataclass
class RiskAssessment:
    """Complete risk assessment for a booking plan."""
    plan_id: str
    
    # Numeric score (0-100)
    total_score: float
    
    # Bucketed level for UI
    risk_level: str  # "low", "medium", "high"
    
    # Component breakdown
    components: List[RiskComponent]
    
    # User-facing summary
    summary: str
    
    # Specific warnings
    warnings: List[str]
    
    # Recommendations
    recommendations: List[str]


def calculate_risk_score(
    plan_allocation: Dict[str, Any],
    transfer_plan: List[Dict[str, Any]],
    members: List[Dict[str, Any]],
    passengers: List[Dict[str, Any]],
) -> RiskAssessment:
    """
    Calculate risk score for a booking plan.
    
    Factors:
    - Transfer irreversibility: Points transfers can't be undone
    - Availability volatility: Award seats can disappear
    - Cancellation rigidity: Some awards can't be cancelled/changed
    - Expiration pressure: Points or availability may expire
    - Multi-party coordination: More people = more complexity
    - Award availability: Low award inventory = higher risk
    
    Returns:
        RiskAssessment with score, level, and explanations
    """
    plan_id = plan_allocation.get("plan_id", "unknown")
    components = []
    warnings = []
    recommendations = []
    
    # 1. Transfer Irreversibility
    total_transfer_points = sum(t.get("points_to_transfer", 0) for t in transfer_plan)
    transfer_count = len(transfer_plan)
    
    if transfer_count > 0:
        # More transfers = higher risk
        transfer_score = min(0.3 + (transfer_count * 0.15), 0.9)
        components.append(RiskComponent(
            factor=RiskFactor.TRANSFER_IRREVERSIBILITY,
            score=transfer_score,
            weight=0.25,
            explanation=f"{transfer_count} point transfers totaling {total_transfer_points:,} points. Transfers cannot be reversed."
        ))
        if transfer_count > 2:
            warnings.append(f"Multiple transfers ({transfer_count}) increase execution complexity")
            recommendations.append("Consider booking flights with longer transfer windows first")
    else:
        components.append(RiskComponent(
            factor=RiskFactor.TRANSFER_IRREVERSIBILITY,
            score=0.1,
            weight=0.25,
            explanation="No point transfers required - using direct program points or cash."
        ))
    
    # 2. Availability Volatility
    # Based on how many award bookings vs cash
    award_count = sum(1 for a in plan_allocation.get("seat_allocations", []) if a.get("payment_type") == "points")
    total_bookings = len(plan_allocation.get("seat_allocations", []))
    
    if total_bookings > 0:
        award_ratio = award_count / total_bookings
        availability_score = award_ratio * 0.7  # Award bookings have volatility risk
        components.append(RiskComponent(
            factor=RiskFactor.AVAILABILITY_VOLATILITY,
            score=availability_score,
            weight=0.20,
            explanation=f"{award_count} of {total_bookings} bookings use award space, which can disappear without notice."
        ))
        if award_ratio > 0.8:
            warnings.append("Heavy reliance on award availability - space may disappear")
            recommendations.append("Have a cash backup plan ready")
    
    # 3. Cancellation Rigidity
    # Award bookings often have stricter cancellation policies
    rigidity_score = 0.3 if award_count > 0 else 0.1
    components.append(RiskComponent(
        factor=RiskFactor.CANCELLATION_RIGIDITY,
        score=rigidity_score,
        weight=0.15,
        explanation="Award bookings typically have stricter change/cancellation policies than paid fares."
    ))
    
    # 4. Expiration Pressure
    # Check for transfers with long completion times
    max_transfer_hours = max((t.get("transfer_time_hours", 0) for t in transfer_plan), default=0)
    if max_transfer_hours > 48:
        expiration_score = 0.6
        warnings.append(f"Longest transfer takes {max_transfer_hours} hours - award space may not hold")
        recommendations.append("Initiate transfers immediately after approval")
    elif max_transfer_hours > 24:
        expiration_score = 0.4
    else:
        expiration_score = 0.2
    
    components.append(RiskComponent(
        factor=RiskFactor.EXPIRATION_PRESSURE,
        score=expiration_score,
        weight=0.15,
        explanation=f"Transfer completion time: up to {max_transfer_hours} hours."
    ))
    
    # 5. Multi-Party Coordination
    member_count = len(members)
    passenger_count = len(passengers)
    
    if member_count > 1:
        coordination_score = min(0.2 + (member_count - 1) * 0.1, 0.7)
        components.append(RiskComponent(
            factor=RiskFactor.MULTI_PARTY_COORDINATION,
            score=coordination_score,
            weight=0.15,
            explanation=f"{member_count} members coordinating for {passenger_count} passengers."
        ))
        if member_count > 4:
            warnings.append("Large group requires careful coordination")
            recommendations.append("Designate one person to execute all bookings if possible")
    else:
        components.append(RiskComponent(
            factor=RiskFactor.MULTI_PARTY_COORDINATION,
            score=0.1,
            weight=0.15,
            explanation="Single member - minimal coordination needed."
        ))
    
    # 6. Award Availability (based on cabin class and routes)
    # Simplified: premium cabins have lower availability
    premium_count = sum(
        1 for a in plan_allocation.get("seat_allocations", [])
        if a.get("cabin_class", "Economy") in ("Business", "First")
    )
    if premium_count > 0:
        award_availability_score = 0.6
        warnings.append(f"{premium_count} premium cabin award bookings - availability is limited")
    else:
        award_availability_score = 0.3
    
    components.append(RiskComponent(
        factor=RiskFactor.AWARD_AVAILABILITY,
        score=award_availability_score,
        weight=0.10,
        explanation=f"{premium_count} premium cabin bookings in the plan."
    ))
    
    # Calculate weighted total
    total_score = sum(c.score * c.weight for c in components) * 100
    
    # Bucket into risk level
    if total_score < 30:
        risk_level = "low"
        summary = "Low risk: straightforward execution with minimal dependencies."
    elif total_score < 60:
        risk_level = "medium"
        summary = "Medium risk: some coordination required. Follow the checklist carefully."
    else:
        risk_level = "high"
        summary = "High risk: complex execution with multiple dependencies. Consider booking in phases."
    
    return RiskAssessment(
        plan_id=plan_id,
        total_score=round(total_score, 1),
        risk_level=risk_level,
        components=components,
        summary=summary,
        warnings=warnings,
        recommendations=recommendations,
    )


# =============================================================================
# TASK 11: APPROVALS AND VETO WORKFLOW
# =============================================================================

class ApprovalStatus(str, Enum):
    """Status of an approval."""
    PENDING = "pending"
    APPROVED = "approved"
    VETOED = "vetoed"
    EXPIRED = "expired"


@dataclass
class Approval:
    """An approval record for a plan."""
    approval_id: str
    plan_id: str
    user_id: str
    user_name: str
    
    # For whom this approval covers
    approving_for: List[str]  # List of passenger_ids or user_ids
    
    status: ApprovalStatus = ApprovalStatus.PENDING
    
    # Veto details
    veto_reason: Optional[str] = None
    veto_constraints: Optional[Dict[str, Any]] = None  # Constraints to add if re-running
    
    # Timestamps
    created_at: str = ""
    responded_at: Optional[str] = None
    expires_at: Optional[str] = None


@dataclass
class ApprovalSummary:
    """Summary of approvals for a plan."""
    plan_id: str
    
    total_required: int
    total_approved: int
    total_vetoed: int
    total_pending: int
    
    all_approved: bool
    any_vetoed: bool
    
    approvals: List[Approval]
    
    # If vetoed, what constraints were requested
    veto_constraints: List[Dict[str, Any]]


# In-memory approval storage (would be DynamoDB in production)
_approvals_store: Dict[str, List[Approval]] = {}


def create_approval_requests(
    plan_id: str,
    members: List[Dict[str, Any]],
    passengers: List[Dict[str, Any]],
    plan_allocation: Dict[str, Any],
) -> List[Approval]:
    """
    Create approval requests for all members who need to approve.
    
    Each member must approve their own passengers' allocations.
    Members with delegation can approve on behalf of others.
    """
    approvals = []
    now = datetime.utcnow().isoformat()
    expires = (datetime.utcnow() + timedelta(hours=48)).isoformat()
    
    # Group passengers by guardian
    passengers_by_guardian: Dict[str, List[str]] = {}
    for p in passengers:
        guardian = p.get("guardian_user_id")
        pax_id = p.get("passenger_id")
        if guardian and pax_id:
            if guardian not in passengers_by_guardian:
                passengers_by_guardian[guardian] = []
            passengers_by_guardian[guardian].append(pax_id)
    
    # Create approval for each guardian
    for member in members:
        user_id = member.get("user_id") or member.get("userId")
        user_name = member.get("name", user_id)
        
        pax_ids = passengers_by_guardian.get(user_id, [])
        if not pax_ids:
            continue  # No passengers to approve for
        
        approval = Approval(
            approval_id=str(uuid.uuid4()),
            plan_id=plan_id,
            user_id=user_id,
            user_name=user_name,
            approving_for=pax_ids,
            status=ApprovalStatus.PENDING,
            created_at=now,
            expires_at=expires,
        )
        approvals.append(approval)
    
    # Store approvals
    _approvals_store[plan_id] = approvals
    
    return approvals


def submit_approval(
    plan_id: str,
    user_id: str,
    approve: bool,
    veto_reason: Optional[str] = None,
    veto_constraints: Optional[Dict[str, Any]] = None,
) -> Approval:
    """
    Submit an approval or veto for a plan.
    
    Args:
        plan_id: The plan being approved
        user_id: User submitting the response
        approve: True to approve, False to veto
        veto_reason: If vetoing, reason why
        veto_constraints: If vetoing, constraints to add for re-run
        
    Returns:
        Updated Approval object
    """
    approvals = _approvals_store.get(plan_id, [])
    
    for approval in approvals:
        if approval.user_id == user_id:
            approval.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.VETOED
            approval.responded_at = datetime.utcnow().isoformat()
            
            if not approve:
                approval.veto_reason = veto_reason
                approval.veto_constraints = veto_constraints
            
            return approval
    
    raise ValueError(f"No approval found for user {user_id} on plan {plan_id}")


def get_approval_summary(plan_id: str) -> ApprovalSummary:
    """Get summary of approvals for a plan."""
    approvals = _approvals_store.get(plan_id, [])
    
    approved = [a for a in approvals if a.status == ApprovalStatus.APPROVED]
    vetoed = [a for a in approvals if a.status == ApprovalStatus.VETOED]
    pending = [a for a in approvals if a.status == ApprovalStatus.PENDING]
    
    veto_constraints = [
        a.veto_constraints for a in vetoed
        if a.veto_constraints
    ]
    
    return ApprovalSummary(
        plan_id=plan_id,
        total_required=len(approvals),
        total_approved=len(approved),
        total_vetoed=len(vetoed),
        total_pending=len(pending),
        all_approved=len(approved) == len(approvals) and len(approvals) > 0,
        any_vetoed=len(vetoed) > 0,
        approvals=approvals,
        veto_constraints=veto_constraints,
    )


def handle_veto_rerun(
    plan_id: str,
    original_constraints: Dict[str, Any],
    veto_constraints: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Merge veto constraints with original constraints for optimizer re-run.
    
    Args:
        plan_id: The plan that was vetoed
        original_constraints: Original optimizer constraints
        veto_constraints: List of constraints from vetoes
        
    Returns:
        Merged constraints for re-running optimizer
    """
    merged = dict(original_constraints)
    
    for vc in veto_constraints:
        # Common veto constraint types:
        # - exclude_airlines: ["AA", "UA"]
        # - exclude_connections_over: 2
        # - max_layover_hours: 4
        # - require_direct: True
        # - exclude_airports: ["ORD"]
        # - max_total_cost: 5000
        
        for key, value in vc.items():
            if key.startswith("exclude_"):
                # Merge exclusion lists
                existing = merged.get(key, [])
                if isinstance(value, list):
                    merged[key] = list(set(existing + value))
                else:
                    merged[key] = existing + [value] if value not in existing else existing
            elif key.startswith("max_"):
                # Take the stricter (lower) max
                existing = merged.get(key)
                if existing is None or value < existing:
                    merged[key] = value
            elif key.startswith("min_"):
                # Take the stricter (higher) min
                existing = merged.get(key)
                if existing is None or value > existing:
                    merged[key] = value
            else:
                # Override
                merged[key] = value
    
    merged["is_rerun"] = True
    merged["original_plan_id"] = plan_id
    
    return merged


# =============================================================================
# TASK 12: BOOKING CHECKLIST
# =============================================================================

class ChecklistStepStatus(str, Enum):
    """Status of a checklist step."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class ChecklistStepType(str, Enum):
    """Type of checklist step."""
    TRANSFER = "transfer"
    HOLD = "hold"
    BOOKING = "booking"
    CONFIRMATION = "confirmation"
    PAYMENT = "payment"


@dataclass
class ChecklistStep:
    """A single step in the booking checklist."""
    step_id: str
    step_type: ChecklistStepType
    order: int
    
    # What to do
    title: str
    description: str
    instructions: List[str]
    
    # Who does it
    assigned_to: str  # user_id
    assigned_to_name: str
    
    # Dependencies
    depends_on: List[str]  # step_ids that must complete first
    
    # Status
    status: ChecklistStepStatus = ChecklistStepStatus.PENDING
    
    # Confirmation data
    confirmation_type: Optional[str] = None  # "pnr", "transfer_confirmation", etc.
    confirmation_value: Optional[str] = None
    
    # Timestamps
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    
    # Failure info
    failure_reason: Optional[str] = None


@dataclass
class BookingSession:
    """A booking session tracking execution of a plan."""
    session_id: str
    plan_id: str
    trip_id: str
    
    # State
    status: str  # "active", "completed", "partial_success", "failed"
    
    # Checklist
    checklist: List[ChecklistStep]
    
    # Progress
    total_steps: int
    completed_steps: int
    failed_steps: int
    
    # Timestamps
    started_at: str
    completed_at: Optional[str] = None
    
    # Rollback info for failures
    rollback_steps: List[Dict[str, Any]] = field(default_factory=list)


# In-memory session storage
_booking_sessions: Dict[str, BookingSession] = {}


def generate_booking_checklist(
    plan_id: str,
    trip_id: str,
    plan_allocation: Dict[str, Any],
    transfer_plan: List[Dict[str, Any]],
    members: List[Dict[str, Any]],
    dependencies: List[BookingDependency],
) -> BookingSession:
    """
    Generate a step-by-step booking checklist from a plan.
    
    Returns a BookingSession with ordered steps.
    """
    session_id = str(uuid.uuid4())
    checklist = []
    order = 1
    
    member_lookup = {m.get("user_id") or m.get("userId"): m for m in members}
    
    # Step 1: Transfers first (unless dependencies say otherwise)
    transfer_step_ids = {}
    for transfer in transfer_plan:
        owner_id = transfer.get("owner_member")
        owner_name = transfer.get("owner_member_name", owner_id)
        
        step_id = transfer.get("transfer_id", f"transfer_{order}")
        transfer_step_ids[step_id] = transfer
        
        checklist.append(ChecklistStep(
            step_id=step_id,
            step_type=ChecklistStepType.TRANSFER,
            order=order,
            title=f"Transfer {transfer.get('points_to_transfer', 0):,} points",
            description=f"{transfer.get('from_program_name')} → {transfer.get('to_program_name')}",
            instructions=transfer.get("steps", []),
            assigned_to=owner_id,
            assigned_to_name=owner_name,
            depends_on=[],  # Transfers usually come first
            confirmation_type="transfer_confirmation",
        ))
        order += 1
    
    # Step 2: Bookings (flights)
    for allocation in plan_allocation.get("seat_allocations", []):
        payer_id = allocation.get("payer_user_id")
        payer_info = member_lookup.get(payer_id, {})
        payer_name = payer_info.get("name", payer_id)
        
        step_id = f"book_{allocation.get('allocation_id', order)}"
        
        # Find dependencies
        step_depends = []
        for dep in dependencies:
            if dep.dependent_step_id == step_id:
                step_depends.append(dep.prerequisite_step_id)
        
        # Description based on payment type
        payment_type = allocation.get("payment_type", "cash")
        if payment_type == "points":
            desc = f"Book with {allocation.get('points_used', 0):,} {allocation.get('points_program', '')} points"
        else:
            desc = f"Book with cash (${allocation.get('cash_amount', 0):.2f})"
        
        checklist.append(ChecklistStep(
            step_id=step_id,
            step_type=ChecklistStepType.BOOKING,
            order=order,
            title=f"Book flight {allocation.get('flight_id', 'unknown')}",
            description=desc,
            instructions=[
                f"1. Log into {allocation.get('points_program', 'airline')} account",
                f"2. Search for the flight",
                f"3. Select passengers and complete booking",
                f"4. Record the confirmation number below",
            ],
            assigned_to=payer_id,
            assigned_to_name=payer_name,
            depends_on=step_depends,
            confirmation_type="pnr",
        ))
        order += 1
    
    # Create session
    session = BookingSession(
        session_id=session_id,
        plan_id=plan_id,
        trip_id=trip_id,
        status="active",
        checklist=checklist,
        total_steps=len(checklist),
        completed_steps=0,
        failed_steps=0,
        started_at=datetime.utcnow().isoformat(),
    )
    
    _booking_sessions[session_id] = session
    return session


def update_checklist_step(
    session_id: str,
    step_id: str,
    status: ChecklistStepStatus,
    confirmation_value: Optional[str] = None,
    failure_reason: Optional[str] = None,
) -> ChecklistStep:
    """
    Update the status of a checklist step.
    
    Args:
        session_id: The booking session
        step_id: The step to update
        status: New status
        confirmation_value: Confirmation number/code if completed
        failure_reason: Reason if failed
        
    Returns:
        Updated step
    """
    session = _booking_sessions.get(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")
    
    for step in session.checklist:
        if step.step_id == step_id:
            now = datetime.utcnow().isoformat()
            
            if status == ChecklistStepStatus.IN_PROGRESS:
                step.started_at = now
            elif status == ChecklistStepStatus.COMPLETED:
                step.completed_at = now
                step.confirmation_value = confirmation_value
                session.completed_steps += 1
            elif status == ChecklistStepStatus.FAILED:
                step.completed_at = now
                step.failure_reason = failure_reason
                session.failed_steps += 1
            
            step.status = status
            
            # Update session status
            _update_session_status(session)
            
            return step
    
    raise ValueError(f"Step {step_id} not found in session {session_id}")


def _update_session_status(session: BookingSession):
    """Update the overall session status based on step statuses."""
    if session.failed_steps > 0:
        if session.completed_steps > 0:
            session.status = "partial_success"
        else:
            session.status = "failed"
    elif session.completed_steps == session.total_steps:
        session.status = "completed"
        session.completed_at = datetime.utcnow().isoformat()


def get_booking_session(session_id: str) -> Optional[BookingSession]:
    """Get a booking session by ID."""
    return _booking_sessions.get(session_id)


def get_session_for_plan(plan_id: str) -> Optional[BookingSession]:
    """Get the active booking session for a plan."""
    for session in _booking_sessions.values():
        if session.plan_id == plan_id:
            return session
    return None


def ingest_confirmation(
    session_id: str,
    step_id: str,
    confirmation_type: str,
    confirmation_value: str,
    additional_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Ingest a confirmation (PNR, transfer confirmation, etc.).
    
    This is the main entry point for confirmation ingestion.
    
    Args:
        session_id: Booking session
        step_id: Step this confirms
        confirmation_type: Type of confirmation (pnr, transfer_confirmation, etc.)
        confirmation_value: The confirmation code/number
        additional_data: Any additional metadata
        
    Returns:
        Dict with step update and any extracted data
    """
    step = update_checklist_step(
        session_id=session_id,
        step_id=step_id,
        status=ChecklistStepStatus.COMPLETED,
        confirmation_value=confirmation_value,
    )
    
    result = {
        "step_id": step_id,
        "status": "completed",
        "confirmation_type": confirmation_type,
        "confirmation_value": confirmation_value,
    }
    
    # Parse confirmation for additional data if possible
    if confirmation_type == "pnr" and additional_data:
        result["passengers"] = additional_data.get("passengers", [])
        result["segments"] = additional_data.get("segments", [])
    
    return result


# =============================================================================
# SERIALIZATION
# =============================================================================

def risk_assessment_to_dict(assessment: RiskAssessment) -> Dict[str, Any]:
    """Convert RiskAssessment to JSON-serializable dict."""
    return {
        "plan_id": assessment.plan_id,
        "total_score": assessment.total_score,
        "risk_level": assessment.risk_level,
        "summary": assessment.summary,
        "warnings": assessment.warnings,
        "recommendations": assessment.recommendations,
        "components": [
            {
                "factor": c.factor.value,
                "score": c.score,
                "weight": c.weight,
                "explanation": c.explanation,
            }
            for c in assessment.components
        ],
    }


def booking_session_to_dict(session: BookingSession) -> Dict[str, Any]:
    """Convert BookingSession to JSON-serializable dict."""
    return {
        "session_id": session.session_id,
        "plan_id": session.plan_id,
        "trip_id": session.trip_id,
        "status": session.status,
        "progress": {
            "total": session.total_steps,
            "completed": session.completed_steps,
            "failed": session.failed_steps,
            "pending": session.total_steps - session.completed_steps - session.failed_steps,
        },
        "checklist": [
            {
                "step_id": s.step_id,
                "step_type": s.step_type.value,
                "order": s.order,
                "title": s.title,
                "description": s.description,
                "instructions": s.instructions,
                "assigned_to": s.assigned_to,
                "assigned_to_name": s.assigned_to_name,
                "depends_on": s.depends_on,
                "status": s.status.value,
                "confirmation_type": s.confirmation_type,
                "confirmation_value": s.confirmation_value,
                "started_at": s.started_at,
                "completed_at": s.completed_at,
                "failure_reason": s.failure_reason,
            }
            for s in session.checklist
        ],
        "started_at": session.started_at,
        "completed_at": session.completed_at,
    }


def approval_summary_to_dict(summary: ApprovalSummary) -> Dict[str, Any]:
    """Convert ApprovalSummary to JSON-serializable dict."""
    return {
        "plan_id": summary.plan_id,
        "total_required": summary.total_required,
        "total_approved": summary.total_approved,
        "total_vetoed": summary.total_vetoed,
        "total_pending": summary.total_pending,
        "all_approved": summary.all_approved,
        "any_vetoed": summary.any_vetoed,
        "approvals": [
            {
                "approval_id": a.approval_id,
                "user_id": a.user_id,
                "user_name": a.user_name,
                "approving_for": a.approving_for,
                "status": a.status.value,
                "veto_reason": a.veto_reason,
                "created_at": a.created_at,
                "responded_at": a.responded_at,
                "expires_at": a.expires_at,
            }
            for a in summary.approvals
        ],
        "veto_constraints": summary.veto_constraints,
    }
