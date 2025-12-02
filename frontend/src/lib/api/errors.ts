// Custom error classes for API operations

// Custom error for billing issues
export class BillingError extends Error {
  status: number;
  detail: { message: string; [key: string]: any };

  constructor(
    status: number,
    detail: { message: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || 'Billing error occurred');
    this.name = 'BillingError';
    this.status = status;
    this.detail = detail;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, BillingError);
    }
  }
}

// Custom error for project initiation failures
export class ProjectInitiationError extends Error {
  status: number;
  detail: { message: string; errorType: string; [key: string]: any };

  constructor(
    status: number,
    detail: { message: string; errorType: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || 'Project initiation failed');
    this.name = 'ProjectInitiationError';
    this.status = status;
    this.detail = detail;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ProjectInitiationError);
    }
  }
}

// Custom error for sandbox creation failures
export class SandboxCreationError extends Error {
  status: number;
  detail: { message: string; sandboxType?: string; [key: string]: any };

  constructor(
    status: number,
    detail: { message: string; sandboxType?: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || 'Sandbox creation failed');
    this.name = 'SandboxCreationError';
    this.status = status;
    this.detail = detail;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, SandboxCreationError);
    }
  }
}

// Custom error for authentication issues during initiation
export class InitiationAuthError extends Error {
  status: number;
  detail: { message: string; [key: string]: any };

  constructor(
    status: number,
    detail: { message: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || 'Authentication failed during project initiation');
    this.name = 'InitiationAuthError';
    this.status = status;
    this.detail = detail;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, InitiationAuthError);
    }
  }
}

// Custom error for insufficient credits
export class InsufficientCreditsError extends Error {
  constructor(public details: any) {
    super(details.message || 'Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}
