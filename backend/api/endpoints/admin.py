from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Dict, Any
from backend.core.database import get_db
from backend.api.endpoints.auth import get_current_admin
from backend.models.database.user import User
from backend.services.db_service import AnalyticsService, get_analytics_service

router = APIRouter()

@router.get("/admin/analytics")
def get_admin_analytics(
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    current_admin: User = Depends(get_current_admin)
) -> Dict[str, Any]:
    """
    Retrieves system operations analytics for the Admin Panel charts.
    Authorized for admin users only.
    """
    return analytics_service.get_dashboard_summary()
