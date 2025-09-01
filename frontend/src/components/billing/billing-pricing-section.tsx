'use client';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CheckCircleIcon, StarIcon, Zap, ArrowRight } from 'lucide-react';
import { motion, Transition, Easing } from 'framer-motion';
import { usePlansQuery } from '@/hooks/react-query/billing/use-plans';
import { useBilling } from '@/contexts/BillingContext';
import { createDodoCheckoutSession, InsufficientCreditsError } from '@/lib/api';
import { useDodoCheckout } from '@/hooks/use-dodo-checkout';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { PlanDetails } from '@/lib/api';
import { LocalizedPrice } from 'react-currency-localizer';

interface RawPlan {
	name: string;
	info: string;
	price: number | { monthly: number };
	features: {
		text: string;
		tooltip?: string;
	}[];
	credits: number;
	planId: string;
	highlighted?: boolean;
}

interface BillingPlan extends RawPlan {
	btn: {
		text: string;
		href?: string;
		onClick?: () => void;
	};
	isCurrentPlan?: boolean;
	isUpgrading?: boolean;
}

interface BillingPricingSectionProps extends React.ComponentProps<'div'> {
	returnUrl?: string;
	showTitleAndTabs?: boolean;
	hideFree?: boolean;
	insideDialog?: boolean;
	heading?: string;
	description?: string;
}

