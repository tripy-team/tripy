"""
Analytics routes — ROI dashboard data and exports.
"""
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from ..utils.jwt_auth import OrgContext, get_org_context
from ..services import analytics_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/roi")
async def get_roi_dashboard(
    period_days: int = 30,
    ctx: OrgContext = Depends(get_org_context),
):
    """Get full ROI dashboard metrics."""
    return analytics_service.get_roi_metrics(ctx.org_id, period_days)


@router.get("/roi/export")
async def export_roi_csv(
    period_days: int = 90,
    ctx: OrgContext = Depends(get_org_context),
):
    """Export ROI data as CSV."""
    csv_content = analytics_service.export_roi_csv(ctx.org_id, period_days)
    return PlainTextResponse(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=tripy-roi-report.csv"},
    )
