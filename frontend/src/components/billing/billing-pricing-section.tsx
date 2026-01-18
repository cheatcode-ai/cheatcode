'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useBilling } from '@/contexts/BillingContext';
import { usePolarCheckout } from '@/hooks/use-polar-checkout';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';

// Minimal Plans Data
const PLANS = [
    {
        id: 'free',
        name: 'Free',
        price: 0,
        desc: 'Essentials for hobbyists and side projects.',
        features: ['20 credits/month', '1 active deployment', 'Community support']
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 18,
        desc: 'For builders shipping production apps.',
        features: ['150 credits/month', '10 active deployments', 'Custom domains', 'Code export'],
        popular: true
    },
    {
        id: 'premium',
        name: 'Premium',
        price: 30,
        desc: 'Power and scale for professional teams.',
        features: ['250 credits/month', '25 active deployments', 'Priority support', 'Early access features']
    },
    {
        id: 'byok',
        name: 'BYOK',
        price: 9,
        desc: 'Bring your own keys for unlimited usage.',
        features: ['Unlimited AI usage', 'Direct provider billing', '100 active deployments', 'Zero markup']
    }
];

export function BillingPricingSection({ insideDialog, ...props }: any) {
	const { planName } = useBilling();
    const { isSignedIn } = useAuth();
    const { openCheckout } = usePolarCheckout({});

    const handleUpgrade = (planId: string) => {
        if (!isSignedIn) return toast.error('Sign in required');
        openCheckout({ planId, successUrl: window.location.href, cancelUrl: window.location.href });
    };

	return (
		<div className={cn("w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", props.className)}>
            {PLANS.map((plan) => {
                const isCurrent = planName?.toLowerCase() === plan.id;
                const isPopular = plan.popular;

                return (
                    <div 
                        key={plan.id}
                        className={cn(
                            "relative flex flex-col p-8 rounded-2xl transition-all duration-300",
                            "bg-[#111] border shadow-xl",
                            isPopular 
                                ? "border-zinc-700 bg-[#141414] ring-1 ring-white/5" 
                                : "border-zinc-800 hover:border-zinc-700"
                        )}
                    >
                        {/* Header */}
                        <div className="mb-6">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="text-lg font-medium text-white">{plan.name}</h3>
                                {isPopular && (
                                    <span className="bg-white text-black text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-1 rounded-md">
                                        Popular
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-zinc-500 leading-relaxed min-h-[40px]">
                                {plan.desc}
                            </p>
                        </div>

                        {/* Price */}
                        <div className="mb-8">
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-mono tracking-tighter text-white">
                                    {plan.price === 0 ? '$0' : `$${plan.price}`}
                                </span>
                                <span className="text-sm font-mono text-zinc-500">/mo</span>
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="h-px w-full bg-zinc-800/50 mb-8" />

                        {/* Features */}
                        <div className="flex-1 space-y-4 mb-8">
                            {plan.features.map(f => (
                                <div key={f} className="flex gap-3 items-start">
                                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-zinc-700 shrink-0" />
                                    <span className="text-xs text-zinc-400 font-mono leading-tight uppercase tracking-wide">{f}</span>
                                </div>
                            ))}
                        </div>

                        {/* Action */}
                        <Button
                            onClick={() => handleUpgrade(plan.id)}
                            disabled={isCurrent}
                            className={cn(
                                "w-full rounded-lg h-10 text-xs font-mono font-medium tracking-wide uppercase transition-all duration-300",
                                isPopular 
                                    ? "bg-white text-black hover:bg-zinc-200 border border-transparent" 
                                    : "bg-transparent text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-white",
                                isCurrent && "opacity-50 cursor-default hover:bg-transparent hover:text-zinc-500"
                            )}
                        >
                            {isCurrent ? 'Current Plan' : 'Get Started'}
                        </Button>
                    </div>
                )
            })}
		</div>
	);
}
