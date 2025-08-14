"""
DodoPayments SDK integration service for subscription management.
"""

import os
from typing import Dict, Optional
from datetime import datetime

from dodopayments import DodoPayments
import dodopayments

from utils.config import config
from utils.logger import logger


class DodoPaymentsService:
    """Service for managing DodoPayments using official SDK."""
    
    def __init__(self):
        self.api_key = config.DODO_PAYMENTS_API_KEY
        if not self.api_key:
            logger.warning("DODO_PAYMENTS_API_KEY not configured - payment processing will be unavailable")
            self.client = None
        else:
            # Initialize SDK - it handles base URL and authentication automatically
            self.client = DodoPayments(
                bearer_token=self.api_key,
                environment="test_mode",  # TODO: Change to "live_mode" for production
            )
            logger.info(f"DodoPayments SDK initialized successfully with API key: {'*' * 20}{self.api_key[-4:] if len(self.api_key) > 4 else '****'}")
    
    def is_configured(self) -> bool:
        """Check if DodoPayments is properly configured."""
        return self.client is not None
    
    async def test_connection(self) -> Dict:
        """Test the DodoPayments SDK connection."""
        if not self.client:
            return {"success": False, "error": "DodoPayments SDK not configured"}
            
        try:
            # Test SDK connection by attempting to list payments (this should work even if empty)
            self.client.payments.list()
            return {"success": True, "message": "DodoPayments SDK connection successful"}
            
        except dodopayments.APIConnectionError as e:
            return {"success": False, "error": f"Connection error: {str(e)}"}
        except dodopayments.APIStatusError as e:
            if e.status_code == 401:
                return {"success": False, "error": "Invalid API key"}
            return {"success": False, "error": f"API error: {e.status_code}"}
        except Exception as e:
            return {"success": False, "error": f"Unexpected error: {str(e)}"}
    
    def create_customer(self, email: str, name: str) -> str:
        """Create a new customer in DodoPayments and return the customer_id."""
        if not self.client:
            raise Exception("DodoPayments SDK not configured")
        
        try:
            customer = self.client.customers.create(
                email=email,
                name=name
            )
            logger.info(f"Created DodoPayments customer: {customer.customer_id}")
            return customer.customer_id
        except dodopayments.APIStatusError as e:
            logger.error(f"DodoPayments API error creating customer: {e.status_code} - {e.response.text}")
            raise Exception(f"Payment service error: {e.status_code}")
        except Exception as e:
            logger.error(f"Error creating customer: {str(e)}")
            raise Exception(f"Failed to create customer: {str(e)}")


    
    def create_subscription_checkout(self, 
                                   plan_id: str, 
                                   customer_email: str, 
                                   customer_name: str, 
                                   account_id: str,
                                   return_url: Optional[str] = None,
                                   allowed_payment_methods: Optional[list] = None) -> str:
        """Create subscription checkout using DodoPayments SDK."""
        if not self.client:
            raise Exception("DodoPayments SDK not configured")
        
        # Product mapping for plans
        product_mapping = {
            'pro': 'pdt_1Jnk8U6d33BpgIHvLZRf4',        # Pro: $25/month
            'premium': 'pdt_GAjFoFJyPVseIT8MrbLFL',     # Premium: $50/month
            'byok': 'pdt_MdtvInruKkrwu5AjzP0ah'         # BYOK: $250/year
        }
        
        if plan_id not in product_mapping:
            raise ValueError(f"Unknown plan: {plan_id}")
        
        product_id = product_mapping[plan_id]
        
        try:
            # Prepare subscription parameters
            subscription_params = {
                "billing": {
                    "city": "Mumbai",
                    "country": "IN", 
                    "state": "Maharashtra",
                    "street": "123 Main St",
                    "zipcode": "400001",
                },
                "customer": {
                    "email": customer_email,
                    "name": customer_name,
                },
                "product_id": product_id,
                "quantity": 1,
                "payment_link": True,
                "return_url": return_url or "https://your-app.com/success",
                "metadata": {"account_id": account_id}
            }
            
            # Add allowed payment methods if specified
            if allowed_payment_methods:
                subscription_params["allowed_payment_method_types"] = allowed_payment_methods
            
            # Create subscription using SDK
            subscription = self.client.subscriptions.create(**subscription_params)
            
            logger.info(f"Created subscription checkout for {customer_email}, plan {plan_id}")
            return subscription.payment_link
            
        except dodopayments.APIStatusError as e:
            logger.error(f"DodoPayments API error: {e.status_code} - {e.response.text}")
            raise Exception(f"Payment service error: {e.status_code}")
        except Exception as e:
            logger.error(f"Error creating subscription: {str(e)}")
            raise Exception(f"Failed to create subscription: {str(e)}")


# Simplified function to maintain compatibility with existing code
async def create_dodo_checkout_session(
    plan_id: str,
    account_id: str, 
    user_email: str,
    user_name: str,
    success_url: Optional[str] = None,
    cancel_url: Optional[str] = None,
    allowed_payment_methods: Optional[list] = None
) -> str:
    """Create DodoPayments checkout session using SDK."""
    from utils.constants import get_plan_by_id
    
    # Check if DodoPayments is configured
    if not dodo_service.is_configured():
        logger.error("DodoPayments SDK not configured - cannot create checkout session")
        raise Exception("Payment processing is currently unavailable. Please contact support to upgrade your plan.")
    
    plan_config = get_plan_by_id(plan_id)
    if not plan_config:
        raise ValueError(f"Invalid plan_id: {plan_id}")
    
    try:
        # Use simplified SDK-based method
        checkout_url = dodo_service.create_subscription_checkout(
            plan_id=plan_id,
            customer_email=user_email,
            customer_name=user_name,
            account_id=account_id,
            return_url=success_url,
            allowed_payment_methods=allowed_payment_methods
        )
        
        logger.info(f"Created DodoPayments checkout for user {account_id}, plan {plan_id}")
        return checkout_url
        
    except Exception as e:
        logger.error(f"Error creating DodoPayments checkout: {str(e)}")
        if "not configured" in str(e) or "SDK" in str(e):
            raise Exception("Payment processing is currently unavailable. Please contact support to upgrade your plan.")
        raise Exception(f"Failed to create checkout session: {str(e)}")


# Initialize DodoPayments service instance
dodo_service = DodoPaymentsService()