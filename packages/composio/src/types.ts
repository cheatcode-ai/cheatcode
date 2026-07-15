export interface ComposioConnectedAccount {
  alias?: string | null;
  createdAt: string;
  id: string;
  isDisabled: boolean;
  status: string;
  toolkit: { slug: string };
  updatedAt: string;
  wordId?: string | null;
}

export interface ComposioConnectedAccountPage {
  items: ComposioConnectedAccount[];
  nextCursor: string | null;
}

export interface ComposioAuthConfig {
  id: string;
  status: "DISABLED" | "ENABLED";
}

export interface ComposioAuthConfigPage {
  items: ComposioAuthConfig[];
  nextCursor: string | null;
}

export interface ComposioConnectionLink {
  id: string;
  redirectUrl: string;
}

export interface ComposioToolkit {
  composioManagedAuthSchemes?: string[];
  meta?: {
    categories?: Array<{ name: string; slug: string }>;
    description?: string;
  };
  name: string;
  noAuth?: boolean;
  slug: string;
}

export interface ComposioTool {
  description?: string;
  inputParameters?: unknown;
  isDeprecated?: boolean;
  name?: string;
  slug: string;
  version?: string;
}

export interface ComposioToolPage {
  items: ComposioTool[];
  nextCursor: string | null;
}

export interface ComposioToolExecution {
  data: unknown;
  error: string | null;
  logId?: string;
  successful: boolean;
}

export interface ListConnectedAccountsInput {
  accountType?: "ALL" | "PRIVATE" | "SHARED";
  authConfigIds?: string[];
  cursor?: string;
  limit: number;
  statuses?: string[];
  toolkitSlugs?: string[];
  userIds?: string[];
}

export interface ListAuthConfigsInput {
  cursor?: string;
  isComposioManaged?: boolean;
  limit: number;
  toolkit?: string;
}

export interface ListToolkitsInput {
  limit: number;
  managedBy?: "all" | "composio" | "project";
  sortBy?: "alphabetically" | "usage";
}

export interface ListToolsInput {
  cursor?: string;
  important?: boolean;
  limit: number;
  search?: string;
  toolkit: string;
  toolkitVersion?: string;
}

export interface ExecuteToolInput {
  arguments: Record<string, unknown>;
  connectedAccountId: string;
  userId: string;
  version: string;
}
