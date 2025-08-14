from fastapi import APIRouter
from utils.logger import logger
from .flags import list_flags, is_enabled, get_flag_details

router = APIRouter()


@router.get("/feature-flags")
async def get_feature_flags():
    try:
        flags = await list_flags()
        return {"flags": flags}
    except Exception as e:
        logger.error(f"Error fetching feature flags: {str(e)}")
        return {"flags": {}}

@router.get("/feature-flags/{flag_name}")
async def get_feature_flag(flag_name: str):
    try:
        enabled = await is_enabled(flag_name)
        details = await get_flag_details(flag_name)
        return {
            "flag_name": flag_name,
            "enabled": enabled,
            "details": details
        }
    except Exception as e:
        logger.error(f"Error fetching feature flag {flag_name}: {str(e)}")
        return {
            "flag_name": flag_name,
            "enabled": False,
            "details": None
        } 