// API Type Definitions

export type Project = {
  id: string;
  name: string;
  description: string;
  account_id: string;
  created_at: string;
  updated_at?: string;
  sandbox: {
    dev_server_url?: string;
    api_server_url?: string;
    id?: string;
    token?: string;
  };
  is_public?: boolean;
  app_type?: 'web' | 'mobile';
  [key: string]: any;
};

export type Thread = {
  thread_id: string;
  account_id: string | null;
  project_id?: string | null;
  is_public?: boolean;
  metadata?: { name?: string; [key: string]: any };
  created_at: string;
  updated_at: string;
  [key: string]: any;
};

export type Message = {
  role: string;
  content: string;
  type: string;
};

export type AgentRun = {
  id: string;
  thread_id: string;
  status: 'running' | 'completed' | 'stopped' | 'error';
  started_at: string;
  completed_at: string | null;
  responses: Message[];
  error: string | null;
};

export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export interface InitiateAgentResponse {
  thread_id: string;
  agent_run_id: string;
}

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  instance_id: string;
}

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
  permissions?: string;
}

// Billing API Types
export interface CreateCheckoutSessionRequest {
  price_id: string;
  success_url: string;
  cancel_url: string;
  referral_id?: string;
}

export interface SubscriptionStatus {
  status: string;
  plan_name?: string;
  price_id?: string;
  current_period_end?: string;
  cancel_at_period_end: boolean;
  trial_end?: string;
  minutes_limit?: number;
  cost_limit?: number;
  current_usage?: number;
  has_schedule: boolean;
  scheduled_plan_name?: string;
  scheduled_price_id?: string;
  scheduled_change_date?: string;
  schedule_effective_date?: string;
}

export interface BillingStatusResponse {
  account_id: string;
  plan_id: string;
  plan_name: string;
  price_inr: number;
  price_usd: number;
  tokens_total: number;
  tokens_remaining: number;
  credits_total: number;
  credits_remaining: number;
  quota_resets_at: string;
  subscription_status: string;
  features: string[];
  can_run?: boolean;
  message?: string;
  deployments_used: number;
  deployments_total: number;
}

export interface UsageLogEntry {
  message_id: string;
  thread_id: string;
  created_at: string;
  content: {
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
    };
    model: string;
  };
  total_tokens: number;
  estimated_cost: number;
  project_id: string;
}

export interface UsageLogsResponse {
  logs: UsageLogEntry[];
  has_more: boolean;
  message?: string;
}

export interface TokenUsageEntry {
  id: string;
  account_id: string;
  thread_id?: string;
  message_id?: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  tokens_remaining_after: number;
  estimated_cost: number;
  created_at: string;
  project_id?: string;
}

export interface UsageHistoryResponse {
  account_id: string;
  usage_entries: TokenUsageEntry[];
  total_tokens_used: number;
  total_credits_used: number;
}

export interface PlanDetails {
  name: string;
  price_inr: number;
  price_usd: number;
  token_quota: number;
  display_credits: number;
  features: string[];
  description: string;
}

export interface PlanListResponse {
  plans: PlanDetails[];
  current_plan: string;
}

export interface CheckoutSessionResponse {
  checkout_url?: string;
  success: boolean;
  message: string;
  plan_details?: PlanDetails;
}

export interface CreateCheckoutSessionResponse {
  status:
    | 'upgraded'
    | 'downgrade_scheduled'
    | 'checkout_created'
    | 'no_change'
    | 'new'
    | 'updated'
    | 'scheduled';
  subscription_id?: string;
  schedule_id?: string;
  session_id?: string;
  url?: string;
  effective_date?: string;
  message?: string;
  details?: {
    is_upgrade?: boolean;
    effective_date?: string;
    current_price?: number;
    new_price?: number;
    invoice?: {
      id: string;
      status: string;
      amount_due: number;
      amount_paid: number;
    };
  };
}

// File Tree Types (optimized recursive endpoint)
export interface FileTreeNode {
  name: string;
  path: string;
  fullPath: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

export interface FileTreeResponse {
  tree: FileTreeNode[];
  totalFiles: number;
  basePath: string;
}
