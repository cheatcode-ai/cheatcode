"""
Constants for token-based billing system with credit abstraction.
"""

# =============================================================================
# SSE Streaming Configuration
# =============================================================================
SSE_BATCH_SIZE = 1              # Send each response immediately for smooth streaming
SSE_BATCH_TIMEOUT_MS = 50       # Max time to wait for batch (ms)

# =============================================================================
# Redis Configuration
# =============================================================================
REDIS_RESPONSE_LIST_TTL = 3600 * 24  # 24 hours

# =============================================================================
# Deployment Limits by Plan
# =============================================================================
PLAN_DEPLOYMENT_LIMITS = {
    'free': 1,
    'pro': 10,
    'premium': 25,
    'byok': 100,
}

# Token-Credit Billing Plans
PLANS = {
    'free': {
        'name': 'Free',
        'price_inr': 0,
        'price_usd': 0,
        'token_quota': 100000,      # ~20 typical conversations
        'display_credits': 20,      # User sees "20 credits/month"
        'daily_refills_max': 4,     # Maximum 4 refills per month
        'credits_per_refill': 5,    # 5 credits per daily refill
        'max_deployments': 1,
        'features': ['5 credits daily (up to 20/month)', '1 deployed website', 'Community support'],
        'description': '5 credits daily (up to 20 credits/month) - Perfect for getting started'
    },
    'pro': {
        'name': 'Pro',
        'price_inr': 149900,        # ₹1499 (in paisa)
        'price_usd': 1800,          # $18 (in cents)
        'token_quota': 750000,      # ~150 typical conversations
        'display_credits': 150,     # User sees "150 credits/month"
        'max_deployments': 10,
        'features': ['Priority Support', 'All Models', 'Advanced Features'],
        'description': '150 credits/month - Great for regular users'
    },
    'premium': {
        'name': 'Premium',
        'price_inr': 259900,        # ₹2599 (in paisa)
        'price_usd': 3000,          # $30 (in cents)
        'token_quota': 1250000,     # ~250 typical conversations
        'display_credits': 250,     # User sees "250 credits/month"
        'max_deployments': 25,
        'features': ['Priority Support', 'All Models + Beta', 'Advanced Analytics'],
        'description': '250 credits/month - Perfect for power users'
    },
    'byok': {
        'name': 'BYOK',
        'price_inr': 1299500,       # ₹12995 (in paisa) - Annual pricing
        'price_usd': 10800,         # $108 (in cents) - Annual pricing
        'token_quota': -1,          # Unlimited
        'display_credits': -1,      # "Unlimited"
        'max_deployments': 100,
        'features': ['Bring Your Own OpenRouter Key', 'Unlimited Usage', 'Real Cost Pricing', 'Dedicated Support'],
        'description': 'Bring your own OpenRouter API key - $9/month billed annually ($108/year)'
    }
}

# Token-Credit Conversion
AVERAGE_TOKENS_PER_CREDIT = 5000  # Conservative estimate: 5k tokens per credit

# Token estimation constants
TOKENS_PER_CONVERSATION_ESTIMATE = 5000  # Average tokens per conversation
MAX_TOKENS_PER_MESSAGE = 8000           # Maximum tokens for a single message

# Utility functions
def get_plan_by_id(plan_id: str) -> dict:
    """Get plan configuration by plan ID."""
    return PLANS.get(plan_id)

def get_credits_from_tokens(tokens: int) -> int:
    """Convert tokens to user-facing credits."""
    if tokens <= 0:
        return 0
    # Be conservative: only show credits if user has enough tokens for actual usage
    # Since agent runs need 5000 tokens minimum, only count full 5000-token chunks
    min_tokens_per_credit = TOKENS_PER_CONVERSATION_ESTIMATE  # 5000 tokens
    return tokens // min_tokens_per_credit

def get_tokens_from_credits(credits: int) -> int:
    """Convert user-facing credits to tokens."""
    if credits <= 0:
        return 0
    return credits * AVERAGE_TOKENS_PER_CREDIT


def get_plan_deployment_limit(plan_id: str) -> int:
    """Get the maximum number of deployments allowed for a plan."""
    plan_id = (plan_id or 'free').lower()
    return PLAN_DEPLOYMENT_LIMITS.get(plan_id, 1)

