"""
Itinerary Generation v2 Pipeline

This module implements the v2 itinerary generation pipeline which:
- Generates date-correct legs and itinerary options
- Uses SERP for cash prices and AwardTool for award quotes
- Optimizes payment/transfers using ILP
- Provides high-signal console logging for debugging

Main entrypoint: pipeline.generate_itinerary_v2(trip_id)
"""

from .pipeline import generate_itinerary_v2

__all__ = ["generate_itinerary_v2"]
