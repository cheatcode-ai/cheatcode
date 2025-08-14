// Environment mode types
export enum EnvMode {
  LOCAL = 'local',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

// Subscription tier structure
export interface SubscriptionTierData {
  priceId: string;
  name: string;
}

// Subscription tiers structure
export interface SubscriptionTiers {
  FREE: SubscriptionTierData;
  TIER_2_20: SubscriptionTierData;
  TIER_6_50: SubscriptionTierData;
  TIER_12_100: SubscriptionTierData;
  TIER_25_200: SubscriptionTierData;
  TIER_50_400: SubscriptionTierData;
  TIER_125_800: SubscriptionTierData;
  TIER_200_1000: SubscriptionTierData;
  // Yearly plans with 15% discount
  TIER_2_20_YEARLY: SubscriptionTierData;
  TIER_6_50_YEARLY: SubscriptionTierData;
  TIER_12_100_YEARLY: SubscriptionTierData;
  TIER_25_200_YEARLY: SubscriptionTierData;
  TIER_50_400_YEARLY: SubscriptionTierData;
  TIER_125_800_YEARLY: SubscriptionTierData;
  TIER_200_1000_YEARLY: SubscriptionTierData;
}

// Configuration object
interface Config {
  ENV_MODE: EnvMode;
  IS_LOCAL: boolean;
  SUBSCRIPTION_TIERS: SubscriptionTiers;
}

// Production tier IDs
const PROD_TIERS: SubscriptionTiers = {
  FREE: {
    priceId: 'price_1RILb4G6l1KZGqIrK4QLrx9i',
    name: 'Free',
  },
  TIER_2_20: {
    priceId: 'price_1RILb4G6l1KZGqIrhomjgDnO',
    name: '2h/$20',
  },
  TIER_6_50: {
    priceId: 'price_1RILb4G6l1KZGqIr5q0sybWn',
    name: '6h/$50',
  },
  TIER_12_100: {
    priceId: 'price_1RILb4G6l1KZGqIr5Y20ZLHm',
    name: '12h/$100',
  },
  TIER_25_200: {
    priceId: 'price_1RILb4G6l1KZGqIrGAD8rNjb',
    name: '25h/$200',
  },
  TIER_50_400: {
    priceId: 'price_1RILb4G6l1KZGqIruNBUMTF1',
    name: '50h/$400',
  },
  TIER_125_800: {
    priceId: 'price_1RILb3G6l1KZGqIrbJA766tN',
    name: '125h/$800',
  },
  TIER_200_1000: {
    priceId: 'price_1RILb3G6l1KZGqIrmauYPOiN',
    name: '200h/$1000',
  },
  // Yearly plans with 15% discount (12x monthly price with 15% off)
  TIER_2_20_YEARLY: {
    priceId: 'price_1ReHB5G6l1KZGqIrD70I1xqM',
    name: '2h/$204/year',
  },
  TIER_6_50_YEARLY: {
    priceId: 'price_1ReHAsG6l1KZGqIrlAog487C',
    name: '6h/$510/year',
  },
  TIER_12_100_YEARLY: {
    priceId: 'price_1ReHAWG6l1KZGqIrBHer2PQc',
    name: '12h/$1020/year',
  },
  TIER_25_200_YEARLY: {
    priceId: 'price_1ReH9uG6l1KZGqIrsvMLHViC',
    name: '25h/$2040/year',
  },
  TIER_50_400_YEARLY: {
    priceId: 'price_1ReH9fG6l1KZGqIrsPtu5KIA',
    name: '50h/$4080/year',
  },
  TIER_125_800_YEARLY: {
    priceId: 'price_1ReH9GG6l1KZGqIrfgqaJyat',
    name: '125h/$8160/year',
  },
  TIER_200_1000_YEARLY: {
    priceId: 'price_1ReH8qG6l1KZGqIrK1akY90q',
    name: '200h/$10200/year',
  },
} as const;

// Staging tier IDs
const STAGING_TIERS: SubscriptionTiers = {
  FREE: {
    priceId: 'price_1RIGvuG6l1KZGqIrw14abxeL',
    name: 'Free',
  },
  TIER_2_20: {
    priceId: 'price_1RIGvuG6l1KZGqIrCRu0E4Gi',
    name: '2h/$20',
  },
  TIER_6_50: {
    priceId: 'price_1RIGvuG6l1KZGqIrvjlz5p5V',
    name: '6h/$50',
  },
  TIER_12_100: {
    priceId: 'price_1RIGvuG6l1KZGqIrT6UfgblC',
    name: '12h/$100',
  },
  TIER_25_200: {
    priceId: 'price_1RIGvuG6l1KZGqIrOVLKlOMj',
    name: '25h/$200',
  },
  TIER_50_400: {
    priceId: 'price_1RIKNgG6l1KZGqIrvsat5PW7',
    name: '50h/$400',
  },
  TIER_125_800: {
    priceId: 'price_1RIKNrG6l1KZGqIrjKT0yGvI',
    name: '125h/$800',
  },
  TIER_200_1000: {
    priceId: 'price_1RIKQ2G6l1KZGqIrum9n8SI7',
    name: '200h/$1000',
  },
  // Yearly plans with 15% discount (12x monthly price with 15% off)
  TIER_2_20_YEARLY: {
    priceId: 'price_1ReGogG6l1KZGqIrEyBTmtPk',
    name: '2h/$204/year',
  },
  TIER_6_50_YEARLY: {
    priceId: 'price_1ReGoJG6l1KZGqIr0DJWtoOc',
    name: '6h/$510/year',
  },
  TIER_12_100_YEARLY: {
    priceId: 'price_1ReGnZG6l1KZGqIr0ThLEl5S',
    name: '12h/$1020/year',
  },
  TIER_25_200_YEARLY: {
    priceId: 'price_1ReGmzG6l1KZGqIre31mqoEJ',
    name: '25h/$2040/year',
  },
  TIER_50_400_YEARLY: {
    priceId: 'price_1ReGmgG6l1KZGqIrn5nBc7e5',
    name: '50h/$4080/year',
  },
  TIER_125_800_YEARLY: {
    priceId: 'price_1ReGmMG6l1KZGqIrvE2ycrAX',
    name: '125h/$8160/year',
  },
  TIER_200_1000_YEARLY: {
    priceId: 'price_1ReGlXG6l1KZGqIrlgurP5GU',
    name: '200h/$10200/year',
  },
} as const;

// Determine the environment mode from environment variables
const getEnvironmentMode = (): EnvMode => {
  // Get the environment mode from the environment variable, if set
  const envMode = process.env.NEXT_PUBLIC_ENV_MODE?.toLowerCase();

  // First check if the environment variable is explicitly set
  if (envMode) {
    if (envMode === EnvMode.LOCAL) {
      console.log('Using explicitly set LOCAL environment mode');
      return EnvMode.LOCAL;
    } else if (envMode === EnvMode.STAGING) {
      console.log('Using explicitly set STAGING environment mode');
      return EnvMode.STAGING;
    } else if (envMode === EnvMode.PRODUCTION) {
      console.log('Using explicitly set PRODUCTION environment mode');
      return EnvMode.PRODUCTION;
    }
  }

  // If no valid environment mode is set, fall back to defaults based on NODE_ENV
  if (process.env.NODE_ENV === 'development') {
    console.log('Defaulting to LOCAL environment mode in development');
    return EnvMode.LOCAL;
  } else {
    console.log('Defaulting to PRODUCTION environment mode');
    return EnvMode.PRODUCTION;
  }
};

// Get the environment mode once to ensure consistency
const currentEnvMode = getEnvironmentMode();

// Create the config object
export const config: Config = {
  ENV_MODE: currentEnvMode,
  IS_LOCAL: currentEnvMode === EnvMode.LOCAL,
  SUBSCRIPTION_TIERS:
    currentEnvMode === EnvMode.STAGING ? STAGING_TIERS : PROD_TIERS,
};

// Helper function to check if we're in local mode (for component conditionals)
export const isLocalMode = (): boolean => {
  return config.IS_LOCAL;
};

// Export subscription tier type for typing elsewhere
export type SubscriptionTier = keyof typeof PROD_TIERS;
