"""
API Routes for Tripy Backend
"""

from .optimize import router as optimize_router
from .solo import router as solo_router

__all__ = ["optimize_router", "solo_router"]
