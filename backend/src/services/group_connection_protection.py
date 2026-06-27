"""
Connection protection model for the group planning flow.

Classifies each connection in an itinerary as an online connection (same
airline, single ticket, airline-protected), an interline connection (different
airlines that through-check bags via an agreement / shared alliance), or a
self-transfer (separate tickets, bags NOT through-checked, missed connection
unprotected).

We deliberately reuse the V3 optimizer's protection vocabulary
(``TicketingType`` / ``SelfTransferRequired`` / ``ConnectionProtection``) so the
group flow speaks the same language. We do NOT run the full V3 ``_derive_protection``
edge pipeline here: it keys on provider trust (``pricing_source``) and
``validating_carrier`` provenance that the group flight searcher does not expose,
so it would collapse almost every connection to UNKNOWN. Instead we derive from
the per-leg carrier data we do have. If the searcher later surfaces ticketing
provenance, this module is the single place to upgrade.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.optimization.enums import (
    TicketingType,
    SelfTransferRequired,
    ConnectionProtection,
)

logger = logging.getLogger(__name__)

# Alliance membership is a pragmatic proxy for interline baggage agreements. The
# full current rosters live in a data file (data/airline_alliances.json) so they
# can be audited and refreshed without code changes; a minimal embedded subset is
# used only if that file is missing.
_ALLIANCE_DATA_PATH = Path(__file__).parent / "data" / "airline_alliances.json"

_FALLBACK_ALLIANCES = {
    "star_alliance": ["UA", "AC", "LH", "TK", "SQ", "NH", "AV", "LX", "TP", "OS", "SN", "BR", "ET", "CA", "A3"],
    "oneworld": ["AA", "BA", "IB", "QF", "CX", "QR", "AS", "AY", "JL", "MH", "RJ", "UL"],
    "skyteam": ["DL", "AF", "KL", "VS", "AM", "KE", "MU", "CI", "VN", "SK", "SV", "ME", "UX", "AR"],
}


def _load_alliance_groups() -> List[set]:
    """Load alliance rosters from the data file (falling back to the embedded
    subset), returning one set of IATA carrier codes per alliance."""
    try:
        with open(_ALLIANCE_DATA_PATH) as f:
            alliances = json.load(f).get("alliances", {})
        if not alliances:
            raise ValueError("no alliances in data file")
    except Exception as e:  # missing/corrupt file — degrade gracefully
        logger.warning("airline_alliances.json unavailable (%s); using fallback subset", e)
        alliances = _FALLBACK_ALLIANCES
    return [set(code.upper() for code in members) for members in alliances.values()]


_ALLIANCE_GROUPS: List[set] = _load_alliance_groups()


def are_interline(a: Optional[str], b: Optional[str]) -> bool:
    """Whether two carriers likely through-check bags: same airline, or both in
    the same alliance. Unknown carriers are treated as NOT interline so a
    bag-checking traveler errs toward a protected itinerary."""
    if not a or not b:
        return False
    a, b = a.upper(), b.upper()
    if a == b:
        return True
    return any(a in grp and b in grp for grp in _ALLIANCE_GROUPS)


def is_bag_safe(connection: Optional[Dict[str, Any]]) -> bool:
    """True when bags through-check (no self-transfer). Direct, same-airline, and
    interline connections are bag-safe; only a derived self-transfer is not.
    Used to filter options for travelers who check bags."""
    if not connection:
        return True
    return connection.get("self_transfer_required") != SelfTransferRequired.YES.value


def derive_protection(layovers: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Derive protection/ticketing/self-transfer + user warnings for an itinerary
    from its layover list (each with ``airline_change`` and ``from_airline`` /
    ``to_airline``). Returns plain serializable values (enum ``.value`` strings).

    The itinerary takes the worst classification across its connections:
    self_transfer > interline > online.
    """
    self_transfer_airports: List[str] = []
    interline_airports: List[str] = []

    for lo in layovers or []:
        if not lo.get("airline_change"):
            continue  # online (same-airline) connection — protected
        if are_interline(lo.get("from_airline"), lo.get("to_airline")):
            interline_airports.append(lo.get("airport"))
        else:
            self_transfer_airports.append(lo.get("airport"))

    warnings: List[Dict[str, str]] = []

    if self_transfer_airports:
        where = ", ".join(a for a in self_transfer_airports if a) or "a connection"
        warnings.append({
            "severity": "warning",
            "category": "transfer",
            "message": (
                f"Self-transfer at {where}: the connecting flights are on different, "
                f"non-partner airlines (separate tickets), so you may need to collect and "
                f"re-check bags, clear security again, and a missed connection won't be protected."
            ),
        })
        return _result(
            TicketingType.SEPARATE_TICKETS,
            SelfTransferRequired.YES,
            ConnectionProtection.UNPROTECTED,
            warnings,
        )

    if interline_airports:
        where = ", ".join(a for a in interline_airports if a) or "a connection"
        warnings.append({
            "severity": "info",
            "category": "transfer",
            "message": (
                f"Partner-airline connection at {where}: different airlines that interline, "
                f"so bags are normally through-checked — but a single-ticket protection isn't guaranteed."
            ),
        })
        return _result(
            TicketingType.UNKNOWN,
            SelfTransferRequired.NO,
            ConnectionProtection.UNKNOWN,
            warnings,
        )

    # Direct, or all connections on the same airline.
    return _result(
        TicketingType.SINGLE_TICKET,
        SelfTransferRequired.NO,
        ConnectionProtection.AIRLINE_PROTECTED,
        warnings,
    )


def _result(
    ticketing: TicketingType,
    self_transfer: SelfTransferRequired,
    protection: ConnectionProtection,
    warnings: List[Dict[str, str]],
) -> Dict[str, Any]:
    return {
        "ticketing_type": ticketing.value,
        "self_transfer_required": self_transfer.value,
        "connection_protection": protection.value,
        "has_self_transfer": self_transfer == SelfTransferRequired.YES,
        "warnings": warnings,
    }
