# Transfer Strategy Implementation Plan

A comprehensive plan to fix the missing credit card → airline/hotel transfer strategy display in the GroupBookingAllocator.

---

## Table of Contents

1. [Problem Summary](#1-problem-summary)
2. [Current Data Sources](#2-current-data-sources)
3. [Implementation Overview](#3-implementation-overview)
4. [Phase 1: Update Data Models](#4-phase-1-update-data-models)
5. [Phase 2: Update GroupBookingAllocator](#5-phase-2-update-groupbookingallocator)
6. [Phase 3: API Response Updates](#6-phase-3-api-response-updates)
7. [Phase 4: Frontend Integration](#7-phase-4-frontend-integration)
8. [Testing Strategy](#8-testing-strategy)
9. [Migration Checklist](#9-migration-checklist)

---

## 1. Problem Summary

### What's Missing

The `GroupBookingAllocator` calculates and uses point transfers internally but **does not expose this information** in its output. Users see:

```
❌ Current Output:
   "Use 80,000 United miles for JFK→CDG"

✅ Expected Output:
   "Transfer 80,000 Chase UR → United (1:1, instant)
    Then use 80,000 United miles for JFK→CDG"
```

### Root Cause

| Component | Issue |
|-----------|-------|
| `BookingAssignment` model | Missing `transfer_from`, `transfer_ratio`, `transfer_time` fields |
| `GroupBookingPlan` model | Missing `transfers_needed` consolidated list |
| `_deduct_points_from_state()` | Finds transfer source but doesn't return it |
| API response | Doesn't include transfer instructions |

---

## 2. Current Data Sources

### 2.1 Transfer Graph Sources

The system has **THREE** transfer graph definitions. These are **HARDCODED** (not from external APIs):

#### Source 1: `backend/src/handlers/transfer_strategy.py`

**Location:** Lines 16-99

```python
EXTENDED_TRANSFER_GRAPH: Dict[str, Dict[str, Dict[str, Any]]] = {
    "amex": {
        "DL": {"ratio": 1.0, "type": "airline", "name": "Delta SkyMiles"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "HH": {"ratio": 2.0, "type": "hotel", "name": "Hilton Honors"},  # 1:2
        # ... more partners
    },
    "chase": {
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        # ... more partners
    },
    # ... citi, capitalone, bilt
}
```

**Data includes:**
- Transfer ratios (1:1, 1:2 for Hilton, etc.)
- Program types (airline vs hotel)
- Display names

#### Source 2: `backend/src/agents/config.py`

**Location:** Lines 61-119

```python
TRANSFER_GRAPH = {
    "Chase UR": {
        "airlines": ["UA", "AA", "BA", "AF", "VS", "SQ", "IB", "AV"],
        "hotels": ["HYATT", "MAR", "IHG"],
        "ratios": {"UA": 1.0, "HYATT": 1.0, ...},
        "transfer_times": {"UA": "Instant", "MAR": "1-2 days", ...},
        "portal_url": "https://ultimaterewardspoints.chase.com",
    },
    "Amex MR": {
        "airlines": ["DL", "BA", "AF", "ANA", "VS", "SQ", "EK", "JL"],
        "hotels": ["HH", "MAR"],
        "ratios": {"HH": 2.0, ...},  # 1 MR = 2 Hilton
        "transfer_times": {"DL": "Instant", ...},
        "portal_url": "https://global.americanexpress.com/rewards",
    },
    # ... Citi TYP, Capital One, Bilt
}
```

**Data includes:**
- Transfer times (Instant, 1-2 days)
- Portal URLs for making transfers
- Grouped by airlines vs hotels

#### Source 3: `backend/src/handlers/transfer_strategy.py` - Metadata

**Location:** Lines 112-180

```python
BANK_METADATA = {
    "amex": {
        "name": "American Express Membership Rewards",
        "portal_url": "https://global.americanexpress.com/rewards",
        "default_transfer_time": "1-2 business days",
        "block_size": 1000,
    },
    "chase": {
        "name": "Chase Ultimate Rewards",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "default_transfer_time": "instant",
        "block_size": 1000,
    },
    # ... citi, capitalone, bilt
}

PROGRAM_METADATA = {
    "UA": {"name": "United MileagePlus", "type": "airline", "booking_url": "https://www.united.com"},
    "DL": {"name": "Delta SkyMiles", "type": "airline", "booking_url": "https://www.delta.com"},
    "HH": {"name": "Hilton Honors", "type": "hotel", "booking_url": "https://www.hilton.com"},
    "HYATT": {"name": "World of Hyatt", "type": "hotel", "booking_url": "https://www.hyatt.com"},
    # ... 25+ programs
}
```

### 2.2 External APIs

| API | Purpose | Used For |
|-----|---------|----------|
| **SerpAPI** | Flight search | Finding available flights (not transfers) |
| **Award Tool API** | Award availability | Checking award seats (not transfers) |
| **None for transfers** | N/A | Transfer data is all hardcoded |

**Important:** Transfer partnerships and ratios are **NOT from external APIs**. They are maintained manually and should be updated when banks change their partnerships (typically 1-2 times per year).

### 2.3 Data Accuracy Concerns

Transfer ratios and partnerships can change. Current hardcoded data should be verified against:

| Bank | Official Source |
|------|-----------------|
| Chase | https://www.chase.com/personal/credit-cards/ultimate-rewards |
| Amex | https://www.americanexpress.com/en-us/rewards/membership-rewards |
| Citi | https://www.thankyou.com |
| Capital One | https://www.capitalone.com/credit-cards/rewards |
| Bilt | https://www.biltrewards.com |

---

## 3. Implementation Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CURRENT FLOW (BROKEN)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  GroupBookingAllocator                                                  │
│  ├── _can_use_award_from_state()  ──► Checks if transfer possible       │
│  ├── _get_transferable_from_state() ──► Calculates max points           │
│  ├── _select_best_transfer_source() ──► Finds best bank ──► LOST!       │
│  └── _deduct_points_from_state() ──► Deducts from bank ──► Source lost  │
│                                                                         │
│  Output: BookingAssignment                                              │
│          ├── points_program: "UA"     ✓ Have                            │
│          ├── points_used: 80000       ✓ Have                            │
│          ├── transfer_from: ???       ✗ MISSING                         │
│          └── transfer_time: ???       ✗ MISSING                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          FIXED FLOW                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  GroupBookingAllocator                                                  │
│  ├── _find_best_option_with_transfer() ──► Returns OptionWithTransfer   │
│  │   └── Contains: option + transfer_source + transfer_points           │
│  └── _deduct_and_record_transfer() ──► Deducts + returns TransferInfo   │
│                                                                         │
│  Output: BookingAssignment                                              │
│          ├── points_program: "UA"           ✓                           │
│          ├── points_used: 80000             ✓                           │
│          ├── transfer_from: "Chase UR"      ✓ NEW                       │
│          ├── transfer_from_name: "Chase Ultimate Rewards" ✓ NEW         │
│          ├── transfer_points_source: 80000  ✓ NEW                       │
│          ├── transfer_ratio: 1.0            ✓ NEW                       │
│          ├── transfer_time: "Instant"       ✓ NEW                       │
│          └── portal_url: "https://..."      ✓ NEW                       │
│                                                                         │
│  Output: GroupBookingPlan                                               │
│          └── transfers_needed: [TransferSummary, ...]  ✓ NEW            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Files to Modify

| File | Changes |
|------|---------|
| `backend/src/agents/group_models.py` | Add transfer fields to models |
| `backend/src/agents/group_allocator.py` | Track and return transfer sources |
| `backend/src/routes/optimize.py` | Include transfers in API response |
| `frontend/src/lib/hooks/useGroupAllocation.ts` | Parse transfer data |
| `frontend/src/components/GroupBookingPlan.tsx` | Display transfer instructions |

---

## 4. Phase 1: Update Data Models

### 4.1 Add TransferDetail Model

**File:** `backend/src/agents/group_models.py`

Add after line 123 (after `TransferOption`):

```python
@dataclass
class TransferDetail:
    """
    Details about a point transfer from a bank to an airline/hotel program.
    
    This captures the actual transfer that needs to happen, not just
    the possibility of a transfer.
    """
    # Source (bank)
    source_program: str           # "Chase UR", "Amex MR"
    source_program_name: str      # "Chase Ultimate Rewards"
    source_points: int            # Bank points to transfer (before ratio)
    
    # Target (airline/hotel)
    target_program: str           # "UA", "HH", "HYATT"
    target_program_name: str      # "United MileagePlus"
    target_program_type: str      # "airline" or "hotel"
    target_points: int            # Points received (after ratio)
    
    # Transfer details
    ratio: float                  # 1.0 or 2.0 (for Hilton)
    ratio_display: str            # "1:1" or "1:2"
    transfer_time: str            # "Instant", "1-2 business days"
    
    # URLs
    portal_url: str               # Where to make transfer
    booking_url: str              # Where to book after transfer
    
    # For grouping
    for_segment_id: Optional[str] = None
    for_member_id: Optional[str] = None


class TransferSummary(BaseModel):
    """
    Consolidated transfer for API response.
    Groups transfers by (member, source, target).
    """
    member_id: str
    member_name: str
    
    # Source bank
    from_program: str             # "Chase UR"
    from_program_name: str        # "Chase Ultimate Rewards"
    
    # Target program
    to_program: str               # "UA"
    to_program_name: str          # "United MileagePlus"
    to_program_type: str          # "airline" or "hotel"
    
    # Transfer details
    total_source_points: int      # Total bank points to transfer
    total_target_points: int      # Total points received
    ratio: float
    ratio_display: str            # "1:1"
    transfer_time: str            # "Instant"
    
    # URLs for action
    portal_url: str
    booking_url: str
    
    # Step-by-step instructions
    steps: list[str] = Field(default_factory=list)
    
    # Which segments this transfer covers
    covers_segments: list[str] = Field(default_factory=list)
```

### 4.2 Update BookingAssignment

**File:** `backend/src/agents/group_models.py`

Update the `BookingAssignment` class (around line 184):

```python
class BookingAssignment(BaseModel):
    """
    Assignment of ONE segment to ONE member.
    
    The assigned member will:
    1. Transfer points if needed (using transfer_* fields)
    2. Make the actual booking (login to their account)
    3. Use their own points (if uses_points=True)
    4. Pay the cash amount from their card
    """
    segment_id: str
    segment_type: Literal["flight", "hotel"]
    
    # Who books this segment
    assigned_to: str  # member_id
    assigned_to_name: str
    
    # Why this assignment was made
    reason: str
    
    # Payment details (from this member's resources)
    uses_points: bool
    points_program: Optional[str] = None       # Target program: "UA", "HH"
    points_program_name: Optional[str] = None  # "United MileagePlus"
    points_used: Optional[int] = None          # Target points used
    cash_amount: float                         # Cash they pay (surcharge or full price)
    
    # === NEW: Transfer details (if points come from bank transfer) ===
    requires_transfer: bool = False
    transfer_from: Optional[str] = None              # Source bank: "Chase UR"
    transfer_from_name: Optional[str] = None         # "Chase Ultimate Rewards"
    transfer_points_from_source: Optional[int] = None  # Bank points to transfer
    transfer_ratio: Optional[float] = None           # 1.0 or 2.0
    transfer_ratio_display: Optional[str] = None     # "1:1" or "1:2"
    transfer_time: Optional[str] = None              # "Instant", "1-2 days"
    transfer_portal_url: Optional[str] = None        # URL to make transfer
    booking_url: Optional[str] = None                # URL to book after transfer
    
    # Segment details for display
    segment_summary: Optional[str] = None  # "JFK → CDG, United 123"
```

### 4.3 Update GroupBookingPlan

**File:** `backend/src/agents/group_models.py`

Update the `GroupBookingPlan` class (around line 273):

```python
class GroupBookingPlan(BaseModel):
    """
    Complete booking plan for a group trip.
    
    This is the main output of GroupBookingAllocator.
    """
    trip_id: str
    strategy_used: str
    split_method_used: str = "equal"
    
    # All segment assignments
    assignments: list[BookingAssignment]
    
    # === NEW: Consolidated transfer instructions ===
    transfers_needed: list[TransferSummary] = Field(
        default_factory=list,
        description="Consolidated transfers grouped by member/source/target"
    )
    
    # Per-member summaries
    member_summaries: list[MemberBookingSummary]
    
    # Money transfers needed
    settlements: list[Settlement]
    
    # Overall metrics
    total_group_oop: float           # Total cash paid by group
    total_points_used: int           # Total points used across all members
    per_person_effective_cost: float # After settlement, each pays this
    
    # === NEW: Transfer metrics ===
    total_transfers_needed: int = 0
    total_source_points_transferred: int = 0
    
    # Validation
    all_segments_assigned: bool
    all_members_within_budget: bool
    all_members_within_points: bool
    
    # Warnings from validation
    warnings: list[str] = Field(default_factory=list)
```

---

## 5. Phase 2: Update GroupBookingAllocator

### 5.1 Add Transfer Tracking Methods

**File:** `backend/src/agents/group_allocator.py`

Add imports at top:

```python
from .config import TRANSFER_GRAPH
from ..handlers.transfer_strategy import (
    BANK_METADATA,
    PROGRAM_METADATA,
    get_bank_name,
    get_program_name,
    build_transfer_instruction,
)
```

Add new helper method (after `_select_best_transfer_source`, around line 1503):

```python
def _get_transfer_details(
    self,
    source_program: str,
    target_program: str,
    source_points: int,
) -> Optional[TransferDetail]:
    """
    Build complete transfer details for a bank → program transfer.
    
    Args:
        source_program: Bank program code (e.g., "Chase UR")
        target_program: Target program code (e.g., "UA")
        source_points: Number of bank points to transfer
    
    Returns:
        TransferDetail with all information, or None if not a transfer
    """
    # Check if source is actually a bank
    if source_program not in TRANSFER_GRAPH:
        return None  # Direct balance, no transfer needed
    
    config = TRANSFER_GRAPH[source_program]
    
    # Check if target is a valid transfer partner
    all_partners = config.get("airlines", []) + config.get("hotels", [])
    if target_program not in all_partners:
        return None
    
    # Get ratio and calculate target points
    ratio = config.get("ratios", {}).get(target_program, 1.0)
    target_points = int(source_points * ratio)
    
    # Determine program type
    if target_program in config.get("airlines", []):
        program_type = "airline"
    else:
        program_type = "hotel"
    
    # Get transfer time
    transfer_time = config.get("transfer_times", {}).get(
        target_program, 
        "1-2 business days"
    )
    
    # Build ratio display
    if ratio >= 1.0:
        ratio_display = f"1:{int(ratio)}"
    else:
        ratio_display = f"{int(1/ratio)}:1"
    
    # Get URLs
    portal_url = config.get("portal_url", "")
    booking_url = PROGRAM_METADATA.get(target_program, {}).get("booking_url", "")
    
    # Get display names
    source_name = self._get_bank_display_name(source_program)
    target_name = PROGRAM_METADATA.get(target_program, {}).get("name", target_program)
    
    return TransferDetail(
        source_program=source_program,
        source_program_name=source_name,
        source_points=source_points,
        target_program=target_program,
        target_program_name=target_name,
        target_program_type=program_type,
        target_points=target_points,
        ratio=ratio,
        ratio_display=ratio_display,
        transfer_time=transfer_time,
        portal_url=portal_url,
        booking_url=booking_url,
    )


def _get_bank_display_name(self, bank_code: str) -> str:
    """Get display name for a bank program."""
    BANK_NAMES = {
        "Chase UR": "Chase Ultimate Rewards",
        "Amex MR": "American Express Membership Rewards",
        "Citi TYP": "Citi ThankYou Points",
        "Capital One": "Capital One Miles",
        "Bilt": "Bilt Rewards",
    }
    return BANK_NAMES.get(bank_code, bank_code)
```

### 5.2 Update _find_best_option_for_state

**File:** `backend/src/agents/group_allocator.py`

Replace `_find_best_option_for_state` (around line 1358) with:

```python
def _find_best_option_for_state(
    self,
    options: list[SegmentOption],
    state: MemberState,
    member: MemberBookingCapability,
) -> dict:
    """
    Find best option for a member given their state.
    Now also tracks transfer source if needed.
    
    Returns dict with:
        - option: SegmentOption
        - uses_points: bool
        - program: str or None
        - points: int
        - cash: float
        - transfer_detail: TransferDetail or None (NEW)
    """
    if not options:
        return {
            "option": None,
            "uses_points": False,
            "program": None,
            "points": 0,
            "cash": 0,
            "transfer_detail": None,
        }
    
    best = {
        "option": options[0],
        "uses_points": False,
        "program": None,
        "points": 0,
        "cash": options[0].cash_price,
        "transfer_detail": None,
    }
    
    for option in options:
        # Check award option
        if option.award_available:
            # Find how member can afford this
            afford_result = self._how_can_afford_award(
                state, member, option
            )
            
            if afford_result and state.can_afford_cash(option.award_surcharge):
                if option.award_surcharge < best["cash"]:
                    best = {
                        "option": option,
                        "uses_points": True,
                        "program": option.award_program,
                        "points": option.award_points,
                        "cash": option.award_surcharge,
                        "transfer_detail": afford_result.get("transfer_detail"),
                    }
        
        # Check cash option
        if state.can_afford_cash(option.cash_price):
            if not best["uses_points"] and option.cash_price < best["cash"]:
                best = {
                    "option": option,
                    "uses_points": False,
                    "program": None,
                    "points": 0,
                    "cash": option.cash_price,
                    "transfer_detail": None,
                }
    
    return best


def _how_can_afford_award(
    self,
    state: MemberState,
    member: MemberBookingCapability,
    option: SegmentOption,
) -> Optional[dict]:
    """
    Determine HOW a member can afford an award option.
    Returns dict with transfer_detail if transfer needed, or empty dict if direct.
    Returns None if cannot afford.
    """
    if not option.award_available:
        return None
    
    program = option.award_program
    points_needed = option.award_points
    
    # 1. Check direct balance first (no transfer needed)
    if state.remaining_points.get(program, 0) >= points_needed:
        return {"transfer_detail": None}  # Can afford directly
    
    # 2. Check each possible transfer source
    for bank, config in TRANSFER_GRAPH.items():
        all_partners = config.get("airlines", []) + config.get("hotels", [])
        if program not in all_partners:
            continue
        
        ratio = config.get("ratios", {}).get(program, 1.0)
        bank_balance = state.remaining_points.get(bank, 0)
        effective_points = int(bank_balance * ratio)
        
        if effective_points >= points_needed:
            # Can afford via this transfer
            source_points_needed = int(points_needed / ratio) if ratio > 0 else points_needed
            
            transfer_detail = self._get_transfer_details(
                source_program=bank,
                target_program=program,
                source_points=source_points_needed,
            )
            
            return {"transfer_detail": transfer_detail}
    
    return None  # Cannot afford
```

### 5.3 Update Assignment Creation

Update the code that creates `BookingAssignment` objects. In each strategy method, update the assignment creation to include transfer details.

**Example in `_solve_greedy_with_lookahead` (around line 448):**

```python
# Before (current):
assignments.append(BookingAssignment(
    segment_id=best_assignment["option"].segment_id,
    segment_type=best_assignment["option"].segment_type,
    assigned_to=member.member_id,
    assigned_to_name=member.member_name,
    reason="Optimized: best option considering future segments",
    uses_points=best_assignment["uses_points"],
    points_program=best_assignment["program"],
    points_used=best_assignment["points"],
    cash_amount=best_assignment["cash"],
    segment_summary=best_assignment["option"].summary,
))

# After (with transfer details):
transfer = best_assignment.get("transfer_detail")

assignments.append(BookingAssignment(
    segment_id=best_assignment["option"].segment_id,
    segment_type=best_assignment["option"].segment_type,
    assigned_to=member.member_id,
    assigned_to_name=member.member_name,
    reason="Optimized: best option considering future segments",
    uses_points=best_assignment["uses_points"],
    points_program=best_assignment["program"],
    points_program_name=PROGRAM_METADATA.get(best_assignment["program"], {}).get("name") if best_assignment["program"] else None,
    points_used=best_assignment["points"],
    cash_amount=best_assignment["cash"],
    segment_summary=best_assignment["option"].summary,
    # NEW transfer fields:
    requires_transfer=transfer is not None,
    transfer_from=transfer.source_program if transfer else None,
    transfer_from_name=transfer.source_program_name if transfer else None,
    transfer_points_from_source=transfer.source_points if transfer else None,
    transfer_ratio=transfer.ratio if transfer else None,
    transfer_ratio_display=transfer.ratio_display if transfer else None,
    transfer_time=transfer.transfer_time if transfer else None,
    transfer_portal_url=transfer.portal_url if transfer else None,
    booking_url=transfer.booking_url if transfer else None,
))
```

### 5.4 Add Transfer Consolidation

Add method to consolidate transfers in final output (add to `GroupBookingAllocator` class):

```python
def _consolidate_transfers(
    self,
    assignments: list[BookingAssignment],
    members: list[MemberBookingCapability],
) -> list[TransferSummary]:
    """
    Consolidate transfers from assignments into grouped summaries.
    Groups by (member_id, from_program, to_program).
    """
    # Group transfers
    transfer_groups: dict[tuple, dict] = {}
    
    for assignment in assignments:
        if not assignment.requires_transfer:
            continue
        
        key = (
            assignment.assigned_to,
            assignment.transfer_from,
            assignment.points_program,
        )
        
        if key not in transfer_groups:
            member = next(
                (m for m in members if m.member_id == assignment.assigned_to),
                None
            )
            transfer_groups[key] = {
                "member_id": assignment.assigned_to,
                "member_name": assignment.assigned_to_name,
                "from_program": assignment.transfer_from,
                "from_program_name": assignment.transfer_from_name,
                "to_program": assignment.points_program,
                "to_program_name": assignment.points_program_name,
                "to_program_type": assignment.segment_type,  # Approximation
                "total_source_points": 0,
                "total_target_points": 0,
                "ratio": assignment.transfer_ratio,
                "ratio_display": assignment.transfer_ratio_display,
                "transfer_time": assignment.transfer_time,
                "portal_url": assignment.transfer_portal_url,
                "booking_url": assignment.booking_url,
                "covers_segments": [],
            }
        
        transfer_groups[key]["total_source_points"] += assignment.transfer_points_from_source or 0
        transfer_groups[key]["total_target_points"] += assignment.points_used or 0
        transfer_groups[key]["covers_segments"].append(assignment.segment_id)
    
    # Build TransferSummary objects with step-by-step instructions
    summaries = []
    for key, data in transfer_groups.items():
        steps = self._build_transfer_steps(
            from_program=data["from_program"],
            from_program_name=data["from_program_name"],
            to_program=data["to_program"],
            to_program_name=data["to_program_name"],
            points=data["total_source_points"],
            portal_url=data["portal_url"],
            booking_url=data["booking_url"],
        )
        
        summaries.append(TransferSummary(
            member_id=data["member_id"],
            member_name=data["member_name"],
            from_program=data["from_program"],
            from_program_name=data["from_program_name"],
            to_program=data["to_program"],
            to_program_name=data["to_program_name"],
            to_program_type=data["to_program_type"],
            total_source_points=data["total_source_points"],
            total_target_points=data["total_target_points"],
            ratio=data["ratio"],
            ratio_display=data["ratio_display"],
            transfer_time=data["transfer_time"],
            portal_url=data["portal_url"],
            booking_url=data["booking_url"],
            steps=steps,
            covers_segments=data["covers_segments"],
        ))
    
    return summaries


def _build_transfer_steps(
    self,
    from_program: str,
    from_program_name: str,
    to_program: str,
    to_program_name: str,
    points: int,
    portal_url: str,
    booking_url: str,
) -> list[str]:
    """Build step-by-step transfer instructions."""
    steps = [
        f"1. Log in to your {from_program_name} account",
        f"2. Navigate to the rewards portal: {portal_url}",
        f"3. Select 'Transfer Points' or 'Transfer to Partners'",
        f"4. Find and select {to_program_name}",
        f"5. Enter your {to_program_name} membership number",
        f"6. Transfer {points:,} points",
        f"7. Wait for transfer to complete (check transfer time)",
    ]
    
    if booking_url:
        steps.append(f"8. Book at {booking_url} using your {to_program_name} points")
    
    return steps
```

### 5.5 Update allocate() Method

Update the main `allocate()` method to include transfers in the output:

```python
def allocate(
    self,
    trip_id: str,
    segments: list[list[SegmentOption]],
    members: list[MemberBookingCapability],
    strategy: BookingAllocationStrategy,
    split_method: SettlementSplitMethod = SettlementSplitMethod.EQUAL,
) -> GroupBookingPlan:
    """..."""
    
    # ... existing validation and assignment code ...
    
    # === ADD: Consolidate transfers ===
    transfers_needed = self._consolidate_transfers(assignments, members)
    
    total_oop = sum(a.cash_amount for a in assignments)
    total_points = sum(a.points_used or 0 for a in assignments)
    
    # Calculate transfer metrics
    total_transfers = len(transfers_needed)
    total_source_points = sum(t.total_source_points for t in transfers_needed)
    
    return GroupBookingPlan(
        trip_id=trip_id,
        strategy_used=strategy.strategy_type,
        split_method_used=split_method.value,
        assignments=assignments,
        transfers_needed=transfers_needed,  # NEW
        member_summaries=member_summaries,
        settlements=settlements,
        total_group_oop=total_oop,
        total_points_used=total_points,
        per_person_effective_cost=total_oop / len(members) if members else 0,
        total_transfers_needed=total_transfers,  # NEW
        total_source_points_transferred=total_source_points,  # NEW
        all_segments_assigned=len(assignments) == len(segments),
        all_members_within_budget=self._check_budgets(assignments, members),
        all_members_within_points=self._check_points(assignments, members),
        warnings=validation.warnings,
    )
```

---

## 6. Phase 3: API Response Updates

### 6.1 Update API Endpoint

**File:** `backend/src/routes/optimize.py`

Update the response serialization:

```python
@router.post("/group/allocate")
async def allocate_group_bookings(
    request: GroupAllocationRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """..."""
    
    # ... existing code to get plan ...
    
    return {
        "tripId": plan.trip_id,
        "strategyUsed": plan.strategy_used,
        "splitMethodUsed": plan.split_method_used,
        
        # Assignments with transfer details
        "assignments": [
            {
                "segmentId": a.segment_id,
                "segmentType": a.segment_type,
                "assignedTo": a.assigned_to,
                "assignedToName": a.assigned_to_name,
                "reason": a.reason,
                "usesPoints": a.uses_points,
                "pointsProgram": a.points_program,
                "pointsProgramName": a.points_program_name,
                "pointsUsed": a.points_used,
                "cashAmount": a.cash_amount,
                "segmentSummary": a.segment_summary,
                # NEW transfer fields
                "requiresTransfer": a.requires_transfer,
                "transferFrom": a.transfer_from,
                "transferFromName": a.transfer_from_name,
                "transferPointsFromSource": a.transfer_points_from_source,
                "transferRatio": a.transfer_ratio,
                "transferRatioDisplay": a.transfer_ratio_display,
                "transferTime": a.transfer_time,
                "transferPortalUrl": a.transfer_portal_url,
                "bookingUrl": a.booking_url,
            }
            for a in plan.assignments
        ],
        
        # NEW: Consolidated transfer instructions
        "transfersNeeded": [
            {
                "memberId": t.member_id,
                "memberName": t.member_name,
                "fromProgram": t.from_program,
                "fromProgramName": t.from_program_name,
                "toProgram": t.to_program,
                "toProgramName": t.to_program_name,
                "toProgramType": t.to_program_type,
                "totalSourcePoints": t.total_source_points,
                "totalTargetPoints": t.total_target_points,
                "ratio": t.ratio,
                "ratioDisplay": t.ratio_display,
                "transferTime": t.transfer_time,
                "portalUrl": t.portal_url,
                "bookingUrl": t.booking_url,
                "steps": t.steps,
                "coversSegments": t.covers_segments,
            }
            for t in plan.transfers_needed
        ],
        
        # ... rest of existing response ...
        
        "metrics": {
            "totalGroupOOP": plan.total_group_oop,
            "totalPointsUsed": plan.total_points_used,
            "perPersonEffectiveCost": plan.per_person_effective_cost,
            "totalTransfersNeeded": plan.total_transfers_needed,  # NEW
            "totalSourcePointsTransferred": plan.total_source_points_transferred,  # NEW
        },
        
        # ... settlements, validation ...
    }
```

---

## 7. Phase 4: Frontend Integration

### 7.1 Update Types

**File:** `frontend/src/lib/hooks/useGroupAllocation.ts`

Add TypeScript types:

```typescript
interface TransferInfo {
  memberId: string;
  memberName: string;
  fromProgram: string;
  fromProgramName: string;
  toProgram: string;
  toProgramName: string;
  toProgramType: 'airline' | 'hotel';
  totalSourcePoints: number;
  totalTargetPoints: number;
  ratio: number;
  ratioDisplay: string;
  transferTime: string;
  portalUrl: string;
  bookingUrl: string;
  steps: string[];
  coversSegments: string[];
}

interface BookingAssignment {
  segmentId: string;
  segmentType: 'flight' | 'hotel';
  assignedTo: string;
  assignedToName: string;
  reason: string;
  usesPoints: boolean;
  pointsProgram?: string;
  pointsProgramName?: string;
  pointsUsed?: number;
  cashAmount: number;
  segmentSummary?: string;
  // Transfer fields
  requiresTransfer: boolean;
  transferFrom?: string;
  transferFromName?: string;
  transferPointsFromSource?: number;
  transferRatio?: number;
  transferRatioDisplay?: string;
  transferTime?: string;
  transferPortalUrl?: string;
  bookingUrl?: string;
}

interface GroupBookingPlan {
  tripId: string;
  strategyUsed: string;
  splitMethodUsed: string;
  assignments: BookingAssignment[];
  transfersNeeded: TransferInfo[];  // NEW
  memberSummaries: MemberBookingSummary[];
  settlements: Settlement[];
  metrics: {
    totalGroupOOP: number;
    totalPointsUsed: number;
    perPersonEffectiveCost: number;
    totalTransfersNeeded: number;  // NEW
    totalSourcePointsTransferred: number;  // NEW
  };
  validation: {
    allSegmentsAssigned: boolean;
    allMembersWithinBudget: boolean;
    allMembersWithinPoints: boolean;
  };
}
```

### 7.2 Create Transfer Strategy Component

**File:** `frontend/src/components/group/TransferStrategySection.tsx`

```tsx
import { ArrowRightLeft, Clock, ExternalLink, Check } from 'lucide-react';
import type { TransferInfo } from '@/lib/hooks/useGroupAllocation';

interface Props {
  transfers: TransferInfo[];
  className?: string;
}

export function TransferStrategySection({ transfers, className = '' }: Props) {
  if (!transfers || transfers.length === 0) {
    return null;
  }
  
  // Group by member
  const byMember = transfers.reduce((acc, t) => {
    if (!acc[t.memberId]) {
      acc[t.memberId] = { name: t.memberName, transfers: [] };
    }
    acc[t.memberId].transfers.push(t);
    return acc;
  }, {} as Record<string, { name: string; transfers: TransferInfo[] }>);
  
  return (
    <section className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className}`}>
      <div className="p-4 border-b border-slate-200 bg-purple-50">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-purple-600" />
          Transfer Strategy
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Complete these transfers before booking to use your points optimally
        </p>
      </div>
      
      <div className="divide-y divide-slate-200">
        {Object.entries(byMember).map(([memberId, { name, transfers }]) => (
          <div key={memberId} className="p-4">
            <h3 className="font-medium text-slate-800 mb-3">{name}'s Transfers</h3>
            
            <div className="space-y-4">
              {transfers.map((transfer, i) => (
                <TransferCard key={i} transfer={transfer} />
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Summary */}
      <div className="p-4 bg-slate-50 border-t border-slate-200">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">
            {transfers.length} transfer{transfers.length > 1 ? 's' : ''} needed
          </span>
          <span className="font-medium text-slate-800">
            {formatPoints(transfers.reduce((sum, t) => sum + t.totalSourcePoints, 0))} total points
          </span>
        </div>
      </div>
    </section>
  );
}

function TransferCard({ transfer }: { transfer: TransferInfo }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="p-4 bg-slate-50 rounded-xl">
      {/* Transfer summary */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-800">{transfer.fromProgramName}</span>
            <ArrowRightLeft className="w-4 h-4 text-purple-500" />
            <span className="font-medium text-slate-800">{transfer.toProgramName}</span>
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {formatPoints(transfer.totalSourcePoints)} points ({transfer.ratioDisplay} ratio)
          </div>
        </div>
        
        {/* Transfer time badge */}
        <div className="flex items-center gap-1 px-2 py-1 bg-white rounded-full text-xs text-slate-600">
          <Clock className="w-3 h-3" />
          {transfer.transferTime}
        </div>
      </div>
      
      {/* Action buttons */}
      <div className="flex gap-2 mt-3">
        <a
          href={transfer.portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700"
        >
          Transfer Now
          <ExternalLink className="w-3 h-3" />
        </a>
        
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
        >
          {expanded ? 'Hide steps' : 'Show steps'}
        </button>
      </div>
      
      {/* Expandable steps */}
      {expanded && (
        <ol className="mt-4 space-y-2 text-sm text-slate-600 pl-1">
          {transfer.steps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-slate-400">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function formatPoints(points: number): string {
  if (points >= 1000) {
    if (points % 1000 === 0) return `${points / 1000}k`;
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toLocaleString();
}
```

### 7.3 Update Group Booking Plan Display

**File:** `frontend/src/components/group/BookingPlanDisplay.tsx`

Add the transfer strategy section:

```tsx
import { TransferStrategySection } from './TransferStrategySection';

export function BookingPlanDisplay({ plan }: Props) {
  return (
    <div className="space-y-8">
      {/* NEW: Transfer Strategy Section */}
      {plan.transfersNeeded.length > 0 && (
        <TransferStrategySection transfers={plan.transfersNeeded} />
      )}
      
      {/* Per-Member Cards */}
      <section>
        <h2 className="text-xl font-bold mb-4">Who Books What</h2>
        {/* ... existing member cards ... */}
      </section>
      
      {/* ... rest of existing display ... */}
    </div>
  );
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

**File:** `backend/tests/test_group_allocator_transfers.py`

```python
import pytest
from backend.src.agents.group_allocator import GroupBookingAllocator, SegmentOption
from backend.src.agents.group_models import (
    MemberBookingCapability,
    BookingAllocationStrategy,
)


class TestTransferTracking:
    """Tests for transfer strategy tracking."""
    
    def test_records_transfer_when_using_bank_points(self):
        """When booking with transferred points, transfer details should be recorded."""
        allocator = GroupBookingAllocator(use_ilp=False)
        
        segments = [[
            SegmentOption(
                segment_id="flight_1",
                segment_type="flight",
                option_id="opt_1",
                cash_price=500.0,
                award_available=True,
                award_program="UA",  # United
                award_points=60000,
                award_surcharge=50.0,
            )
        ]]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={"Chase UR": 100000},  # Has Chase, not direct United
            ),
        ]
        
        strategy = BookingAllocationStrategy(strategy_type="optimize")
        plan = allocator.allocate("trip_1", segments, members, strategy)
        
        # Should use points via transfer
        assert len(plan.assignments) == 1
        assignment = plan.assignments[0]
        
        assert assignment.uses_points == True
        assert assignment.points_program == "UA"
        assert assignment.requires_transfer == True
        assert assignment.transfer_from == "Chase UR"
        assert assignment.transfer_from_name == "Chase Ultimate Rewards"
        assert assignment.transfer_ratio == 1.0
        assert assignment.transfer_time == "Instant"
        assert assignment.transfer_portal_url is not None
        
        # Should have consolidated transfer
        assert len(plan.transfers_needed) == 1
        transfer = plan.transfers_needed[0]
        assert transfer.from_program == "Chase UR"
        assert transfer.to_program == "UA"
        assert transfer.total_source_points == 60000
    
    def test_no_transfer_when_using_direct_balance(self):
        """When using direct program balance, no transfer should be recorded."""
        allocator = GroupBookingAllocator(use_ilp=False)
        
        segments = [[
            SegmentOption(
                segment_id="flight_1",
                segment_type="flight",
                option_id="opt_1",
                cash_price=500.0,
                award_available=True,
                award_program="UA",
                award_points=60000,
                award_surcharge=50.0,
            )
        ]]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={"UA": 100000},  # Has direct United miles
            ),
        ]
        
        strategy = BookingAllocationStrategy(strategy_type="optimize")
        plan = allocator.allocate("trip_1", segments, members, strategy)
        
        assert plan.assignments[0].uses_points == True
        assert plan.assignments[0].requires_transfer == False
        assert plan.assignments[0].transfer_from is None
        assert len(plan.transfers_needed) == 0
    
    def test_hilton_2x_ratio_transfer(self):
        """Hilton transfers at 1:2 ratio should be recorded correctly."""
        allocator = GroupBookingAllocator(use_ilp=False)
        
        segments = [[
            SegmentOption(
                segment_id="hotel_1",
                segment_type="hotel",
                option_id="opt_1",
                cash_price=300.0,
                award_available=True,
                award_program="HH",  # Hilton
                award_points=80000,
                award_surcharge=0.0,
            )
        ]]
        
        members = [
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={"Amex MR": 50000},  # 50k MR = 100k Hilton (1:2)
            ),
        ]
        
        strategy = BookingAllocationStrategy(strategy_type="optimize")
        plan = allocator.allocate("trip_1", segments, members, strategy)
        
        assignment = plan.assignments[0]
        assert assignment.requires_transfer == True
        assert assignment.transfer_from == "Amex MR"
        assert assignment.transfer_ratio == 2.0
        assert assignment.transfer_ratio_display == "1:2"
        # 80k Hilton / 2 = 40k Amex needed
        assert assignment.transfer_points_from_source == 40000
    
    def test_consolidates_multiple_transfers_same_route(self):
        """Multiple transfers on same bank→program route should consolidate."""
        allocator = GroupBookingAllocator(use_ilp=False)
        
        segments = [
            [SegmentOption(
                segment_id=f"flight_{i}",
                segment_type="flight",
                option_id=f"opt_{i}",
                cash_price=300.0,
                award_available=True,
                award_program="UA",
                award_points=30000,
                award_surcharge=25.0,
            )]
            for i in range(2)
        ]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={"Chase UR": 100000},
            ),
        ]
        
        strategy = BookingAllocationStrategy(strategy_type="optimize")
        plan = allocator.allocate("trip_1", segments, members, strategy)
        
        # Should have 2 assignments but only 1 consolidated transfer
        assert len(plan.assignments) == 2
        assert len(plan.transfers_needed) == 1
        
        transfer = plan.transfers_needed[0]
        assert transfer.total_source_points == 60000  # 30k + 30k
        assert len(transfer.covers_segments) == 2
```

### 8.2 Integration Tests

Test with actual API endpoint to verify full flow.

---

## 9. Migration Checklist

### Pre-Implementation

- [ ] Review current transfer graph data for accuracy
- [ ] Verify TRANSFER_GRAPH in config.py matches EXTENDED_TRANSFER_GRAPH
- [ ] Back up existing group_models.py and group_allocator.py

### Phase 1: Models

- [ ] Add `TransferDetail` dataclass to group_models.py
- [ ] Add `TransferSummary` model to group_models.py
- [ ] Update `BookingAssignment` with transfer fields
- [ ] Update `GroupBookingPlan` with `transfers_needed`
- [ ] Run existing tests to ensure backward compatibility

### Phase 2: Allocator

- [ ] Add `_get_transfer_details()` method
- [ ] Add `_get_bank_display_name()` method
- [ ] Update `_find_best_option_for_state()` to track transfers
- [ ] Add `_how_can_afford_award()` method
- [ ] Add `_consolidate_transfers()` method
- [ ] Add `_build_transfer_steps()` method
- [ ] Update `allocate()` to include transfers in output
- [ ] Update all strategy methods to pass transfer info

### Phase 3: API

- [ ] Update API response serialization
- [ ] Add `transfersNeeded` to response
- [ ] Add transfer fields to assignment response
- [ ] Update API documentation

### Phase 4: Frontend

- [ ] Update TypeScript types
- [ ] Create `TransferStrategySection` component
- [ ] Update `BookingPlanDisplay` to show transfers
- [ ] Test with real API responses

### Post-Implementation

- [ ] Run full test suite
- [ ] Manual testing with various point combinations
- [ ] Verify transfer times are accurate
- [ ] Verify portal URLs are correct
- [ ] Update documentation

---

## Appendix: Data Source Reference

### Hardcoded Transfer Partnerships

These partnerships are manually maintained. Last verified: January 2026

| Bank | Airlines | Hotels |
|------|----------|--------|
| Chase UR | UA, AA, BA, AF, VS, SQ, IB, AV, WN | HYATT, MAR, IHG |
| Amex MR | DL, BA, AF, ANA, VS, SQ, EK, JL, NH | HH (2x), MAR |
| Citi TYP | AA, SQ, TK, VS, AF, EK, QF | - |
| Capital One | AF, BA, TK, AV, QF, TP | ACC, WYNDHAM |
| Bilt | AA, UA, AF, TK, VS, IB, AV, AC | HYATT, IHG, MAR |

### Transfer Times (Hardcoded)

| Bank | Typical Time |
|------|--------------|
| Chase | Instant |
| Amex | 1-2 business days |
| Citi | Instant to 24 hours |
| Capital One | Instant to 2 days |
| Bilt | Instant |

### Portal URLs (Hardcoded)

| Bank | URL |
|------|-----|
| Chase | https://ultimaterewardspoints.chase.com |
| Amex | https://global.americanexpress.com/rewards |
| Citi | https://www.thankyou.com |
| Capital One | https://www.capitalone.com/credit-cards/rewards |
| Bilt | https://www.biltrewards.com |

---

*Document created: January 25, 2026*
*Related: `GROUP_BOOKING_ALLOCATOR_IMPLEMENTATION.md`, `REMAINING_IMPLEMENTATION_PLAN.md`*
