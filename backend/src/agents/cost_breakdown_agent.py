"""
Cost Breakdown Agent - Generates human-readable cost explanations.

This agent uses LLM to:
1. Explain each payment decision (cash vs points)
2. Generate step-by-step transfer instructions
3. Create group settlement summaries
4. Produce savings analysis
"""

import logging
import json
from typing import Optional

from .base import BaseAgent, AgentConfig
from .models import (
    RankedItinerary, CostBreakdown, SegmentBreakdown,
    TransferInstruction, FlightSegment, HotelSegment
)
from .config import TRANSFER_GRAPH, AIRLINE_PROGRAMS, HOTEL_PROGRAMS

logger = logging.getLogger(__name__)


class CostBreakdownAgent(BaseAgent[RankedItinerary, CostBreakdown]):
    """Generates detailed, human-readable cost breakdowns."""
    
    @property
    def name(self) -> str:
        return "CostBreakdownAgent"
    
    @property
    def system_prompt(self) -> str:
        return """You are a travel finance analyst. Given an optimized itinerary, generate a detailed cost breakdown.

For each segment, explain:
1. Why cash or points was chosen
2. The value achieved (CPP for points)
3. Transfer instructions if needed

For the overall trip:
1. Total savings vs all-cash
2. Best and worst redemptions
3. Practical advice

Be precise with numbers. Use clear, friendly language. Return valid JSON."""

    async def execute(self, itinerary: RankedItinerary) -> CostBreakdown:
        """Generate detailed cost breakdown."""
        
        # Build segments breakdown
        segments = []
        for segment in itinerary.segments:
            segments.append(self._build_segment_breakdown(segment))
        
        # Build transfer summary
        transfer_summary = self._build_transfer_summary(itinerary.transfers)
        
        # Build payment breakdown
        payment_breakdown = self._build_payment_breakdown(itinerary)
        
        # Build value analysis
        value_analysis = self._build_value_analysis(itinerary)
        
        # Try to get AI enhancement if available
        if self.client:
            try:
                enhanced = await self._enhance_with_llm(itinerary, segments)
                if enhanced:
                    # Merge AI explanations
                    for i, seg in enumerate(enhanced.get("segments", [])):
                        if i < len(segments) and "reason" in seg:
                            segments[i].reason = seg["reason"]
            except Exception as e:
                logger.warning(f"LLM enhancement failed: {e}")
        
        return CostBreakdown(
            trip_summary={
                "route": " → ".join(itinerary.route),
                "total_cash_price": itinerary.oop_metrics.total_cash_price,
                "total_out_of_pocket": itinerary.oop_metrics.total_out_of_pocket,
                "total_savings": itinerary.oop_metrics.cash_saved,
                "savings_percentage": itinerary.oop_metrics.savings_percentage,
            },
            segments=segments,
            transfer_summary=transfer_summary,
            payment_breakdown=payment_breakdown,
            value_analysis=value_analysis,
        )
    
    def _build_segment_breakdown(self, segment: FlightSegment | HotelSegment) -> SegmentBreakdown:
        """Build breakdown for a single segment."""
        is_flight = segment.type == "flight"
        is_points = segment.payment.method == "points"
        
        if is_flight:
            seg = segment  # type: FlightSegment
            segment_name = f"{seg.origin} → {seg.destination} ({seg.cabin_class})"
            cash_price = seg.cash_price
        else:
            seg = segment  # type: HotelSegment
            segment_name = f"{seg.name} ({seg.nights} nights)"
            cash_price = seg.cash_price_total
        
        breakdown = SegmentBreakdown(
            segment=segment_name,
            type=segment.type,
            cash_price=cash_price,
            payment_method=segment.payment.method,
        )
        
        if is_points:
            payment = segment.payment  # PointsPayment
            breakdown.program = payment.program
            breakdown.points_used = payment.points_used
            breakdown.surcharge = payment.surcharge
            breakdown.cpp_achieved = payment.cpp_achieved
            breakdown.transfer = payment.transfer
            breakdown.reason = payment.reason or self._generate_points_reason(
                cash_price, payment.points_used, payment.surcharge, payment.cpp_achieved
            )
        else:
            payment = segment.payment  # CashPayment
            breakdown.amount = payment.amount
            breakdown.reason = payment.reason or self._generate_cash_reason(cash_price)
        
        return breakdown
    
    def _generate_points_reason(
        self, 
        cash_price: float, 
        points: int, 
        surcharge: float,
        cpp: Optional[float]
    ) -> str:
        """Generate reason for points payment."""
        saved = cash_price - surcharge
        cpp_str = f"{cpp:.1f}¢/pt" if cpp else ""
        return f"Using points saves ${saved:.0f} vs cash. {cpp_str} value achieved."
    
    def _generate_cash_reason(self, cash_price: float) -> str:
        """Generate reason for cash payment."""
        if cash_price < 200:
            return "Low cash price makes points less worthwhile for this segment."
        return "Cash is the best option for this segment based on availability."
    
    def _build_transfer_summary(self, transfers: list[TransferInstruction]) -> dict:
        """Build transfer summary."""
        if not transfers:
            return {
                "total_transfers": 0,
                "by_source": {},
                "recommended_order": [],
                "timing_advice": "No transfers needed.",
            }
        
        by_source = {}
        for transfer in transfers:
            source = transfer.from_program
            if source not in by_source:
                by_source[source] = {
                    "total_transferred": 0,
                    "destinations": [],
                }
            by_source[source]["total_transferred"] += transfer.points_to_transfer
            by_source[source]["destinations"].append(
                f"{transfer.to_program} ({transfer.points_to_transfer:,})"
            )
        
        # Generate recommended order
        recommended_order = []
        for i, transfer in enumerate(transfers, 1):
            timing = "instant" if "instant" in transfer.transfer_time.lower() else "1-2 days"
            recommended_order.append(
                f"{i}. Transfer {transfer.from_program} → {transfer.to_program} ({timing})"
            )
        
        return {
            "total_transfers": len(transfers),
            "by_source": by_source,
            "recommended_order": recommended_order,
            "timing_advice": "Complete all transfers 2-3 days before booking to ensure points post correctly.",
        }
    
    def _build_payment_breakdown(self, itinerary: RankedItinerary) -> dict:
        """Build payment breakdown."""
        cash_payments = []
        points_used = {}
        total_cash = 0.0
        
        for segment in itinerary.segments:
            if segment.payment.method == "cash":
                is_flight = segment.type == "flight"
                if is_flight:
                    item = f"{segment.origin} → {segment.destination}"
                else:
                    item = f"{segment.name}"
                cash_payments.append({
                    "item": item,
                    "amount": segment.payment.amount,
                })
                total_cash += segment.payment.amount
            else:
                program = segment.payment.program
                points = segment.payment.points_used
                if program not in points_used:
                    points_used[program] = 0
                points_used[program] += points
                
                # Add surcharge to cash
                if segment.payment.surcharge:
                    is_flight = segment.type == "flight"
                    if is_flight:
                        item = f"{segment.origin} → {segment.destination} surcharge"
                    else:
                        item = f"{segment.name} surcharge"
                    cash_payments.append({
                        "item": item,
                        "amount": segment.payment.surcharge,
                    })
                    total_cash += segment.payment.surcharge
        
        return {
            "cash_payments": cash_payments,
            "total_cash": total_cash,
            "points_used": points_used,
            "total_points": sum(points_used.values()),
        }
    
    def _build_value_analysis(self, itinerary: RankedItinerary) -> dict:
        """Build value analysis."""
        cpp_values = []
        
        for segment in itinerary.segments:
            if segment.payment.method == "points" and segment.payment.cpp_achieved:
                is_flight = segment.type == "flight"
                if is_flight:
                    name = f"{segment.origin} → {segment.destination}"
                else:
                    name = segment.name
                cpp_values.append({
                    "segment": name,
                    "cpp": segment.payment.cpp_achieved,
                    "program": segment.payment.program,
                })
        
        if not cpp_values:
            return {
                "average_cpp": 0,
                "best_redemption": None,
                "worst_redemption": None,
            }
        
        cpp_values.sort(key=lambda x: x["cpp"], reverse=True)
        
        return {
            "average_cpp": itinerary.oop_metrics.average_cpp,
            "best_redemption": cpp_values[0],
            "worst_redemption": cpp_values[-1] if len(cpp_values) > 1 else None,
        }
    
    async def _enhance_with_llm(
        self, 
        itinerary: RankedItinerary,
        segments: list[SegmentBreakdown]
    ) -> Optional[dict]:
        """Use LLM to enhance explanations."""
        prompt = f"""Analyze this travel itinerary and provide enhanced explanations for each segment.

Route: {' → '.join(itinerary.route)}
Total Out-of-Pocket: ${itinerary.oop_metrics.total_out_of_pocket}
Total Savings: ${itinerary.oop_metrics.cash_saved} ({itinerary.oop_metrics.savings_percentage:.0f}%)

Segments:
{json.dumps([s.model_dump() for s in segments], indent=2)}

For each segment, provide a clear, friendly 1-2 sentence explanation of why this payment method was chosen.

Return JSON: {{"segments": [{{"segment": "...", "reason": "..."}}]}}"""

        return await self._call_llm_json([
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": prompt}
        ])