export function BillingPricingSection({
	returnUrl = typeof window !== 'undefined' ? window.location.href : '/',
	showTitleAndTabs = true,
	hideFree = false,
	insideDialog = false,
	heading,
	description,
	...props
}: BillingPricingSectionProps) {

	const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null);
	
	const { getToken, isSignedIn } = useAuth();
	const { planName } = useBilling();
	const plansQuery = usePlansQuery();
	
	// Initialize DodoPayments checkout
	const { openCheckout, isLoading: checkoutLoading } = useDodoCheckout({
		onError: (error) => {
			console.error('Checkout error:', error);
			toast.error(`Payment failed: ${error}`);
			setUpgradingPlan(null);
		}
	});

	const handleUpgrade = async (planId: string) => {
		if (!isSignedIn) {
			toast.error('Please sign in to upgrade your plan');
			return;
		}

		try {
			setUpgradingPlan(planId);
			
			// This will redirect to DodoPayments checkout page
			await openCheckout({
				planId,
				successUrl: `${window.location.origin}/dashboard?upgrade=success`,
				cancelUrl: `${window.location.origin}/dashboard?upgrade=cancelled`,
			});
			
		} catch (error) {
			if (error instanceof InsufficientCreditsError) {
				toast.error('Insufficient credits to perform this action');
			} else {
				console.error('Error opening checkout:', error);
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				
				if (errorMessage.includes('Payment processing is currently unavailable')) {
					toast.error(errorMessage);
				} else {
					toast.error('Failed to start upgrade process. Please try again.');
				}
			}
			setUpgradingPlan(null);
		}
	};

	// Static pricing data with USD as base currency for automatic localization
	const getStaticPricingPlans = (): BillingPlan[] => {
		const currentPlan = planName?.toLowerCase();
		
		const plans: RawPlan[] = [
			{
				name: 'Free',
				info: 'Perfect for getting started',
				price: 0,
				features: [
					{ text: '5 credits/month', tooltip: 'Monthly credit allocation - use anytime' },
					{ text: '1 deployed website', tooltip: 'Host one website for free' },
					{ text: 'Community support', tooltip: 'Access to community forums and documentation' },
				],
				credits: 5,
				planId: 'free'
			},
			{
				name: 'Pro',
				info: 'Best for growing developers',
				price: 18, // USD price - one-time purchase
				features: [
					{ text: 'Everything in Free' },
					{ text: '150 credits included', tooltip: 'One-time credit purchase - credits never expire' },
					{ text: '10 deployed websites', tooltip: 'Host up to 10 websites' },
					{ text: 'Custom domains', tooltip: 'Use your own domain names' },
					{ text: 'Codebase download', tooltip: 'Download your generated code' },
				],
				credits: 150,
				planId: 'pro',
				highlighted: true
			},
			{
				name: 'Premium',
				info: 'For professional developers',
				price: 30, // USD price - one-time purchase
				features: [
					{ text: 'Everything in Pro' },
					{ text: '250 credits included', tooltip: 'One-time credit purchase - credits never expire' },
					{ text: '25 deployed websites', tooltip: 'Host up to 25 websites' },
					{ text: 'Priority support', tooltip: '24/7 email and chat support' },
				],
				credits: 250,
				planId: 'premium'
			},
			{
				name: 'Bring Your Own Key (BYOK)',
				info: 'Ultimate flexibility',
				price: { monthly: 9 }, // USD price - monthly subscription only
				features: [
					{ text: 'API cost paid directly to LLM provider', tooltip: 'Pay OpenAI/Anthropic directly, no markup' },
					{ text: '100 deployed websites', tooltip: 'Host up to 100 websites' },
					{ text: 'Custom domains', tooltip: 'Use your own domain names' },
					{ text: 'Codebase download', tooltip: 'Download your generated code' },
					{ text: 'Priority support', tooltip: '24/7 email and chat support' },
				],
				credits: -1, // Unlimited since they pay directly
				planId: 'byok'
			}
		];
		
		return plans
			.filter(plan => !hideFree || plan.planId !== 'free')
			.map((plan) => {
				const isCurrentPlan = isSignedIn && currentPlan === plan.planId;
				const isUpgrading = upgradingPlan === plan.planId || checkoutLoading;
				const isPopular = plan.highlighted;
				
				const getButtonText = () => {
					if (isCurrentPlan) return 'Current Plan';
					if (isUpgrading) return 'Processing...';
					if (typeof plan.price === 'number' && plan.price === 0) return 'Get Started';
					if (plan.planId === 'byok') return 'Subscribe';
					return 'Buy Credits';
				};

				return {
					name: plan.name,
					info: plan.info,
					price: plan.price,
					features: plan.features,
					btn: {
						text: getButtonText(),
						onClick: () => handleUpgrade(plan.planId),
					},
					highlighted: isPopular,
					isCurrentPlan,
					isUpgrading,
					credits: plan.credits,
					planId: plan.planId,
				};
			});
	};

	// Use static pricing data with automatic currency localization
	const plans = getStaticPricingPlans();

	return (
		<div
			className={cn(
				'flex w-full flex-col items-center justify-center space-y-6 p-6',
				props.className,
			)}
			{...props}
		>
			{(showTitleAndTabs || heading) && (
				<div className="mx-auto max-w-xl space-y-2">
					<h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl lg:text-4xl">
						{heading || 'Choose Your Plan'}
					</h2>
					{description && (
						<p className="text-muted-foreground text-center text-sm md:text-base">
							{description}
						</p>
					)}
				</div>
			)}
			
            {/* Plans grid: for popup, include Free + Pro + Premium + BYOK in one grid */}
            {insideDialog ? (
                <>
                    {/* Non-BYOK plans in a responsive grid */}
                    <div className={cn(
                        "mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 md:gap-6 md:grid-cols-3"
                    )}>
                        {plans.filter(plan => !plan.name.includes('BYOK')).map((plan) => (
                            <BillingPricingCard 
                                plan={plan}
                                insideDialog={insideDialog}
                                isByokPlan={false}
                                key={plan.name} 
                            />
                        ))}
                    </div>
                    {/* BYOK + instructions side-by-side */}
                    {plans.filter(plan => plan.name.includes('BYOK')).map((plan) => (
                        <div key={plan.name} className="mx-auto w-full max-w-6xl mt-4 md:mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <BillingPricingCard 
                                plan={plan}
                                insideDialog={insideDialog}
                                isByokPlan={true}
                            />
                            <div className="rounded-lg border bg-gradient-to-tr from-zinc-900/40 via-zinc-900/20 to-zinc-800/40 p-6">
                                <h4 className="text-sm font-semibold mb-3">Connect OpenRouter (BYOK)</h4>
                                <div className="space-y-3 text-sm">
                                    <Step number={1}>
                                        Sign up on <a href="https://openrouter.ai/" target="_blank" rel="noreferrer" className="underline hover:text-primary">OpenRouter</a>.
                                    </Step>
                                    <Step number={2}>
                                        Add usage credit: <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer" className="underline hover:text-primary">Billing & Credits</a>.
                                    </Step>
                                    <Step number={3}>
                                        Create an API key (name it, optionally set a spend cap): <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="underline hover:text-primary">API Keys</a>.
                                    </Step>
                                    <Step number={4}>
                                        Paste the key in Cheatcode under <span className="font-medium">Settings → BYOK</span> and you're set.
                                    </Step>
                                </div>
                            </div>
                        </div>
                    ))}
                </>
            ) : (
                <>
                    {/* Normal page layout unchanged */}
                    <div className={cn(
                        "mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 md:gap-6 md:grid-cols-3"
                    )}>
				{plans.filter(plan => !plan.name.includes('BYOK')).map((plan) => (
					<BillingPricingCard 
						plan={plan}
						insideDialog={insideDialog}
						isByokPlan={false}
						key={plan.name} 
					/>
				))}
			</div>
			{plans.filter(plan => plan.name.includes('BYOK')).length > 0 && (
                        <div className={cn("mx-auto w-full max-w-md") }>
					{plans.filter(plan => plan.name.includes('BYOK')).map((plan) => (
						<BillingPricingCard 
							plan={plan}
							insideDialog={insideDialog}
							isByokPlan={true}
							key={plan.name} 
						/>
					))}
				</div>
                    )}
                </>
			)}
		</div>
	);
}

