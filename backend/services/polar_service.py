"""
Polar.sh SDK integration service for subscription management.
"""

from typing import Dict, Optional
from polar_sdk import Polar

from utils.config import config
from utils.logger import logger


class PolarService:
    """Service for managing Polar subscriptions."""

    # Product ID mapping - these are set from config
    PRODUCT_MAPPING: Dict[str, str] = {}

    def __init__(self):
        self.access_token = config.POLAR_ACCESS_TOKEN
        self.organization_id = config.POLAR_ORGANIZATION_ID

        # Build product mapping from config
        self.PRODUCT_MAPPING = {
            'pro': config.POLAR_PRODUCT_ID_PRO,
            'premium': config.POLAR_PRODUCT_ID_PREMIUM,
            'byok': config.POLAR_PRODUCT_ID_BYOK
        }

        if not self.access_token:
            logger.warning("POLAR_ACCESS_TOKEN not configured - payment processing will be unavailable")
            self.client = None
        else:
            self.client = Polar(access_token=self.access_token)
            logger.info("Polar SDK initialized successfully")

    def is_configured(self) -> bool:
        """Check if Polar is properly configured."""
        return self.client is not None

    def get_product_id(self, plan_id: str) -> Optional[str]:
        """Get Polar product ID for a plan."""
        return self.PRODUCT_MAPPING.get(plan_id)

    def get_plan_from_product_id(self, product_id: str) -> str:
        """Get internal plan name from Polar product ID."""
        for plan, pid in self.PRODUCT_MAPPING.items():
            if pid == product_id:
                return plan
        return 'free'

    def create_checkout_session(
        self,
        plan_id: str,
        customer_email: str,
        account_id: str,
        success_url: str,
        cancel_url: Optional[str] = None
    ) -> str:
        """Create Polar checkout session for subscription."""
        if not self.client:
            raise Exception("Polar SDK not configured")

        product_id = self.get_product_id(plan_id)
        if not product_id:
            raise ValueError(f"Unknown plan: {plan_id}. Available plans: {list(self.PRODUCT_MAPPING.keys())}")

        try:
            checkout = self.client.checkouts.create(request={
                "products": [product_id],
                "customer_email": customer_email,
                "customer_external_id": account_id,
                "success_url": success_url,
                "metadata": {
                    "account_id": account_id,
                    "plan_id": plan_id,
                    "source": "cheatcode"
                }
            })

            logger.info(f"Created Polar checkout for {customer_email}, plan {plan_id}")
            return checkout.url

        except Exception as e:
            logger.error(f"Error creating Polar checkout: {str(e)}")
            raise Exception(f"Failed to create checkout session: {str(e)}")

    def get_subscription(self, subscription_id: str):
        """Get subscription details."""
        if not self.client:
            raise Exception("Polar SDK not configured")
        return self.client.subscriptions.get(id=subscription_id)

    def cancel_subscription(self, subscription_id: str, at_period_end: bool = True):
        """Cancel a subscription."""
        if not self.client:
            raise Exception("Polar SDK not configured")
        return self.client.subscriptions.update(
            id=subscription_id,
            body={"cancel_at_period_end": at_period_end}
        )

    def get_customer_by_external_id(self, account_id: str):
        """Get Polar customer by external ID (our account_id)."""
        if not self.client:
            raise Exception("Polar SDK not configured")
        try:
            return self.client.customers.get_external(external_id=account_id)
        except Exception:
            return None


# Initialize service instance
polar_service = PolarService()


async def create_polar_checkout_session(
    plan_id: str,
    account_id: str,
    user_email: str,
    success_url: Optional[str] = None,
) -> str:
    """
    Create Polar checkout session.

    Args:
        plan_id: The plan to subscribe to ('pro', 'premium', 'byok')
        account_id: The user's account ID
        user_email: The user's email address
        success_url: URL to redirect after successful payment

    Returns:
        The checkout URL to redirect the user to
    """
    from utils.constants import get_plan_by_id

    # Check if Polar is configured
    if not polar_service.is_configured():
        logger.error("Polar SDK not configured - cannot create checkout session")
        raise Exception("Payment processing is currently unavailable. Please contact support to upgrade your plan.")

    # Validate plan
    plan_config = get_plan_by_id(plan_id)
    if not plan_config:
        raise ValueError(f"Invalid plan_id: {plan_id}")

    try:
        checkout_url = polar_service.create_checkout_session(
            plan_id=plan_id,
            customer_email=user_email,
            account_id=account_id,
            success_url=success_url or "https://trycheatcode.com/dashboard?upgrade=success"
        )

        logger.info(f"Created Polar checkout for user {account_id}, plan {plan_id}")
        return checkout_url

    except Exception as e:
        logger.error(f"Error creating Polar checkout: {str(e)}")
        if "not configured" in str(e).lower():
            raise Exception("Payment processing is currently unavailable. Please contact support to upgrade your plan.")
        raise Exception(f"Failed to create checkout session: {str(e)}")
