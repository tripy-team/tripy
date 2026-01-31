"""
Centralized datetime parsing.

USE THIS EVERYWHERE for datetime parsing in:
- adapter_v3.py
- contract_validation.py
- fingerprinting.py
- merge_gate.py

This ensures consistent handling of:
- "Z" suffix (UTC indicator) across all Python versions
- Timezone awareness requirements
- Parse error handling
"""

from datetime import datetime, timezone, date


class DatetimeParseError(ValueError):
    """
    Raised when datetime string cannot be parsed.
    
    This is a CONTRACT violation - the input is malformed.
    """
    pass


class DatetimeNaiveError(ValueError):
    """
    Raised when datetime is missing timezone info.
    
    All datetimes in the optimization pipeline MUST be timezone-aware.
    Naive datetimes are rejected to prevent silent timezone bugs.
    """
    pass


def parse_dt(dt_str: str) -> datetime:
    """
    Parse ISO8601 datetime string, handling 'Z' suffix for all Python versions.
    
    CRITICAL: Use this function for ALL datetime parsing in the optimization
    pipeline. Do NOT use datetime.fromisoformat() directly.
    
    Handles:
    - ISO8601 with timezone: "2024-06-01T10:00:00+00:00"
    - ISO8601 with Z suffix: "2024-06-01T10:00:00Z"
    - Various timezone offsets: "2024-06-01T10:00:00-07:00"
    
    Args:
        dt_str: ISO8601 datetime string
    
    Returns:
        Timezone-aware datetime object
    
    Raises:
        DatetimeParseError: if string cannot be parsed
        DatetimeNaiveError: if datetime has no timezone
    
    Example:
        >>> parse_dt("2024-06-01T10:00:00Z")
        datetime(2024, 6, 1, 10, 0, 0, tzinfo=timezone.utc)
        
        >>> parse_dt("2024-06-01T10:00:00")  # No timezone
        DatetimeNaiveError: Datetime must be timezone-aware
    """
    try:
        # Handle "Z" suffix (UTC indicator)
        # Python < 3.11 doesn't handle "Z" in fromisoformat()
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        
        dt = datetime.fromisoformat(dt_str)
    except ValueError as e:
        raise DatetimeParseError(f"Cannot parse datetime: {dt_str}") from e
    
    if dt.tzinfo is None:
        raise DatetimeNaiveError(f"Datetime must be timezone-aware: {dt_str}")
    
    return dt


def parse_dt_or_none(dt_str: str | None) -> datetime | None:
    """
    Parse datetime, returning None if input is None.
    
    Useful for optional datetime fields.
    
    Args:
        dt_str: ISO8601 datetime string or None
    
    Returns:
        Timezone-aware datetime or None
    
    Raises:
        DatetimeParseError: if string cannot be parsed
        DatetimeNaiveError: if datetime has no timezone
    """
    if dt_str is None:
        return None
    return parse_dt(dt_str)


def parse_date(date_str: str) -> date:
    """
    Parse ISO8601 date string.
    
    Args:
        date_str: Date string in YYYY-MM-DD format
    
    Returns:
        date object
    
    Raises:
        DatetimeParseError: if string cannot be parsed
    """
    try:
        return date.fromisoformat(date_str)
    except ValueError as e:
        raise DatetimeParseError(f"Cannot parse date: {date_str}") from e


def parse_date_or_none(date_str: str | None) -> date | None:
    """
    Parse date, returning None if input is None.
    
    Args:
        date_str: Date string in YYYY-MM-DD format or None
    
    Returns:
        date object or None
    
    Raises:
        DatetimeParseError: if string cannot be parsed
    """
    if date_str is None:
        return None
    return parse_date(date_str)


def datetime_to_utc(dt: datetime) -> datetime:
    """
    Convert a timezone-aware datetime to UTC.
    
    Args:
        dt: Timezone-aware datetime
    
    Returns:
        Datetime in UTC
    
    Raises:
        ValueError: if datetime is naive
    """
    if dt.tzinfo is None:
        raise ValueError("Cannot convert naive datetime to UTC")
    return dt.astimezone(timezone.utc)


def floor_to_minutes(dt: datetime, minutes: int = 5) -> datetime:
    """
    Floor datetime to the nearest N minutes.
    
    Used for fingerprinting to reduce spurious differences.
    Uses floor (not round) to be deterministic and reduce collisions.
    
    Args:
        dt: Timezone-aware datetime
        minutes: Number of minutes to floor to (default 5)
    
    Returns:
        Floored datetime
    
    Example:
        >>> floor_to_minutes(datetime(2024, 6, 1, 10, 7, 30), 5)
        datetime(2024, 6, 1, 10, 5, 0)
    """
    # Floor to minutes
    floored_minute = (dt.minute // minutes) * minutes
    return dt.replace(minute=floored_minute, second=0, microsecond=0)
