"""
Payment method configuration based on geographic regions and other constraints.
"""

from typing import List, Optional, Dict, Set
from enum import Enum

class PaymentMethodType(Enum):
    """Available payment method types for checkout"""
    CREDIT = "credit"
    DEBIT = "debit"
    APPLE_PAY = "apple_pay"
    GOOGLE_PAY = "google_pay"
    AMAZON_PAY = "amazon_pay"
    CASH_APP = "cashapp"  # Fixed: API expects 'cashapp' not 'cash_app'
    AFTERPAY = "afterpay_clearpay"  # Fixed: API expects 'afterpay_clearpay' not 'afterpay'
    KLARNA = "klarna"
    UPI_COLLECT = "upi_collect"
    RUPAY = "rupay"
    SEPA = "sepa"
    IDEAL = "ideal"
    BANCONTACT = "bancontact_card"  # Fixed: API expects 'bancontact_card' not 'bancontact'
    EPS = "eps"
    P24 = "przelewy24"  # Fixed: API expects 'przelewy24' not 'p24'

class RegionCode(Enum):
    """Supported region codes"""
    INDIA = "IN"
    UNITED_STATES = "US"
    GERMANY = "DE"
    FRANCE = "FR"
    NETHERLANDS = "NL"
    BELGIUM = "BE"
    AUSTRIA = "AT"
    POLAND = "PL"
    UNITED_KINGDOM = "GB"
    CANADA = "CA"
    AUSTRALIA = "AU"
    DEFAULT = "DEFAULT"

# Payment methods not available for subscriptions
# NOTE: Some payment methods may not support recurring billing
SUBSCRIPTION_EXCLUDED_METHODS: Set[str] = {
    PaymentMethodType.AMAZON_PAY.value,
    PaymentMethodType.CASH_APP.value,
    PaymentMethodType.RUPAY.value,
    PaymentMethodType.BANCONTACT.value,
    PaymentMethodType.EPS.value,
    PaymentMethodType.IDEAL.value,
    PaymentMethodType.P24.value,
}

# Default payment methods by region
REGION_PAYMENT_METHODS: Dict[str, List[str]] = {
    # India - local methods + cards
    RegionCode.INDIA.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.UPI_COLLECT.value,
    ],
    
    # United States - cards + digital wallets + BNPL
    RegionCode.UNITED_STATES.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.APPLE_PAY.value,
        PaymentMethodType.GOOGLE_PAY.value,
        PaymentMethodType.AMAZON_PAY.value,
        PaymentMethodType.CASH_APP.value,
        PaymentMethodType.AFTERPAY.value,
        PaymentMethodType.KLARNA.value,
    ],
    
    # Germany - cards + digital wallets + SEPA
    RegionCode.GERMANY.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.APPLE_PAY.value,
        PaymentMethodType.GOOGLE_PAY.value,
        PaymentMethodType.SEPA.value,
    ],
    
    # France - cards + digital wallets + SEPA
    RegionCode.FRANCE.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.APPLE_PAY.value,
        PaymentMethodType.GOOGLE_PAY.value,
        PaymentMethodType.SEPA.value,
    ],
    
    # Netherlands - cards + digital wallets + SEPA + iDEAL
    RegionCode.NETHERLANDS.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.APPLE_PAY.value,
        PaymentMethodType.GOOGLE_PAY.value,
        PaymentMethodType.SEPA.value,
        PaymentMethodType.IDEAL.value,
    ],
    
    # Belgium - cards + digital wallets + SEPA + Bancontact
    RegionCode.BELGIUM.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.APPLE_PAY.value,
        PaymentMethodType.GOOGLE_PAY.value,
        PaymentMethodType.SEPA.value,
        PaymentMethodType.BANCONTACT.value,
    ],
    
    # Austria - cards + digital wallets + SEPA + EPS
    RegionCode.AUSTRIA.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.APPLE_PAY.value,
        PaymentMethodType.GOOGLE_PAY.value,
        PaymentMethodType.SEPA.value,
        PaymentMethodType.EPS.value,
    ],
    
    # Poland - cards + digital wallets + SEPA + P24
    RegionCode.POLAND.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.APPLE_PAY.value,
        PaymentMethodType.GOOGLE_PAY.value,
        PaymentMethodType.SEPA.value,
        PaymentMethodType.P24.value,
    ],
    
    # Default for other regions - cards + digital wallets
    RegionCode.DEFAULT.value: [
        PaymentMethodType.CREDIT.value,
        PaymentMethodType.DEBIT.value,
        PaymentMethodType.APPLE_PAY.value,
        PaymentMethodType.GOOGLE_PAY.value,
    ],
}

