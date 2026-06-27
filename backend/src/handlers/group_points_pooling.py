"""
Group Points Pooling Engine

Aggregates points across all group members and calculates transfer potential.
Provides utilities for finding optimal points sources for group bookings.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
import logging

from .transfer_strategy import EXTENDED_TRANSFER_GRAPH, get_transfer_partners
from .fair_market_values import get_fair_market_value, get_cpp
from .group_oop_optimizer import (
    GroupMember,
    GroupPointsPool,
    BANK_PROGRAMS,
)
from src.config.programs import PROGRAM_DISPLAY_NAMES, normalize_bank_key

logger = logging.getLogger(__name__)

# Reverse of PROGRAM_DISPLAY_NAMES: normalized display name -> canonical code,
# e.g. "ana mileage club" -> "NH", "american express membership rewards" -> "amex".
_DISPLAY_NAME_TO_CODE: Dict[str, str] = {
    name.strip().lower(): code for code, name in PROGRAM_DISPLAY_NAMES.items()
}


def resolve_program_key(program: str) -> str:
    """Resolve a balance's program identifier — which may be a canonical code
    ("amex", "NH") OR a human display name ("Amex Membership Rewards",
    "ANA Mileage Club") — to the canonical key used across pooling/transfer logic.

    Banks resolve to their lowercase short code (amex, chase) so they match
    ``BANK_PROGRAMS`` and ``EXTENDED_TRANSFER_GRAPH``; airlines/hotels resolve to
    their uppercase code (NH, UA, MAR). Display names are stored by the intake/UI
    layer, so without this a member's transferable bank points were invisible to
    the flight award search (every option came back with no eligible owner).
    """
    if not program:
        return ""
    raw = program.strip()
    # Already a canonical short bank code (amex, chase, ...).
    if raw.lower() in BANK_PROGRAMS:
        return raw.lower()
    # Bank display-name variants ("Amex Membership Rewards" -> "amex").
    bank = normalize_bank_key(raw)
    if bank in BANK_PROGRAMS:
        return bank
    # Airline/hotel display name -> code ("ANA Mileage Club" -> "NH").
    code = _DISPLAY_NAME_TO_CODE.get(raw.lower())
    if code:
        return code if code in BANK_PROGRAMS else code.upper()
    # Already an airline/hotel code, or unknown -> uppercase.
    return raw.upper()


# =============================================================================
# POINTS AGGREGATION
# =============================================================================

def aggregate_group_points(members: List[GroupMember]) -> GroupPointsPool:
    """
    Aggregate points across all group members into a unified pool.
    
    Args:
        members: List of GroupMember objects with their points balances
        
    Returns:
        GroupPointsPool with totals, breakdowns, and transfer potential
        
    Example:
        >>> members = [
        ...     GroupMember(user_id="alice", name="Alice", 
        ...                 points_balances={"chase": 150000}),
        ...     GroupMember(user_id="bob", name="Bob",
        ...                 points_balances={"amex": 200000, "UA": 50000}),
        ... ]
        >>> pool = aggregate_group_points(members)
        >>> pool.total_by_program
        {"chase": 150000, "amex": 200000, "UA": 50000}
    """
    total_by_program: Dict[str, int] = {}
    by_member: Dict[str, Dict[str, int]] = {}
    shareable_pool: Dict[str, int] = {}
    total_value = 0.0
    
    for member in members:
        member_points: Dict[str, int] = {}
        
        for program, balance in member.points_balances.items():
            if balance is None or balance <= 0:
                continue
            
            # Normalize program identifier (code OR display name) to the canonical
            # key. Banks -> lowercase short code (chase, amex); airlines/hotels ->
            # uppercase code (UA, NH, MAR).
            prog = resolve_program_key(program)
            
            balance = int(balance)
            
            # Add to totals
            total_by_program[prog] = total_by_program.get(prog, 0) + balance
            member_points[prog] = balance
            
            # Add to shareable pool if member allows
            if member.willing_to_share_points:
                shareable_pool[prog] = shareable_pool.get(prog, 0) + balance
            
            # Calculate value
            total_value += get_fair_market_value(prog, balance)
        
        by_member[member.user_id] = member_points
    
    # Calculate transfer potential for bank programs
    transfer_potential: Dict[str, List[str]] = {}
    for prog in total_by_program.keys():
        prog_lower = prog.lower()
        if prog_lower in EXTENDED_TRANSFER_GRAPH:
            partners = list(EXTENDED_TRANSFER_GRAPH[prog_lower].keys())
            transfer_potential[prog] = partners
    
    return GroupPointsPool(
        total_by_program=total_by_program,
        by_member=by_member,
        shareable_pool=shareable_pool,
        transfer_potential=transfer_potential,
        total_value=round(total_value, 2),
    )


# =============================================================================
# POINTS SOURCE FINDING
# =============================================================================

@dataclass
class PointsSource:
    """A source of points for a booking."""
    member_id: str
    member_name: str
    program: str
    amount: int
    is_transfer: bool = False
    transfer_from: Optional[str] = None
    transfer_ratio: float = 1.0
    resulting_points: int = 0
    value_usd: float = 0.0


def find_points_sources(
    program_needed: str,
    points_needed: int,
    members: List[GroupMember],
    pool: GroupPointsPool,
    *,
    prefer_member: Optional[str] = None,
    allow_cross_member: bool = True,
) -> List[PointsSource]:
    """
    Find which member(s) can provide points for a given need.
    
    Prioritizes:
    1. Preferred member's direct balance (if specified)
    2. Any member's direct balance
    3. Preferred member's bank transfers
    4. Any member's bank transfers
    5. Combining multiple members if needed
    
    Args:
        program_needed: Airline/hotel program code (e.g., "UA", "HH")
        points_needed: Number of points required
        members: List of group members
        pool: Aggregated points pool
        prefer_member: Optional member ID to prefer (e.g., the beneficiary)
        allow_cross_member: Allow using other members' points
        
    Returns:
        List of PointsSource objects describing how to get the points
    """
    sources: List[PointsSource] = []
    remaining = points_needed
    prog_upper = program_needed.upper()
    
    # Build member lookup
    member_lookup = {m.user_id: m for m in members}
    
    # Order members: prefer_member first, then others
    ordered_members = []
    if prefer_member:
        for m in members:
            if m.user_id == prefer_member:
                ordered_members.append(m)
                break
    for m in members:
        if m.user_id != prefer_member:
            if allow_cross_member or m.user_id == prefer_member:
                ordered_members.append(m)
    
    # Strategy 1: Direct balance (member already has the airline/hotel points)
    for member in ordered_members:
        if not member.willing_to_share_points and member.user_id != prefer_member:
            continue
        
        member_points = pool.by_member.get(member.user_id, {})
        direct_balance = member_points.get(prog_upper, 0)
        
        if direct_balance > 0:
            use_amount = min(direct_balance, remaining)
            sources.append(PointsSource(
                member_id=member.user_id,
                member_name=member.name,
                program=prog_upper,
                amount=use_amount,
                is_transfer=False,
                resulting_points=use_amount,
                value_usd=get_fair_market_value(prog_upper, use_amount),
            ))
            remaining -= use_amount
            
            if remaining <= 0:
                return sources
    
    # Strategy 2: Transfer from bank points
    for member in ordered_members:
        if not member.willing_to_share_points and member.user_id != prefer_member:
            continue
        
        member_points = pool.by_member.get(member.user_id, {})
        
        for bank in BANK_PROGRAMS:
            balance = member_points.get(bank, 0)
            if balance <= 0:
                continue
            
            if bank not in EXTENDED_TRANSFER_GRAPH:
                continue
            
            if prog_upper not in EXTENDED_TRANSFER_GRAPH[bank]:
                continue
            
            transfer_info = EXTENDED_TRANSFER_GRAPH[bank][prog_upper]
            ratio = transfer_info.get("ratio", 1.0)
            
            # How many bank points needed for remaining program points?
            bank_points_needed = int(remaining / ratio) if ratio > 0 else remaining
            use_amount = min(balance, bank_points_needed)
            
            if use_amount > 0:
                resulting_points = int(use_amount * ratio)
                sources.append(PointsSource(
                    member_id=member.user_id,
                    member_name=member.name,
                    program=bank,
                    amount=use_amount,
                    is_transfer=True,
                    transfer_from=bank,
                    transfer_ratio=ratio,
                    resulting_points=resulting_points,
                    value_usd=get_fair_market_value(bank, use_amount),
                ))
                remaining -= resulting_points
                
                if remaining <= 0:
                    return sources
    
    # If we get here, not enough points available
    # Return what we found (may be partial)
    return sources


def find_best_single_source(
    program_needed: str,
    points_needed: int,
    members: List[GroupMember],
    pool: GroupPointsPool,
) -> Optional[PointsSource]:
    """
    Find a single member who can provide all needed points.
    
    Prioritizes:
    1. Direct balance (no transfer needed)
    2. Best transfer ratio
    3. Fastest transfer time
    
    Args:
        program_needed: Program code
        points_needed: Points required
        members: Group members
        pool: Points pool
        
    Returns:
        PointsSource or None if no single member can provide
    """
    prog_upper = program_needed.upper()
    best_source: Optional[PointsSource] = None
    best_score = float('inf')
    
    for member in members:
        if not member.willing_to_share_points:
            continue
        
        member_points = pool.by_member.get(member.user_id, {})
        
        # Check direct balance
        direct = member_points.get(prog_upper, 0)
        if direct >= points_needed:
            # Score: 0 for direct (best)
            score = 0
            if best_source is None or score < best_score:
                best_source = PointsSource(
                    member_id=member.user_id,
                    member_name=member.name,
                    program=prog_upper,
                    amount=points_needed,
                    is_transfer=False,
                    resulting_points=points_needed,
                    value_usd=get_fair_market_value(prog_upper, points_needed),
                )
                best_score = score
        
        # Check bank transfers
        for bank in BANK_PROGRAMS:
            balance = member_points.get(bank, 0)
            if balance <= 0 or bank not in EXTENDED_TRANSFER_GRAPH:
                continue
            
            if prog_upper not in EXTENDED_TRANSFER_GRAPH[bank]:
                continue
            
            transfer_info = EXTENDED_TRANSFER_GRAPH[bank][prog_upper]
            ratio = transfer_info.get("ratio", 1.0)
            
            bank_points_needed = int(points_needed / ratio) if ratio > 0 else points_needed
            if balance < bank_points_needed:
                continue
            
            # Score: penalize bad ratios and slow transfers
            transfer_time = transfer_info.get("transfer_time", "varies")
            time_penalty = {
                "instant": 1,
                "1-2 business days": 2,
                "2-3 business days": 3,
            }.get(transfer_time, 2.5)
            
            ratio_penalty = max(0, (1.0 / ratio) - 1) * 10 if ratio > 0 else 10
            score = time_penalty + ratio_penalty
            
            if best_source is None or score < best_score:
                best_source = PointsSource(
                    member_id=member.user_id,
                    member_name=member.name,
                    program=bank,
                    amount=bank_points_needed,
                    is_transfer=True,
                    transfer_from=bank,
                    transfer_ratio=ratio,
                    resulting_points=points_needed,
                    value_usd=get_fair_market_value(bank, bank_points_needed),
                )
                best_score = score
    
    return best_source


# =============================================================================
# POOL ANALYSIS
# =============================================================================

def analyze_pool_coverage(
    pool: GroupPointsPool,
    target_programs: List[str],
    amounts_needed: Dict[str, int],
) -> Dict[str, Any]:
    """
    Analyze how well the pool can cover needed programs.
    
    Args:
        pool: Aggregated points pool
        target_programs: Programs needed (e.g., ["UA", "HH"])
        amounts_needed: Points needed per program
        
    Returns:
        Analysis dict with coverage percentages and recommendations
    """
    analysis = {
        "programs": {},
        "overall_coverage": 0.0,
        "recommendations": [],
    }
    
    total_needed_value = 0.0
    total_covered_value = 0.0
    
    for prog in target_programs:
        prog_upper = prog.upper()
        needed = amounts_needed.get(prog, 0)
        
        if needed <= 0:
            continue
        
        needed_value = get_fair_market_value(prog_upper, needed)
        total_needed_value += needed_value
        
        # Calculate available (direct + transferable)
        direct = pool.total_by_program.get(prog_upper, 0)
        
        # Transferable from banks
        transferable = 0
        for bank in BANK_PROGRAMS:
            bank_balance = pool.total_by_program.get(bank, 0)
            if bank_balance > 0 and bank in EXTENDED_TRANSFER_GRAPH:
                if prog_upper in EXTENDED_TRANSFER_GRAPH[bank]:
                    ratio = EXTENDED_TRANSFER_GRAPH[bank][prog_upper].get("ratio", 1.0)
                    transferable += int(bank_balance * ratio)
        
        available = direct + transferable
        coverage_pct = min(100, (available / needed * 100)) if needed > 0 else 100
        covered = min(needed, available)
        covered_value = get_fair_market_value(prog_upper, covered)
        total_covered_value += covered_value
        
        analysis["programs"][prog_upper] = {
            "needed": needed,
            "direct_available": direct,
            "transferable": transferable,
            "total_available": available,
            "coverage_percentage": round(coverage_pct, 1),
            "shortfall": max(0, needed - available),
            "covered_value": round(covered_value, 2),
        }
        
        # Generate recommendations
        if coverage_pct < 100:
            shortfall = needed - available
            analysis["recommendations"].append({
                "program": prog_upper,
                "message": f"Short {shortfall:,} {prog_upper} points. Consider purchasing or earning more.",
                "severity": "warning" if coverage_pct >= 50 else "critical",
            })
    
    analysis["overall_coverage"] = round(
        (total_covered_value / total_needed_value * 100) if total_needed_value > 0 else 100,
        1
    )
    
    return analysis


def get_pool_summary(pool: GroupPointsPool, members: List[GroupMember]) -> Dict[str, Any]:
    """
    Get a summary of the points pool for display.
    
    Args:
        pool: Aggregated points pool
        members: Group members
        
    Returns:
        Summary dict for frontend display
    """
    member_lookup = {m.user_id: m for m in members}
    
    # Calculate totals
    total_bank_points = sum(
        pool.total_by_program.get(bank, 0) 
        for bank in BANK_PROGRAMS
    )
    total_airline_points = sum(
        v for k, v in pool.total_by_program.items() 
        if k.upper() == k and k not in BANK_PROGRAMS
    )
    
    # Calculate per-member value
    member_values = {}
    for member_id, points in pool.by_member.items():
        value = sum(get_fair_market_value(prog, bal) for prog, bal in points.items())
        member = member_lookup.get(member_id)
        member_values[member_id] = {
            "member_name": member.name if member else member_id,
            "total_points": sum(points.values()),
            "total_value": round(value, 2),
            "willing_to_share": member.willing_to_share_points if member else True,
        }
    
    return {
        "total_by_program": pool.total_by_program,
        "total_value": pool.total_value,
        "shareable_value": round(
            sum(get_fair_market_value(p, b) for p, b in pool.shareable_pool.items()),
            2
        ),
        "member_count": len(pool.by_member),
        "total_bank_points": total_bank_points,
        "total_airline_points": total_airline_points,
        "transfer_potential": pool.transfer_potential,
        "by_member": member_values,
    }


# =============================================================================
# TRANSFER PATH OPTIMIZATION
# =============================================================================

def find_optimal_transfer_path(
    target_program: str,
    points_needed: int,
    pool: GroupPointsPool,
    members: List[GroupMember],
) -> Optional[Dict[str, Any]]:
    """
    Find the optimal transfer path to get points for a target program.
    
    Considers:
    - Transfer ratios (prefer 1:1 or better)
    - Transfer times (prefer instant)
    - Available balances across all members
    
    Args:
        target_program: Target airline/hotel program
        points_needed: Points required
        pool: Aggregated points pool
        members: Group members
        
    Returns:
        Optimal transfer path or None if impossible
    """
    prog_upper = target_program.upper()
    best_path = None
    best_score = float('inf')
    
    for member in members:
        if not member.willing_to_share_points:
            continue
        
        member_points = pool.by_member.get(member.user_id, {})
        
        for bank in BANK_PROGRAMS:
            balance = member_points.get(bank, 0)
            if balance <= 0 or bank not in EXTENDED_TRANSFER_GRAPH:
                continue
            
            if prog_upper not in EXTENDED_TRANSFER_GRAPH[bank]:
                continue
            
            transfer_info = EXTENDED_TRANSFER_GRAPH[bank][prog_upper]
            ratio = transfer_info.get("ratio", 1.0)
            
            # Calculate bank points needed
            bank_points_needed = int(points_needed / ratio) if ratio > 0 else points_needed
            
            if balance < bank_points_needed:
                continue  # Not enough points
            
            # Score: lower is better
            transfer_time = transfer_info.get("transfer_time", "varies")
            time_penalty = {
                "instant": 0,
                "1-2 business days": 1,
                "2-3 business days": 2,
                "varies": 3,
            }.get(transfer_time, 2)
            
            ratio_penalty = max(0, (1.0 / ratio) - 1) * 10 if ratio > 0 else 10
            score = bank_points_needed + (ratio_penalty * 1000) + (time_penalty * 100)
            
            if score < best_score:
                best_score = score
                best_path = {
                    "member_id": member.user_id,
                    "member_name": member.name,
                    "from_program": bank,
                    "to_program": prog_upper,
                    "bank_points_needed": bank_points_needed,
                    "resulting_points": points_needed,
                    "ratio": ratio,
                    "transfer_time": transfer_time,
                    "value": get_fair_market_value(bank, bank_points_needed),
                }
    
    return best_path


def get_all_transfer_paths_to_program(
    target_program: str,
    pool: GroupPointsPool,
    members: List[GroupMember],
) -> List[Dict[str, Any]]:
    """
    Get all possible transfer paths to a target program.
    
    Args:
        target_program: Target program code
        pool: Points pool
        members: Group members
        
    Returns:
        List of possible transfer paths, sorted by efficiency
    """
    prog_upper = target_program.upper()
    paths = []
    
    for member in members:
        if not member.willing_to_share_points:
            continue
        
        member_points = pool.by_member.get(member.user_id, {})
        
        for bank in BANK_PROGRAMS:
            balance = member_points.get(bank, 0)
            if balance <= 0 or bank not in EXTENDED_TRANSFER_GRAPH:
                continue
            
            if prog_upper not in EXTENDED_TRANSFER_GRAPH[bank]:
                continue
            
            transfer_info = EXTENDED_TRANSFER_GRAPH[bank][prog_upper]
            ratio = transfer_info.get("ratio", 1.0)
            max_resulting = int(balance * ratio)
            
            paths.append({
                "member_id": member.user_id,
                "member_name": member.name,
                "from_program": bank,
                "to_program": prog_upper,
                "available_bank_points": balance,
                "max_resulting_points": max_resulting,
                "ratio": ratio,
                "transfer_time": transfer_info.get("transfer_time", "varies"),
                "program_name": transfer_info.get("name", prog_upper),
            })
    
    # Sort by ratio (best first), then by available points (most first)
    paths.sort(key=lambda x: (-x["ratio"], -x["available_bank_points"]))
    
    return paths
