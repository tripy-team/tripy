"""
Strict Trip Input Validator

Validates all user inputs with zero tolerance for missing/invalid data.
NO bypass mechanisms - invalid input = explicit rejection.
"""

import logging
from datetime import date, datetime
from typing import List, Dict, Any, Optional, Set
from dataclasses import dataclass, field

from .models import TripInput, Destination, CabinClass
from .errors import ValidationError

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """Result of validation."""
    valid: bool
    errors: List[ValidationError] = field(default_factory=list)
    can_proceed: bool = False
    message: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": [e.to_dict() for e in self.errors],
            "can_proceed": self.can_proceed,
            "message": self.message,
            "warnings": self.warnings
        }


class StrictTripInputValidator:
    """
    Validates all user inputs with zero tolerance for missing/invalid data.
    NO bypass mechanisms - invalid input = explicit rejection.
    """
    
    def __init__(self, airports_db: Optional[Set[str]] = None):
        """
        Initialize validator with airports database.
        
        Args:
            airports_db: Set of valid IATA airport codes. If None, loads from default.
        """
        self.airports_db = airports_db or self._load_airports_db()
    
    def _load_airports_db(self) -> Set[str]:
        """Load airport database from file."""
        airports = set()
        try:
            import csv
            from pathlib import Path
            
            # Try to load from airports.csv
            airports_file = Path(__file__).parent.parent.parent.parent / "files" / "airports.csv"
            if airports_file.exists():
                with open(airports_file, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        code = row.get('iata_code') or row.get('iata') or row.get('code')
                        if code and len(code) == 3:
                            airports.add(code.upper())
            
            # Also try to load from the airport service
            try:
                from src.handlers.airport_filter import load_commercial_iata_set_from_web
                commercial = load_commercial_iata_set_from_web()
                if commercial:
                    airports.update(commercial)
            except Exception:
                pass
            
            logger.info(f"Loaded {len(airports)} airport codes")
            
        except Exception as e:
            logger.warning(f"Could not load airports database: {e}")
        
        # If no airports loaded, use a basic set of major airports
        if not airports:
            airports = {
                "JFK", "LAX", "ORD", "DFW", "DEN", "SFO", "SEA", "ATL", "MIA", "BOS",
                "LHR", "CDG", "FRA", "AMS", "MAD", "FCO", "MUC", "ZRH", "VIE", "BCN",
                "NRT", "HND", "ICN", "PEK", "PVG", "HKG", "SIN", "BKK", "SYD", "MEL",
                "DXB", "DOH", "AUH", "IST", "JNB", "CAI", "DEL", "BOM", "GRU", "MEX",
            }
            logger.warning(f"Using fallback airport set with {len(airports)} codes")
        
        return airports
    
    def validate(self, trip_data: Dict[str, Any]) -> ValidationResult:
        """
        Validates trip input. Returns errors if invalid.
        NEVER returns partial validation - all or nothing.
        """
        errors = []
        warnings = []
        
        # ============================================================
        # REQUIRED FIELDS - STRICT VALIDATION
        # ============================================================
        
        # Start destination: REQUIRED, must be valid IATA code
        start_dest = trip_data.get("start_destination") or trip_data.get("startDestination")
        if not start_dest:
            errors.append(ValidationError(
                field="start_destination",
                message="Start destination is required. Enter a valid airport code (e.g., JFK, LAX).",
                code="MISSING_START_DESTINATION",
                severity="blocking"
            ))
        elif not self._is_valid_iata_code(start_dest):
            suggestions = self._suggest_airports(start_dest)
            errors.append(ValidationError(
                field="start_destination",
                message=f"'{start_dest}' is not a recognized airport code.",
                code="INVALID_START_AIRPORT",
                severity="blocking",
                suggestions=suggestions
            ))
        
        # End destination: REQUIRED, must be valid IATA code
        end_dest = trip_data.get("end_destination") or trip_data.get("endDestination")
        if not end_dest:
            errors.append(ValidationError(
                field="end_destination",
                message="End destination is required. Enter a valid airport code.",
                code="MISSING_END_DESTINATION",
                severity="blocking"
            ))
        elif not self._is_valid_iata_code(end_dest):
            suggestions = self._suggest_airports(end_dest)
            errors.append(ValidationError(
                field="end_destination",
                message=f"'{end_dest}' is not a recognized airport code.",
                code="INVALID_END_AIRPORT",
                severity="blocking",
                suggestions=suggestions
            ))
        
        # Destinations: REQUIRED, at least one
        destinations = trip_data.get("destinations") or []
        if not destinations or len(destinations) == 0:
            errors.append(ValidationError(
                field="destinations",
                message="At least one destination city is required.",
                code="NO_DESTINATIONS",
                severity="blocking"
            ))
        else:
            # Validate each destination
            for i, dest in enumerate(destinations):
                dest_errors = self._validate_destination(dest, index=i)
                errors.extend(dest_errors)
        
        # Dates: REQUIRED
        date_errors, date_warnings = self._validate_dates_strictly(trip_data)
        errors.extend(date_errors)
        warnings.extend(date_warnings)
        
        # Optional: Budget validation (warning only)
        max_budget = trip_data.get("max_budget") or trip_data.get("maxBudget")
        if max_budget is not None:
            try:
                budget_val = float(max_budget)
                if budget_val < 0:
                    errors.append(ValidationError(
                        field="max_budget",
                        message="Budget cannot be negative.",
                        code="INVALID_BUDGET",
                        severity="blocking"
                    ))
                elif budget_val < 100:
                    warnings.append("Budget seems very low. Most trips cost at least $100.")
            except (TypeError, ValueError):
                errors.append(ValidationError(
                    field="max_budget",
                    message="Budget must be a valid number.",
                    code="INVALID_BUDGET_FORMAT",
                    severity="blocking"
                ))
        
        # ============================================================
        # BLOCKING ERRORS = IMMEDIATE REJECTION
        # ============================================================
        
        blocking_errors = [e for e in errors if e.severity == "blocking"]
        if blocking_errors:
            return ValidationResult(
                valid=False,
                errors=blocking_errors,
                can_proceed=False,
                message="Cannot proceed with invalid input. Please correct the errors above.",
                warnings=warnings
            )
        
        return ValidationResult(
            valid=True,
            errors=[],
            can_proceed=True,
            warnings=warnings
        )
    
    def _validate_dates_strictly(self, trip_data: Dict[str, Any]) -> tuple:
        """
        Strict date validation. NO default dates.
        Returns (errors, warnings).
        """
        errors = []
        warnings = []
        
        flexible_dates = trip_data.get("flexible_dates") or trip_data.get("flexibleDates", False)
        one_way = trip_data.get("one_way") or trip_data.get("oneWay", False)
        
        if flexible_dates:
            # Flexible mode: duration required
            duration = trip_data.get("duration_days") or trip_data.get("durationDays")
            if not duration or int(duration) < 1:
                errors.append(ValidationError(
                    field="duration_days",
                    message="Trip duration is required for flexible dates (minimum 1 day).",
                    code="MISSING_DURATION",
                    severity="blocking"
                ))
            elif int(duration) > 30:
                errors.append(ValidationError(
                    field="duration_days",
                    message="Trip duration cannot exceed 30 days.",
                    code="DURATION_TOO_LONG",
                    severity="blocking"
                ))
            
            # Search window validation
            earliest = trip_data.get("earliest_date") or trip_data.get("earliestDate")
            if earliest:
                try:
                    earliest_date = self._parse_date(earliest)
                    if earliest_date < date.today():
                        errors.append(ValidationError(
                            field="earliest_date",
                            message="Earliest date cannot be in the past.",
                            code="PAST_DATE",
                            severity="blocking"
                        ))
                except Exception:
                    errors.append(ValidationError(
                        field="earliest_date",
                        message="Invalid date format for earliest date.",
                        code="INVALID_DATE_FORMAT",
                        severity="blocking"
                    ))
        else:
            # Fixed dates mode: start date required
            start_date_str = trip_data.get("start_date") or trip_data.get("startDate")
            end_date_str = trip_data.get("end_date") or trip_data.get("endDate")
            
            if not start_date_str:
                errors.append(ValidationError(
                    field="start_date",
                    message="Start date is required.",
                    code="MISSING_START_DATE",
                    severity="blocking"
                ))
            else:
                try:
                    start_date = self._parse_date(start_date_str)
                    if start_date < date.today():
                        errors.append(ValidationError(
                            field="start_date",
                            message="Start date cannot be in the past.",
                            code="PAST_START_DATE",
                            severity="blocking"
                        ))
                except Exception:
                    errors.append(ValidationError(
                        field="start_date",
                        message="Invalid date format for start date. Use YYYY-MM-DD.",
                        code="INVALID_DATE_FORMAT",
                        severity="blocking"
                    ))
            
            if not one_way:
                if not end_date_str:
                    errors.append(ValidationError(
                        field="end_date",
                        message="End date is required for round trips.",
                        code="MISSING_END_DATE",
                        severity="blocking"
                    ))
                elif start_date_str:
                    try:
                        start_date = self._parse_date(start_date_str)
                        end_date = self._parse_date(end_date_str)
                        if end_date < start_date:
                            errors.append(ValidationError(
                                field="end_date",
                                message="End date must be after start date.",
                                code="INVALID_DATE_RANGE",
                                severity="blocking"
                            ))
                        elif (end_date - start_date).days > 30:
                            warnings.append("Trip duration is over 30 days. Consider breaking into multiple trips.")
                    except Exception:
                        errors.append(ValidationError(
                            field="end_date",
                            message="Invalid date format for end date. Use YYYY-MM-DD.",
                            code="INVALID_DATE_FORMAT",
                            severity="blocking"
                        ))
        
        return errors, warnings
    
    def _parse_date(self, date_str: Any) -> date:
        """Parse date from various formats."""
        if isinstance(date_str, date):
            return date_str
        if isinstance(date_str, datetime):
            return date_str.date()
        if isinstance(date_str, str):
            # Try multiple formats
            for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y"]:
                try:
                    return datetime.strptime(date_str, fmt).date()
                except ValueError:
                    continue
        raise ValueError(f"Cannot parse date: {date_str}")
    
    def _is_valid_iata_code(self, code: str) -> bool:
        """
        Validates IATA airport code against known database.
        """
        if not code:
            return False
        code = code.strip().upper()
        
        # Basic format check
        if len(code) != 3 or not code.isalpha():
            return False
        
        # Check against database
        return code in self.airports_db
    
    def _validate_destination(self, dest: Dict[str, Any], index: int) -> List[ValidationError]:
        """Validates a single destination."""
        errors = []
        
        # Skip excluded destinations
        if dest.get("excluded", False):
            return errors
        
        # Get airport code
        airport_code = (
            dest.get("airport_code") or 
            dest.get("airportCode") or 
            dest.get("code") or
            self._extract_airport_code_from_name(dest.get("name", ""))
        )
        
        if not airport_code:
            errors.append(ValidationError(
                field=f"destinations[{index}].airport_code",
                message=f"Destination {index + 1} requires an airport code.",
                code="MISSING_DESTINATION_AIRPORT",
                severity="blocking"
            ))
        elif not self._is_valid_iata_code(airport_code):
            suggestions = self._suggest_airports(airport_code)
            errors.append(ValidationError(
                field=f"destinations[{index}].airport_code",
                message=f"'{airport_code}' is not a recognized airport code.",
                code="INVALID_DESTINATION_AIRPORT",
                severity="blocking",
                suggestions=suggestions
            ))
        
        return errors
    
    def _extract_airport_code_from_name(self, name: str) -> Optional[str]:
        """Extract airport code from name like 'Tokyo (NRT)'."""
        import re
        match = re.search(r'\(([A-Z]{3})\)', name.upper())
        if match:
            return match.group(1)
        # Check if name itself is a code
        name = name.strip().upper()
        if len(name) == 3 and name.isalpha() and name in self.airports_db:
            return name
        return None
    
    def _suggest_airports(self, code: str) -> List[str]:
        """Suggest similar airport codes."""
        if not code:
            return []
        
        code = code.strip().upper()
        suggestions = []
        
        # Find codes that start with the same letter(s)
        for airport in self.airports_db:
            if airport.startswith(code[:1]):
                suggestions.append(airport)
                if len(suggestions) >= 5:
                    break
        
        return suggestions
    
    def build_trip_input(self, trip_data: Dict[str, Any]) -> TripInput:
        """
        Build a validated TripInput object from raw data.
        Should only be called after validate() returns valid=True.
        """
        # Extract destinations
        destinations = []
        for dest in (trip_data.get("destinations") or []):
            if dest.get("excluded", False):
                continue
            
            airport_code = (
                dest.get("airport_code") or 
                dest.get("airportCode") or 
                dest.get("code") or
                self._extract_airport_code_from_name(dest.get("name", ""))
            )
            
            destinations.append(Destination(
                city_name=dest.get("name", airport_code or ""),
                airport_code=airport_code.upper() if airport_code else "",
                days=dest.get("days"),
                must_include=dest.get("must_include", dest.get("mustInclude", True)),
                excluded=dest.get("excluded", False),
                is_start=dest.get("is_start", dest.get("isStart", False)),
                is_end=dest.get("is_end", dest.get("isEnd", False)),
            ))
        
        # Parse dates
        start_date = None
        end_date = None
        flexible = trip_data.get("flexible_dates") or trip_data.get("flexibleDates", False)
        
        if not flexible:
            start_str = trip_data.get("start_date") or trip_data.get("startDate")
            end_str = trip_data.get("end_date") or trip_data.get("endDate")
            if start_str:
                start_date = self._parse_date(start_str)
            if end_str:
                end_date = self._parse_date(end_str)
        
        # Parse cabin class
        cabin_str = trip_data.get("cabin_class") or trip_data.get("cabinClass") or "economy"
        cabin_class = CabinClass.from_string(cabin_str)
        
        # Extract party size (ensure at least 1 adult)
        num_adults = trip_data.get("num_adults") or trip_data.get("adults") or 1
        num_adults = max(1, int(num_adults))
        num_children = trip_data.get("num_children") or trip_data.get("children") or 0
        num_children = max(0, int(num_children))
        
        # Build TripInput
        return TripInput(
            trip_id=trip_data.get("trip_id") or trip_data.get("tripId", ""),
            start_destination=(
                trip_data.get("start_destination") or 
                trip_data.get("startDestination", "")
            ).upper(),
            end_destination=(
                trip_data.get("end_destination") or 
                trip_data.get("endDestination", "")
            ).upper(),
            destinations=destinations,
            start_date=start_date,
            end_date=end_date,
            flexible_dates=flexible,
            duration_days=trip_data.get("duration_days") or trip_data.get("durationDays"),
            max_budget=trip_data.get("max_budget") or trip_data.get("maxBudget"),
            points_balances=trip_data.get("points_balances") or trip_data.get("pointsBalances", {}),
            cabin_class=cabin_class,
            include_hotels=trip_data.get("include_hotels") or trip_data.get("includeHotels", False),
            hotel_class=trip_data.get("hotel_class") or trip_data.get("hotelClass"),
            num_bags=trip_data.get("num_bags") or trip_data.get("numBags") or trip_data.get("bags", 0),
            one_way=trip_data.get("one_way") or trip_data.get("oneWay", False),
            # Party size
            num_adults=num_adults,
            num_children=num_children,
        )
