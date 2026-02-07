"""
Connection Validator

Validates that connecting flights are actually feasible.
Uses real minimum connection times (MCT) data.
"""

import logging
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

from .models import (
    FlightLeg, 
    Layover, 
    ConnectionValidation, 
    ConnectionWarning,
    ConnectingFlightOption,
)
from .errors import InvalidConnectionError

logger = logging.getLogger(__name__)


@dataclass
class MCTResult:
    """Minimum Connection Time result."""
    minimum_minutes: int
    reason: str
    source: str  # "database" or "default"


class ConnectionValidator:
    """
    Validates that connecting flights are actually feasible.
    Uses real minimum connection times (MCT) data.
    """
    
    # Default MCTs when specific data not available
    DEFAULT_MCT = {
        "domestic_domestic": 45,      # D-D: 45 min
        "domestic_international": 90,  # D-I: 90 min
        "international_domestic": 90,  # I-D: 90 min
        "international_international": 60,  # I-I: 60 min
        "terminal_change_addon": 15,   # Add 15 min for terminal change
        "airline_change_addon": 15,    # Add 15 min for airline change
    }
    
    # Known tight connection airports (add extra time)
    TIGHT_CONNECTION_AIRPORTS = {
        "LHR": 20,  # Heathrow - large, spread out
        "CDG": 20,  # Charles de Gaulle - large
        "JFK": 15,  # Large with terminal changes
        "LAX": 15,  # Spread out
        "ORD": 15,  # O'Hare - large
        "ATL": 10,  # Atlanta - but has efficient train
        "DFW": 15,  # Dallas - large
        "DEN": 15,  # Denver - large
        "PEK": 20,  # Beijing - large
        "HKG": 15,  # Hong Kong
        "SIN": 10,  # Singapore - but efficient
        "DXB": 15,  # Dubai - large
    }
    
    # US domestic airports (for domestic/international classification)
    US_AIRPORTS = {
        "JFK", "LAX", "ORD", "DFW", "DEN", "SFO", "SEA", "ATL", "MIA", "BOS",
        "EWR", "LGA", "IAD", "DCA", "PHX", "IAH", "HOU", "MSP", "DTW", "CLT",
        "LAS", "MCO", "SAN", "SJC", "PDX", "AUS", "TPA", "STL", "MCI", "SLC",
        "BNA", "MDW", "DAL", "FLL", "BWI", "BUR", "OAK", "SNA", "ONT", "RDU",
        "SAT", "PHL",
        # Regional
        "SYR", "BUF", "ROC", "ALB", "ITH", "ELM", "BGM",
    }
    
    def __init__(self, mct_database: Optional[Dict] = None):
        """
        Initialize with MCT database.
        
        Args:
            mct_database: Optional MCT database. If None, uses defaults.
        """
        self.mct_db = mct_database or {}
    
    def validate_connection(
        self,
        arriving_leg: FlightLeg,
        departing_leg: FlightLeg
    ) -> ConnectionValidation:
        """
        Validates a single connection between two legs.
        Returns detailed validation result with warnings/errors.
        """
        # Connection airport
        connection_airport = arriving_leg.arrival_airport
        
        if connection_airport != departing_leg.departure_airport:
            return ConnectionValidation(
                valid=False,
                error=f"Connection airports don't match: {connection_airport} vs {departing_leg.departure_airport}",
                arriving_leg=arriving_leg,
                departing_leg=departing_leg
            )
        
        # Calculate actual layover time
        layover_minutes = self._calculate_layover_minutes(arriving_leg, departing_leg)
        
        if layover_minutes is None:
            # Can't determine layover - assume valid but warn
            logger.warning(
                f"Cannot determine layover time for connection at {connection_airport}"
            )
            return ConnectionValidation(
                valid=True,
                layover_minutes=None,
                warnings=[ConnectionWarning(
                    warning_type="unknown_layover",
                    message="Could not determine connection time. Please verify manually."
                )],
                arriving_leg=arriving_leg,
                departing_leg=departing_leg,
                connection_airport=connection_airport
            )
        
        # Get minimum connection time
        mct = self._get_mct(
            airport=connection_airport,
            arriving_flight=arriving_leg,
            departing_flight=departing_leg
        )
        
        # Validate
        if layover_minutes < mct.minimum_minutes:
            return ConnectionValidation(
                valid=False,
                error=f"Connection time ({layover_minutes} min) is less than minimum ({mct.minimum_minutes} min)",
                layover_minutes=layover_minutes,
                minimum_required_minutes=mct.minimum_minutes,
                arriving_leg=arriving_leg,
                departing_leg=departing_leg,
                connection_airport=connection_airport
            )
        
        # Check for warnings
        buffer_minutes = layover_minutes - mct.minimum_minutes
        warnings = []
        
        if buffer_minutes < 15:
            warnings.append(ConnectionWarning(
                warning_type="tight_connection",
                message=f"Only {buffer_minutes} min buffer beyond minimum. Consider longer layover."
            ))
        
        if layover_minutes > 360:  # 6 hours
            hours = layover_minutes // 60
            mins = layover_minutes % 60
            warnings.append(ConnectionWarning(
                warning_type="long_layover",
                message=f"Long layover of {hours}h {mins}m at {connection_airport}"
            ))
        
        # Check for terminal change
        terminal_change = (
            arriving_leg.arrival_terminal is not None and
            departing_leg.departure_terminal is not None and
            arriving_leg.arrival_terminal != departing_leg.departure_terminal
        )
        
        return ConnectionValidation(
            valid=True,
            layover_minutes=layover_minutes,
            minimum_required_minutes=mct.minimum_minutes,
            buffer_minutes=buffer_minutes,
            warnings=warnings,
            arriving_leg=arriving_leg,
            departing_leg=departing_leg,
            connection_airport=connection_airport,
            terminal_change=terminal_change
        )
    
    def _calculate_layover_minutes(
        self,
        arriving_leg: FlightLeg,
        departing_leg: FlightLeg
    ) -> Optional[int]:
        """Calculate layover time in minutes between two legs."""
        
        # Try datetime first
        if arriving_leg.arrival_datetime and departing_leg.departure_datetime:
            delta = departing_leg.departure_datetime - arriving_leg.arrival_datetime
            return int(delta.total_seconds() / 60)
        
        # Try time strings
        if arriving_leg.arrival_time and departing_leg.departure_time:
            try:
                arr_parts = arriving_leg.arrival_time.split(":")
                dep_parts = departing_leg.departure_time.split(":")
                
                arr_minutes = int(arr_parts[0]) * 60 + int(arr_parts[1])
                dep_minutes = int(dep_parts[0]) * 60 + int(dep_parts[1])
                
                # Handle overnight
                if dep_minutes < arr_minutes:
                    dep_minutes += 24 * 60
                
                return dep_minutes - arr_minutes
            except (ValueError, IndexError):
                pass
        
        return None
    
    def _get_mct(
        self,
        airport: str,
        arriving_flight: FlightLeg,
        departing_flight: FlightLeg
    ) -> MCTResult:
        """
        Gets the Minimum Connection Time for a specific connection.
        """
        
        # Determine flight types
        arriving_is_international = self._is_international(arriving_flight)
        departing_is_international = self._is_international(departing_flight)
        
        # Try to get specific MCT from database
        if self.mct_db:
            specific_mct = self.mct_db.get(airport, {}).get(
                self._get_connection_type(arriving_is_international, departing_is_international)
            )
            if specific_mct:
                return MCTResult(
                    minimum_minutes=specific_mct,
                    reason=f"Airport-specific MCT for {airport}",
                    source="database"
                )
        
        # Fall back to defaults
        base_mct = self._get_default_mct(
            arriving_is_international,
            departing_is_international
        )
        
        # Add time for terminal change
        if (arriving_flight.arrival_terminal and 
            departing_flight.departure_terminal and
            arriving_flight.arrival_terminal != departing_flight.departure_terminal):
            base_mct += self.DEFAULT_MCT["terminal_change_addon"]
        
        # Add time for airline change
        if arriving_flight.airline_code != departing_flight.airline_code:
            base_mct += self.DEFAULT_MCT["airline_change_addon"]
        
        # Add extra time for known tight connection airports
        if airport in self.TIGHT_CONNECTION_AIRPORTS:
            base_mct += self.TIGHT_CONNECTION_AIRPORTS[airport]
        
        return MCTResult(
            minimum_minutes=base_mct,
            reason="default_calculation",
            source="default"
        )
    
    def _get_default_mct(
        self,
        arriving_international: bool,
        departing_international: bool
    ) -> int:
        """Gets default MCT based on connection type."""
        
        if not arriving_international and not departing_international:
            return self.DEFAULT_MCT["domestic_domestic"]
        elif not arriving_international and departing_international:
            return self.DEFAULT_MCT["domestic_international"]
        elif arriving_international and not departing_international:
            return self.DEFAULT_MCT["international_domestic"]
        else:
            return self.DEFAULT_MCT["international_international"]
    
    def _get_connection_type(
        self,
        arriving_international: bool,
        departing_international: bool
    ) -> str:
        """Get connection type string."""
        if not arriving_international and not departing_international:
            return "domestic_domestic"
        elif not arriving_international and departing_international:
            return "domestic_international"
        elif arriving_international and not departing_international:
            return "international_domestic"
        else:
            return "international_international"
    
    def _is_international(self, flight: FlightLeg) -> bool:
        """
        Determine if a flight is international.
        A flight is international if departure and arrival are in different countries.
        Simplified: check if both are US airports.
        """
        dep_us = flight.departure_airport in self.US_AIRPORTS
        arr_us = flight.arrival_airport in self.US_AIRPORTS
        
        # International if one is US and other is not
        return dep_us != arr_us
    
    def validate_itinerary_connections(
        self,
        legs: List[FlightLeg]
    ) -> Tuple[bool, List[ConnectionValidation], List[Layover]]:
        """
        Validates ALL connections in a multi-leg itinerary.
        
        Returns:
            Tuple of (all_valid, connection_validations, layovers)
        """
        if len(legs) <= 1:
            return True, [], []
        
        validations = []
        layovers = []
        all_valid = True
        
        for i in range(len(legs) - 1):
            arriving = legs[i]
            departing = legs[i + 1]
            
            validation = self.validate_connection(arriving, departing)
            validations.append(validation)
            
            if not validation.valid:
                all_valid = False
            
            # Build layover
            if validation.layover_minutes is not None:
                layover = Layover(
                    layover_index=i,
                    airport=arriving.arrival_airport,
                    duration_minutes=validation.layover_minutes,
                    arrival_time=arriving.arrival_datetime,
                    departure_time=departing.departure_datetime,
                    arrival_terminal=arriving.arrival_terminal,
                    departure_terminal=departing.departure_terminal,
                    terminal_change=validation.terminal_change,
                    airline_change=arriving.airline_code != departing.airline_code
                )
                layovers.append(layover)
        
        return all_valid, validations, layovers
    
    def build_option_with_validation(
        self,
        option: ConnectingFlightOption
    ) -> ConnectingFlightOption:
        """
        Validate connections for a flight option and update it.
        """
        if not option.legs or len(option.legs) <= 1:
            option.connections_valid = True
            option.connection_validations = []
            return option
        
        all_valid, validations, layovers = self.validate_itinerary_connections(option.legs)
        
        option.connections_valid = all_valid
        option.connection_validations = validations
        option.layovers = layovers
        
        # Update layover time
        option.layover_time_minutes = sum(l.duration_minutes for l in layovers)
        
        # Update total duration
        option.flight_time_minutes = sum(leg.duration_minutes for leg in option.legs)
        option.total_duration_minutes = option.flight_time_minutes + option.layover_time_minutes
        
        return option