type BillingPricingCardProps = React.ComponentProps<'div'> & {
	plan: BillingPlan;
	insideDialog?: boolean;
	isByokPlan?: boolean;
};

// Numbered step used in BYOK instructions (popup only)
const Step = ({ number, children }: { number: number; children: React.ReactNode }) => (
    <div className="flex items-start gap-3">
        <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-primary/15 text-primary grid place-items-center text-xs font-semibold">
            {number}
        </div>
        <div className="text-muted-foreground leading-relaxed">
            {children}
        </div>
    </div>
);

export function BillingPricingCard({
	plan,
	className,
	insideDialog = false,
	isByokPlan = false,
	...props
}: BillingPricingCardProps) {
	return (
		<div
			key={plan.name}
			className={cn(
				'relative flex w-full flex-col rounded-lg border',
				className,
			)}
			{...props}
		>
			{plan.highlighted && (
				<BorderTrail
					style={{
						boxShadow:
							'0px 0px 60px 30px rgb(255 255 255 / 50%), 0 0 100px 60px rgb(0 0 0 / 50%), 0 0 140px 90px rgb(0 0 0 / 50%)',
					}}
					size={100}
				/>
			)}
			<div
				className={cn(
					'bg-muted/20 rounded-t-lg border-b p-4',
                insideDialog && 'sm:p-5',
					plan.highlighted && 'bg-muted/40',
				)}
			>
				<div className="absolute top-2 right-2 z-10 flex items-center gap-2">
					{plan.highlighted && (
						<Badge className="bg-primary text-primary-foreground">
							<StarIcon className="h-3 w-3 fill-current mr-1" />
							Popular
						</Badge>
					)}
					{plan.isCurrentPlan && (
						<Badge variant="secondary" className="text-xs">
							Current
						</Badge>
					)}
				</div>

				<div className="text-lg font-medium">{plan.name}</div>
				<p className="text-muted-foreground text-sm font-normal">{plan.info}</p>
				
				<div className="mt-2 flex items-end gap-1">
					{(typeof plan.price === 'number' && plan.price === 0) ? (
						<span className="text-3xl font-bold">Free</span>
					) : (
						<>
							<LocalizedPrice 
								basePrice={typeof plan.price === 'number' ? plan.price : plan.price.monthly}
								baseCurrency="USD"
								apiKey={process.env.NEXT_PUBLIC_EXCHANGE_API_KEY || ''}
								formatPrice={(price, currency) => (
									<span className="text-3xl font-bold">
										{new Intl.NumberFormat(undefined, {
											style: 'currency',
											currency: currency || 'USD'
										}).format(price)}
									</span>
								)}
							/>
                            {isByokPlan && (
								<span className={cn('text-muted-foreground', insideDialog && 'text-sm')}>
									/month
								</span>
							)}
						</>
					)}
				</div>
				
				{isByokPlan && (
					<div className="mt-1">
						<Badge variant="secondary" className="text-xs">
							Monthly Subscription
						</Badge>
					</div>
				)}
				
				{plan.credits !== 0 && (
					<div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
						<Zap className="h-4 w-4 text-blue-500" />
											<span>
						{plan.credits === -1 ? 'Unlimited' : plan.credits} 
						{plan.planId === 'free' ? ' credits/month' : plan.credits === -1 ? ' credits' : ' credits'}
					</span>
					</div>
				)}
			</div>
			
            <div
                className={cn(
                    'text-muted-foreground px-4 text-sm flex-grow',
                    insideDialog ? 'space-y-3 sm:px-5 py-5' : 'space-y-4 py-6',
                    plan.highlighted && 'bg-muted/10',
                )}
            >
                {plan.features.map((feature, index) => (
                    <div key={index} className="flex items-center gap-2">
                        <CheckCircleIcon className="text-foreground h-4 w-4 flex-shrink-0" />
                        <TooltipProvider>
                            <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                    <p
                                        className={cn(
                                            feature.tooltip && 'cursor-pointer border-b border-dashed',
                                        )}
                                    >
                                        {feature.text}
                                    </p>
                                </TooltipTrigger>
                                {feature.tooltip && (
                                    <TooltipContent>
                                        <p>{feature.tooltip}</p>
                                    </TooltipContent>
                                )}
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                ))}
            </div>
			
			<div
				className={cn(
					'mt-auto w-full border-t p-3',
                    insideDialog && 'sm:p-4',
					plan.highlighted && 'bg-muted/40',
				)}
			>
				<Button
					className={cn(
						'w-full transition-all duration-200',
						plan.isUpgrading && 'animate-pulse'
					)}
					variant={plan.highlighted && !plan.isCurrentPlan ? 'default' : 'outline'}
					onClick={plan.btn.onClick}
					disabled={plan.isCurrentPlan || plan.isUpgrading}
				>
					<span className="flex items-center justify-center space-x-2">
						<span>{plan.btn.text}</span>
						{!plan.isCurrentPlan && !plan.isUpgrading && ((typeof plan.price === 'number' && plan.price > 0) || (typeof plan.price === 'object' && plan.price.monthly > 0)) && (
							<ArrowRight className="h-4 w-4" />
						)}
					</span>
				</Button>
			</div>
		</div>
	);
}

type BorderTrailProps = {
  className?: string;
  size?: number;
  transition?: Transition;
  delay?: number;
  onAnimationComplete?: () => void;
  style?: React.CSSProperties;
};

export function BorderTrail({
  className,
  size = 60,
  transition,
  delay,
  onAnimationComplete,
  style,
}: BorderTrailProps) {
  const BASE_TRANSITION = {
    repeat: Infinity,
    duration: 5,
    ease: [0, 0, 1, 1] as Easing, // Linear easing as cubic-bezier
  };

  return (
    <div className='pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]'>
      <motion.div
        className={cn('absolute aspect-square bg-zinc-500', className)}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          ...style,
        }}
        animate={{
          offsetDistance: ['0%', '100%'],
        }}
        transition={{
          ...(transition ?? BASE_TRANSITION),
          delay: delay,
        }}
        onAnimationComplete={onAnimationComplete}
      />
    </div>
  );
}