"""
Booking Instruction Generator

Generates step-by-step booking instructions for itineraries.
All links and prices are from real API data.
"""

import logging
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime

from .models import (
    Itinerary,
    FlightSegment,
    FlightLeg,
    TransferPlan,
    PointsTransfer,
)

logger = logging.getLogger(__name__)


# Bank transfer links
TRANSFER_LINKS = {
    "chase": "https://ultimaterewardspoints.chase.com/",
    "amex": "https://www.americanexpress.com/en-us/rewards/membership-rewards/",
    "citi": "https://www.thankyou.com/",
    "capitalone": "https://www.capitalone.com/credit-cards/rewards/",
    "bilt": "https://www.biltrewards.com/",
}

# Bank display names
BANK_NAMES = {
    "chase": "Chase Ultimate Rewards",
    "amex": "Amex Membership Rewards",
    "citi": "Citi ThankYou Points",
    "capitalone": "Capital One Miles",
    "bilt": "Bilt Rewards",
}

# Airline display names
AIRLINE_NAMES = {
    "UA": "United MileagePlus",
    "AA": "American AAdvantage",
    "DL": "Delta SkyMiles",
    "AS": "Alaska Mileage Plan",
    "B6": "JetBlue TrueBlue",
    "AC": "Aeroplan",
    "BA": "British Airways Avios",
    "AF": "Air France/KLM Flying Blue",
    "LH": "Lufthansa Miles & More",
    "SQ": "Singapore KrisFlyer",
    "CX": "Cathay Pacific Asia Miles",
    "NH": "ANA Mileage Club",
    "JL": "JAL Mileage Bank",
    "EK": "Emirates Skywards",
    "QR": "Qatar Privilege Club",
    "VS": "Virgin Atlantic Flying Club",
}


@dataclass
class BookingStep:
    """A single booking step."""
    step_number: int
    step_type: str  # "transfer", "book_flight", "book_award", "book_connecting"
    title: str
    description: str = ""
    details: List[str] = field(default_factory=list)
    link: Optional[str] = None
    link_text: str = ""
    timing: str = ""
    warning: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "step_number": self.step_number,
            "step_type": self.step_type,
            "title": self.title,
            "description": self.description,
            "details": self.details,
            "link": self.link,
            "link_text": self.link_text,
            "timing": self.timing,
            "warning": self.warning,
        }


@dataclass
class BookingSummary:
    """Summary of booking steps."""
    total_steps: int
    total_cost: float
    points_needed: Dict[str, int] = field(default_factory=dict)
    estimated_booking_time_minutes: int = 15
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_steps": self.total_steps,
            "total_cost": self.total_cost,
            "points_needed": self.points_needed,
            "estimated_booking_time_minutes": self.estimated_booking_time_minutes,
        }


@dataclass
class BookingInstructions:
    """Complete booking instructions."""
    steps: List[BookingStep] = field(default_factory=list)
    summary: Optional[BookingSummary] = None
    warnings: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "steps": [s.to_dict() for s in self.steps],
            "summary": self.summary.to_dict() if self.summary else None,
            "warnings": self.warnings,
        }


