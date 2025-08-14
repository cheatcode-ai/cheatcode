# Region-Based Payment Methods Configuration Guide

This guide explains how to use the new region-based payment method configuration system for DodoPayments integration.

## 🌍 Overview

The system automatically detects user's geographic location and configures appropriate payment methods based on:
- **Geographic availability** (e.g., UPI only in India)
- **Transaction type** (subscriptions vs one-time payments)
- **Local preferences** (e.g., iDEAL in Netherlands)
- **Regulatory compliance** (e.g., BNPL restrictions)

## 🚀 Quick Start

### Automatic Configuration (Recommended)
```javascript
// Frontend - Uses automatic region detection
const response = await fetch('/billing/create-checkout-session', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    plan_id: 'pro',
    success_url: 'https://myapp.com/success',
    use_regional_defaults: true  // ✨ Automatic region detection
  })
});
```

### Manual Region Specification
```javascript
// Frontend - Explicit region specification
const response = await fetch('/billing/create-checkout-session', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    plan_id: 'pro',
    success_url: 'https://myapp.com/success',
    country_code: 'US',  // ✨ Explicit country
    use_regional_defaults: true
  })
});
```

### Custom Payment Methods
```javascript
// Frontend - Override with custom methods
const response = await fetch('/billing/create-checkout-session', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    plan_id: 'pro',
    success_url: 'https://myapp.com/success',
    allowed_payment_methods: ['credit', 'debit', 'apple_pay'],  // ✨ Custom methods
    use_regional_defaults: false
  })
});
```

## 📍 Regional Configurations

### 🇺🇸 United States
- **Available**: Credit, Debit, Apple Pay, Google Pay, Amazon Pay, Cash App, Afterpay, Klarna
- **Subscription-safe**: Credit, Debit, Apple Pay, Google Pay, Afterpay, Klarna
- **Notes**: BNPL enabled for subscriptions (custom override)

### 🇮🇳 India
- **Available**: Credit, Debit, UPI Collect
- **Subscription-safe**: Credit, Debit, UPI Collect
- **Notes**: Apple Pay/Google Pay not available, RuPay removed (not supported by API)

### 🇩🇪 Germany
- **Available**: Credit, Debit, Apple Pay, Google Pay, SEPA
- **Subscription-safe**: Credit, Debit, Apple Pay, Google Pay, SEPA
- **Notes**: Strong SEPA integration

### 🇳🇱 Netherlands
- **Available**: Credit, Debit, Apple Pay, Google Pay, SEPA, iDEAL
- **Subscription-safe**: Credit, Debit, Apple Pay, Google Pay, SEPA
- **Notes**: iDEAL popular for one-time payments

### 🌍 Other Regions
- **Available**: Credit, Debit, Apple Pay, Google Pay
- **Subscription-safe**: Credit, Debit, Apple Pay, Google Pay
- **Notes**: Conservative default configuration

## 📚 API Endpoints

### Get Regional Payment Methods
```bash
GET /billing/payment-methods/region/{country_code}?is_subscription=true
```

**Example:**
```bash
curl "https://api.yourapp.com/billing/payment-methods/region/US?is_subscription=true"
```

**Response:**
```json
{
  "success": true,
  "country_code": "US",
  "is_subscription": true,
  "payment_methods": ["credit", "debit", "apple_pay", "google_pay"]
}
```

### Auto-Detect User Region
```bash
GET /billing/payment-methods/detect
```

**Example:**
```bash
curl -H "CF-IPCountry: US" "https://api.yourapp.com/billing/payment-methods/detect"
```

**Response:**
```json
{
  "success": true,
  "detected_country": "US",
  "payment_methods": ["credit", "debit", "apple_pay", "google_pay"],
  "detection_headers": ["cf-ipcountry"]
}
```

### Validate Payment Methods
```bash
POST /billing/payment-methods/validate
```

**Example:**
```bash
curl -X POST "https://api.yourapp.com/billing/payment-methods/validate" \
  -H "Content-Type: application/json" \
  -d '{
    "country_code": "IN",
    "payment_methods": ["credit", "apple_pay"],
    "is_subscription": true
  }'
```

**Response:**
```json
{
  "success": true,
  "validation": {
    "valid": false,
    "supported_methods": ["credit"],
    "unsupported_methods": ["apple_pay"],
    "warnings": ["Apple Pay and Google Pay are not available in India"]
  }
}
```

### Get All Supported Regions
```bash
GET /billing/payment-methods/regions
```

### Get Payment Method Presets
```bash
GET /billing/payment-methods/presets
```

## 🎯 Frontend Integration Examples

### React Component for Payment Method Selection
```jsx
import React, { useState, useEffect } from 'react';

const PaymentMethodSelector = ({ onMethodsChange }) => {
  const [detectedRegion, setDetectedRegion] = useState(null);
  const [availableMethods, setAvailableMethods] = useState([]);
  const [selectedMethods, setSelectedMethods] = useState([]);

  useEffect(() => {
    // Auto-detect user's region
    fetch('/billing/payment-methods/detect')
      .then(res => res.json())
      .then(data => {
        setDetectedRegion(data.detected_country);
        setAvailableMethods(data.payment_methods);
        setSelectedMethods(data.payment_methods); // Default to all available
        onMethodsChange(data.payment_methods);
      });
  }, []);

  const handleMethodToggle = (method) => {
    const updated = selectedMethods.includes(method)
      ? selectedMethods.filter(m => m !== method)
      : [...selectedMethods, method];
    
    setSelectedMethods(updated);
    onMethodsChange(updated);
  };

  return (
    <div className="payment-method-selector">
      <h3>Payment Methods</h3>
      {detectedRegion && (
        <p className="region-info">
          Detected region: {detectedRegion}
        </p>
      )}
      
      <div className="methods-grid">
        {availableMethods.map(method => (
          <label key={method} className="method-option">
            <input
              type="checkbox"
              checked={selectedMethods.includes(method)}
              onChange={() => handleMethodToggle(method)}
            />
            <span className="method-name">
              {method.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};
```

