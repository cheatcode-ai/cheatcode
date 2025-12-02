// API Module Index - Re-exports all API functions and types for backward compatibility

// Config
export { API_URL } from './config';

// Error Classes
export {
  BillingError,
  ProjectInitiationError,
  SandboxCreationError,
  InitiationAuthError,
  InsufficientCreditsError,
} from './errors';

// Types
export type {
  Project,
  Thread,
  Message,
  AgentRun,
  ToolCall,
  InitiateAgentResponse,
  HealthCheckResponse,
  FileInfo,
  FileTreeNode,
  FileTreeResponse,
  CreateCheckoutSessionRequest,
  SubscriptionStatus,
  BillingStatusResponse,
  UsageLogEntry,
  UsageLogsResponse,
  TokenUsageEntry,
  UsageHistoryResponse,
  PlanDetails,
  PlanListResponse,
  CheckoutSessionResponse,
  CreateCheckoutSessionResponse,
} from './types';

// Project APIs
export {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getPublicProjects,
} from './projects';

// Thread APIs
export {
  getThreads,
  getThread,
  createThread,
  addUserMessage,
  getMessages,
  updateThreadName,
} from './threads';

// Agent APIs
export {
  startAgent,
  stopAgent,
  getAgentStatus,
  getAgentRuns,
  streamAgent,
  initiateAgent,
  checkApiHealth,
} from './agents';

// Sandbox APIs
export {
  createSandboxFile,
  createSandboxFileJson,
  listSandboxFiles,
  listProjectFiles,
  getProjectFileContent,
  getSandboxFileContent,
  getSandboxFileTree,
  downloadSandboxCode,
} from './sandbox';

// Billing APIs
export {
  getSubscription,
  checkBillingStatus,
  getUsageHistory,
  getAvailablePlans,
  createPolarCheckoutSession,
} from './billing';

// Utility Functions
export {
  testSupabaseConnection,
} from './utils';