class BookingInstructionGenerator:
    """
    Generates detailed, actionable booking instructions.
    All links and prices are from real API data.
    """
    
    def generate(
        self,
        itinerary: Itinerary,
        transfer_plan: Optional[TransferPlan] = None
    ) -> BookingInstructions:
        """
        Generates complete booking instructions for the itinerary.
        
        Args:
            itinerary: The optimized itinerary
            transfer_plan: Optional transfer plan
        
        Returns:
            BookingInstructions with all steps
        """
        instructions = BookingInstructions()
        step_number = 1
        
        # Use transfer plan from itinerary if not provided
        if transfer_plan is None:
            transfer_plan = itinerary.transfer_plan
        
        # Step 1+: Point transfers (if needed)
        if transfer_plan and transfer_plan.transfers:
            for transfer in transfer_plan.transfers:
                step = self._create_transfer_step(transfer, step_number)
                instructions.steps.append(step)
                step_number += 1
                
                # Add warning for delayed transfers
                if not transfer.is_instant:
                    instructions.warnings.append(
                        f"Allow 1-2 business days for {transfer.from_bank} transfer to complete"
                    )
        
        # Steps for each flight segment
        for segment in itinerary.flight_segments:
            if segment.is_direct:
                step = self._create_direct_flight_step(segment, step_number)
            else:
                step = self._create_connecting_flight_step(segment, step_number)
            
            instructions.steps.append(step)
            step_number += 1
        
        # Generate summary
        instructions.summary = BookingSummary(
            total_steps=len(instructions.steps),
            total_cost=itinerary.total_oop,
            points_needed=itinerary.points_used,
            estimated_booking_time_minutes=len(instructions.steps) * 5
        )
        
        return instructions
    
    def _create_transfer_step(
        self,
        transfer: PointsTransfer,
        step_number: int
    ) -> BookingStep:
        """Creates booking step for a point transfer."""
        
        bank_name = BANK_NAMES.get(transfer.from_bank.lower(), transfer.from_bank)
        airline_name = AIRLINE_NAMES.get(transfer.to_airline.upper(), transfer.to_airline)
        
        details = [
            f"Points to transfer: {transfer.bank_points:,}",
            f"Transfer ratio: {transfer.ratio}:1",
            f"Points you'll receive: {transfer.airline_points:,}",
            f"Transfer time: {'Instant' if transfer.is_instant else '1-2 business days'}",
        ]
        
        return BookingStep(
            step_number=step_number,
            step_type="transfer",
            title=f"Transfer {transfer.bank_points:,} points from {bank_name} to {airline_name}",
            description=f"Transfer at {transfer.ratio}:1 ratio",
            details=details,
            link=TRANSFER_LINKS.get(transfer.from_bank.lower()),
            link_text=f"Transfer on {bank_name}",
            timing="Do this first" if not transfer.is_instant else "Can do anytime",
            warning="Wait for transfer to complete before booking" if not transfer.is_instant else None
        )
    
    def _create_direct_flight_step(
        self,
        segment: FlightSegment,
        step_number: int
    ) -> BookingStep:
        """Creates booking step for a direct flight."""
        
        leg = segment.legs[0] if segment.legs else None
        
        details = []
        
        if leg:
            if leg.departure_date:
                details.append(f"Date: {leg.departure_date}")
            if leg.departure_time:
                details.append(f"Departure: {leg.departure_time} from {segment.origin}")
            if leg.arrival_time:
                details.append(f"Arrival: {leg.arrival_time} at {segment.destination}")
            if leg.duration_minutes:
                details.append(f"Duration: {self._format_duration(leg.duration_minutes)}")
            if leg.airline_name or leg.flight_number:
                airline_info = leg.airline_name or ""
                if leg.flight_number:
                    airline_info += f" {leg.flight_number}"
                details.append(f"Flight: {airline_info.strip()}")
        
        if segment.payment_method == "cash":
            if segment.cash_cost:
                details.append(f"Price: ${segment.cash_cost:,.2f}")
            
            return BookingStep(
                step_number=step_number,
                step_type="book_flight",
                title=f"Book {segment.origin} → {segment.destination} (Direct)",
                description=f"Direct flight" + (f" on {leg.airline_name}" if leg and leg.airline_name else ""),
                details=details,
                link=segment.booking_link,
                link_text="Book Now",
                timing="Book now"
            )
        else:
            program_name = AIRLINE_NAMES.get(
                (segment.points_program or "").upper(), 
                segment.points_program or "miles"
            )
            
            if segment.points_cost:
                details.append(f"Points: {segment.points_cost:,} {program_name}")
            if segment.surcharge:
                details.append(f"Taxes/Fees: ${segment.surcharge:,.2f}")
            
            return BookingStep(
                step_number=step_number,
                step_type="book_award",
                title=f"Book {segment.origin} → {segment.destination} with {program_name}",
                description=f"Award booking" + (f" on {leg.airline_name}" if leg and leg.airline_name else ""),
                details=details,
                link=segment.booking_link,
                link_text=f"Book on {program_name}",
                timing="Book after transfers complete"
            )
    
    def _create_connecting_flight_step(
        self,
        segment: FlightSegment,
        step_number: int
    ) -> BookingStep:
        """Creates booking step for a connecting flight."""
        
        # Build route description
        route_parts = [segment.origin]
        for layover in segment.layovers:
            route_parts.append(layover.airport)
        route_parts.append(segment.destination)
        route_str = " → ".join(route_parts)
        
        details = [
            f"Route: {route_str}",
            f"Stops: {segment.num_stops}",
            "",
            "Flight Details:"
        ]
        
        for i, leg in enumerate(segment.legs):
            leg_info = f"  Leg {i+1}:"
            if leg.airline_name or leg.flight_number:
                leg_info += f" {leg.airline_name or ''} {leg.flight_number or ''}".strip()
            details.append(leg_info)
            
            times = f"    {leg.departure_airport}"
            if leg.departure_time:
                times += f" {leg.departure_time}"
            times += f" → {leg.arrival_airport}"
            if leg.arrival_time:
                times += f" {leg.arrival_time}"
            details.append(times)
            
            # Add layover info if not last leg
            if i < len(segment.layovers):
                layover = segment.layovers[i]
                details.append(
                    f"    Layover at {layover.airport}: "
                    f"{self._format_duration(layover.duration_minutes)}"
                )
        
        details.append("")
        details.append(f"Total Duration: {self._format_duration(segment.total_duration_minutes)}")
        
        if segment.payment_method == "cash":
            if segment.cash_cost:
                details.append(f"Price: ${segment.cash_cost:,.2f}")
            
            return BookingStep(
                step_number=step_number,
                step_type="book_connecting",
                title=f"Book {segment.origin} → {segment.destination} ({segment.num_stops}-stop)",
                description=route_str,
                details=details,
                link=segment.booking_link,
                link_text="Book Complete Itinerary",
                timing="Book now"
            )
        else:
            program_name = AIRLINE_NAMES.get(
                (segment.points_program or "").upper(),
                segment.points_program or "miles"
            )
            
            if segment.points_cost:
                details.append(f"Points: {segment.points_cost:,} {program_name}")
            if segment.surcharge:
                details.append(f"Taxes/Fees: ${segment.surcharge:,.2f}")
            
            return BookingStep(
                step_number=step_number,
                step_type="book_connecting",
                title=f"Book {segment.origin} → {segment.destination} ({segment.num_stops}-stop) with {program_name}",
                description=route_str,
                details=details,
                link=segment.booking_link,
                link_text=f"Book on {program_name}",
                timing="Book after transfers complete"
            )
    
    def _format_duration(self, minutes: int) -> str:
        """Formats duration in human-readable form."""
        if not minutes:
            return "Unknown"
        hours = minutes // 60
        mins = minutes % 60
        if hours > 0:
            return f"{hours}h {mins}m"
        return f"{mins}m"
    
    def generate_from_solution(
        self,
        solution: Dict[str, Any],
        edges_dict: Dict[Any, Dict[str, Any]],
        trip_data: Any
    ) -> BookingInstructions:
        """
        Generate booking instructions from ILP solution.
        
        Args:
            solution: ILP solution dictionary
            edges_dict: Flight edges dictionary
            trip_data: Trip input data
        
        Returns:
            BookingInstructions
        """
        instructions = BookingInstructions()
        step_number = 1
        
        # Extract transfers from solution
        transfers = solution.get("totals", {}).get("transfers", {})
        native_used = solution.get("totals", {}).get("native_used", {})
        
        # Create transfer steps
        for payer, by_source in transfers.items():
            for source, by_airline in by_source.items():
                for airline, data in by_airline.items():
                    if data.get("source_points", 0) > 0:
                        transfer = PointsTransfer(
                            from_bank=source,
                            to_airline=airline,
                            bank_points=data.get("source_points", 0),
                            airline_points=int(data.get("delivered_airline_points", 0)),
                            ratio=1.0,
                            is_instant=source.lower() in ["chase", "bilt"],
                        )
                        step = self._create_transfer_step(transfer, step_number)
                        instructions.steps.append(step)
                        step_number += 1
        
        # Create flight booking steps from pay_mode
        pay_modes = solution.get("pay_mode", {})
        
        for traveler, payments in pay_modes.items():
            for payment in payments:
                edge = payment.get("edge", [])
                if len(edge) >= 3:
                    origin, dest, flight_num = edge[0], edge[1], edge[2]
                    
                    # Get edge data
                    edge_key = tuple(edge)
                    edge_data = edges_dict.get(edge_key, {})
                    
                    if payment.get("type") == "cash":
                        step = BookingStep(
                            step_number=step_number,
                            step_type="book_flight",
                            title=f"Book {origin} → {dest}",
                            description=f"Flight {flight_num}",
                            details=[
                                f"Price: ${payment.get('fare', 0):,.2f}",
                            ],
                            timing="Book now"
                        )
                    else:
                        via = payment.get("via", {})
                        airline = via.get("airline") or via.get("native", "")
                        program_name = AIRLINE_NAMES.get(airline.upper(), airline)
                        
                        step = BookingStep(
                            step_number=step_number,
                            step_type="book_award",
                            title=f"Book {origin} → {dest} with {program_name}",
                            description=f"Flight {flight_num}",
                            details=[
                                f"Miles: {int(payment.get('miles', 0)):,}",
                                f"Taxes/Fees: ${payment.get('surcharge', 0):,.2f}",
                            ],
                            timing="Book after transfers complete"
                        )
                    
                    instructions.steps.append(step)
                    step_number += 1
        
        # Summary
        totals = solution.get("totals", {})
        instructions.summary = BookingSummary(
            total_steps=len(instructions.steps),
            total_cost=totals.get("cash", 0),
            points_needed={},
            estimated_booking_time_minutes=len(instructions.steps) * 5
        )
        
        return instructions