### Advanced Regional Configuration
```jsx
const AdvancedPaymentSetup = () => {
  const [regions, setRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState('US');
  const [paymentMethods, setPaymentMethods] = useState([]);

  useEffect(() => {
    // Load supported regions
    fetch('/billing/payment-methods/regions')
      .then(res => res.json())
      .then(data => setRegions(data.regions));
  }, []);

  useEffect(() => {
    // Load payment methods for selected region
    if (selectedRegion) {
      fetch(`/billing/payment-methods/region/${selectedRegion}?is_subscription=true`)
        .then(res => res.json())
        .then(data => setPaymentMethods(data.payment_methods));
    }
  }, [selectedRegion]);

  return (
    <div className="advanced-payment-setup">
      <select 
        value={selectedRegion}
        onChange={(e) => setSelectedRegion(e.target.value)}
      >
        {regions.map(region => (
          <option key={region.code} value={region.code}>
            {region.name}
          </option>
        ))}
      </select>
      
      <div className="methods-preview">
        <h4>Available Payment Methods:</h4>
        <ul>
          {paymentMethods.map(method => (
            <li key={method}>{method}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};
```

## 🔧 Backend Integration

### Using in Your Service
```python
from utils.payment_methods import get_payment_methods_by_region, detect_country_from_request

# In your API endpoint
async def create_custom_checkout(request: Request, country_code: str = None):
    # Auto-detect or use provided country
    user_country = country_code or detect_country_from_request(dict(request.headers))
    
    # Get appropriate payment methods
    payment_methods = get_payment_methods_by_region(
        country_code=user_country or 'DEFAULT',
        is_subscription=True
    )
    
    # Create checkout session with regional methods
    checkout_url = await create_dodo_checkout_session(
        plan_id=plan_id,
        account_id=account_id,
        user_email=user_email,
        user_name=user_name,
        allowed_payment_methods=payment_methods
    )
```

### Custom Business Logic
```python
from utils.payment_methods import validate_payment_methods, get_payment_preset

def customize_payment_methods(user_country: str, user_preferences: list):
    # Start with regional defaults
    base_methods = get_payment_methods_by_region(user_country, is_subscription=True)
    
    # Apply user preferences
    if user_preferences:
        # Validate user preferences against regional availability
        validation = validate_payment_methods(
            methods=user_preferences,
            country_code=user_country,
            is_subscription=True
        )
        
        if validation['valid']:
            return user_preferences
        else:
            # Use only supported methods from user preferences
            return validation['supported_methods']
    
    return base_methods
```

## 🛡️ Error Handling

### Frontend Error Handling
```javascript
const createCheckout = async (planId, paymentMethods = null) => {
  try {
    const response = await fetch('/billing/create-checkout-session', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan_id: planId,
        allowed_payment_methods: paymentMethods,
        use_regional_defaults: !paymentMethods  // Use regional if no custom methods
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 400 && data.detail?.includes('payment methods')) {
        // Handle invalid payment methods
        console.warn('Invalid payment methods, falling back to regional defaults');
        return createCheckout(planId, null); // Retry with regional defaults
      }
      throw new Error(data.detail || 'Checkout creation failed');
    }

    return data.checkout_url;
  } catch (error) {
    console.error('Checkout error:', error);
    throw error;
  }
};
```

## 🧪 Testing

### Run Region Tests
```bash
cd backend
python test_region_payments.py
```

### Test Specific Region
```python
from utils.payment_methods import get_payment_methods_by_region

# Test India subscription methods
methods = get_payment_methods_by_region('IN', is_subscription=True)
print(f"India subscription methods: {methods}")
# Output: ['credit', 'debit']
```

### Validate Custom Configuration
```python
from utils.payment_methods import validate_payment_methods

validation = validate_payment_methods(
    methods=['credit', 'apple_pay', 'upi_collect'],
    country_code='IN',
    is_subscription=True
)

print(validation)
# Output: {
#   'valid': False,
#   'supported_methods': ['credit'],
#   'unsupported_methods': ['apple_pay', 'upi_collect'],
#   'warnings': ['Apple Pay and Google Pay are not available in India']
# }
```

## 📝 Best Practices

1. **Always use regional defaults** unless you have specific business requirements
2. **Test payment methods** for your target markets before launch  
3. **Handle validation errors** gracefully with fallbacks
4. **Monitor payment success rates** by region and adjust configurations
5. **Keep GDPR compliance** when detecting user location
6. **Cache regional configurations** on the frontend to reduce API calls
7. **Provide manual region selection** as a backup for auto-detection

## 🔗 Links

- [DodoPayments Documentation](https://docs.dodopayments.com/)
- [Payment Method Restrictions](https://docs.dodopayments.com/payment-methods/restrictions)
- [Regional Compliance Guide](https://docs.dodopayments.com/compliance/regional)

---

This system provides a robust, scalable approach to managing payment methods across different regions while maintaining compliance and optimizing user experience.