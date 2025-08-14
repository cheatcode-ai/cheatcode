'use client';

import { PricingSection } from './pricing';

// Example data for the pricing component
const examplePlans = [
  {
    name: 'Free',
    info: 'Perfect for getting started',
    price: {
      monthly: 0,
      yearly: 0,
    },
    features: [
      { text: '5 projects' },
      { text: 'Basic support' },
      { text: '1 GB storage' },
      { text: 'Community access', tooltip: 'Access to our community forums' },
    ],
    btn: {
      text: 'Get Started',
      href: '/signup?plan=free',
    },
  },
  {
    name: 'Pro',
    info: 'Best for growing teams',
    price: {
      monthly: 29,
      yearly: 290,
    },
    features: [
      { text: 'Unlimited projects' },
      { text: 'Priority support', tooltip: '24/7 email and chat support' },
      { text: '100 GB storage' },
      { text: 'Advanced analytics' },
      { text: 'Team collaboration' },
    ],
    btn: {
      text: 'Start Free Trial',
      href: '/signup?plan=pro',
    },
    highlighted: true,
  },
  {
    name: 'Enterprise',
    info: 'For large organizations',
    price: {
      monthly: 99,
      yearly: 990,
    },
    features: [
      { text: 'Everything in Pro' },
      { text: 'Dedicated support', tooltip: 'Dedicated account manager' },
      { text: 'Unlimited storage' },
      { text: 'Custom integrations' },
      { text: 'SSO & SAML' },
      { text: 'Advanced security' },
    ],
    btn: {
      text: 'Contact Sales',
      href: '/contact?plan=enterprise',
    },
  },
];

export function PricingDemo() {
  return (
    <div className="min-h-screen bg-background py-12">
      <PricingSection
        plans={examplePlans}
        heading="Choose Your Plan"
        description="Select the perfect plan for your needs. Upgrade or downgrade at any time."
        className="max-w-6xl mx-auto"
      />
    </div>
  );
}