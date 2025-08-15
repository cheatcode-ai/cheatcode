import { createClient } from "@/lib/supabase/client";

import { createClerkApiClient } from "@/lib/api-client-clerk";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

export type Agent = {
  agent_id: string;
  account_id: string;
  name: string;
  description?: string;
  system_prompt: string;
  configured_mcps: Array<any>;
  custom_mcps: Array<any>;
  agentpress_tools: Record<string, any>;
  is_default: boolean;
  avatar?: string;
  avatar_color?: string;
  created_at: string;
  updated_at: string;
};

// Removed ThreadAgentResponse type and getThreadAgent function - no longer needed for hardcoded agent display
  