def get_payment_methods_by_region(
    country_code: str, 
    is_subscription: bool = False,
    exclude_methods: Optional[List[str]] = None
) -> List[str]:
    """
    Get appropriate payment methods based on user's region and transaction type.
    
    Args:
        country_code: ISO 3166-1 alpha-2 country code (e.g., 'US', 'IN', 'DE')
        is_subscription: Whether this is for a subscription (excludes certain methods)
        exclude_methods: Additional methods to exclude
        
    Returns:
        List of payment method strings for checkout
    """
    # Normalize country code
    country_code = country_code.upper() if country_code else RegionCode.DEFAULT.value
    
    # Get base methods for region
    base_methods = REGION_PAYMENT_METHODS.get(country_code, REGION_PAYMENT_METHODS[RegionCode.DEFAULT.value])
    
    # Filter out subscription-incompatible methods if needed
    if is_subscription:
        base_methods = [method for method in base_methods if method not in SUBSCRIPTION_EXCLUDED_METHODS]
    
    # Filter out explicitly excluded methods
    if exclude_methods:
        exclude_set = set(exclude_methods)
        base_methods = [method for method in base_methods if method not in exclude_set]
    
    return base_methods

def get_supported_regions() -> List[Dict[str, str]]:
    """Get list of supported regions with their configurations."""
    return [
        {"code": region.value, "name": region.name.replace("_", " ").title()}
        for region in RegionCode
        if region != RegionCode.DEFAULT
    ]

def get_all_payment_methods() -> List[Dict[str, str]]:
    """Get all available payment methods with descriptions."""
    return [
        {"code": method.value, "name": method.name.replace("_", " ").title()}
        for method in PaymentMethodType
    ]

def validate_payment_methods(
    methods: List[str], 
    country_code: str, 
    is_subscription: bool = False
) -> Dict[str, any]:
    """
    Validate if the given payment methods are supported for the region and transaction type.
    
    Returns:
        Dict with 'valid' (bool), 'supported_methods' (list), 'unsupported_methods' (list), 'warnings' (list)
    """
    available_methods = get_payment_methods_by_region(country_code, is_subscription)
    available_set = set(available_methods)
    provided_set = set(methods)
    
    supported = list(provided_set.intersection(available_set))
    unsupported = list(provided_set - available_set)
    warnings = []
    
    # Add specific warnings
    excluded_methods_in_request = [method for method in methods if method in SUBSCRIPTION_EXCLUDED_METHODS]
    if is_subscription and excluded_methods_in_request:
        warnings.append(f"These payment methods are not available for subscriptions: {', '.join(excluded_methods_in_request)}")
    
    if country_code == RegionCode.INDIA.value and any(method in [PaymentMethodType.APPLE_PAY.value, PaymentMethodType.GOOGLE_PAY.value] for method in methods):
        warnings.append("Apple Pay and Google Pay are not available in India")
    
    return {
        "valid": len(supported) > 0 and len(unsupported) == 0,
        "supported_methods": supported,
        "unsupported_methods": unsupported,
        "warnings": warnings
    }

def detect_country_from_request(request_headers: Dict[str, str]) -> Optional[str]:
    """
    Attempt to detect country from request headers.
    This is a basic implementation - you might want to use a proper IP geolocation service.
    
    Args:
        request_headers: HTTP request headers dict
        
    Returns:
        ISO country code or None if not detectable
    """
    # Check for CloudFlare country header
    if 'cf-ipcountry' in request_headers:
        return request_headers['cf-ipcountry'].upper()
    
    # Check for other common geolocation headers
    geo_headers = [
        'x-country-code',
        'x-forwarded-country', 
        'cloudfront-viewer-country',
        'x-vercel-ip-country'
    ]
    
    for header in geo_headers:
        if header in request_headers:
            return request_headers[header].upper()
    
    return None

# Preset configurations for common use cases
PAYMENT_PRESETS = {
    "cards_only": [PaymentMethodType.CREDIT.value, PaymentMethodType.DEBIT.value],
    "digital_wallets": [PaymentMethodType.CREDIT.value, PaymentMethodType.DEBIT.value, PaymentMethodType.APPLE_PAY.value, PaymentMethodType.GOOGLE_PAY.value],
    "subscription_safe": [PaymentMethodType.CREDIT.value, PaymentMethodType.DEBIT.value, PaymentMethodType.APPLE_PAY.value, PaymentMethodType.GOOGLE_PAY.value, PaymentMethodType.SEPA.value],
    "bnpl_enabled": [PaymentMethodType.CREDIT.value, PaymentMethodType.DEBIT.value, PaymentMethodType.APPLE_PAY.value, PaymentMethodType.GOOGLE_PAY.value, PaymentMethodType.AFTERPAY.value, PaymentMethodType.KLARNA.value],
}

def get_payment_preset(preset_name: str) -> List[str]:
    """Get a predefined payment method configuration."""
    return PAYMENT_PRESETS.get(preset_name, PAYMENT_PRESETS["cards_only"])