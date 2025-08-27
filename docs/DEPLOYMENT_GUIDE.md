# FastAPI Backend Deployment Guide - Google Cloud Run

Complete step-by-step guide to deploy a FastAPI backend with Dramatiq workers, Redis, and Supabase to Google Cloud Run.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Step 1: Google Cloud Setup](#step-1-google-cloud-setup)
- [Step 2: Environment Configuration](#step-2-environment-configuration)
- [Step 3: Docker Setup](#step-3-docker-setup)
- [Step 4: Secrets Management](#step-4-secrets-management)
- [Step 5: API Service Deployment](#step-5-api-service-deployment)
- [Step 6: Worker Service Deployment](#step-6-worker-service-deployment)
- [Step 7: Verification & Testing](#step-7-verification--testing)
- [Troubleshooting](#troubleshooting)
- [Monitoring & Maintenance](#monitoring--maintenance)

## Prerequisites

- **Google Cloud Account** with billing enabled
- **Docker Desktop** installed and running
- **gcloud CLI** installed and authenticated
- **FastAPI application** with the following stack:
  - FastAPI backend
  - Dramatiq for background tasks
  - Redis (Upstash) for message broker
  - Supabase for database
  - Various AI/ML APIs (OpenAI, Anthropic, etc.)

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │────│  Cloud Run API  │────│ Cloud Run      │
│   (Next.js)     │    │   (FastAPI)     │    │ Workers         │
└─────────────────┘    └─────────────────┘    │ (Dramatiq)      │
                                │             └─────────────────┘
                                │                       │
                       ┌─────────────────┐             │
                       │  Upstash Redis  │─────────────┘
                       │ (Message Broker)│
                       └─────────────────┘
                                │
                       ┌─────────────────┐
                       │    Supabase     │
                       │   (Database)    │
                       └─────────────────┘
```

## Step 1: Google Cloud Setup

### 1.1 Initialize gcloud CLI

```bash
# Initialize gcloud configuration
gcloud init

# Follow the prompts:
# 1. Choose [1] Re-initialize this configuration [default] with new settings
# 2. Select your Google account
# 3. Choose existing project or create new one
# 4. Select your project (e.g., cheatcode-backend)
```

### 1.2 Configure Region

```bash
# Set compute region (choose closest to your users)
gcloud config set compute/region asia-south1  # For India
# Alternative regions: us-central1, europe-west1, etc.

# Set Cloud Run region
gcloud config set run/region asia-south1
```

### 1.3 Enable Required APIs

```bash
# Enable Compute Engine API (will take a few minutes)
gcloud services enable compute.googleapis.com

# Enable Cloud Run API
gcloud services enable run.googleapis.com

# Enable Cloud Build API (for container builds)
gcloud services enable cloudbuild.googleapis.com

# Enable Container Registry API
gcloud services enable containerregistry.googleapis.com

# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com
```

### 1.4 Configure Docker Authentication

```bash
# Configure Docker to authenticate with Google Container Registry
gcloud auth configure-docker gcr.io
# Choose 'y' when prompted
```

## Step 2: Environment Configuration

### 2.1 Required Environment Variables

Create a `.env` file with the following variables (adjust values for your setup):

```env
# Environment Mode
ENV_MODE=production

# Redis Configuration (Upstash)
# Upstash Redis Configuration
# For upstash-redis SDK (REST API)
UPSTASH_REDIS_REST_URL=https://your-redis-host.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token

# For Dramatiq (Traditional Redis Connection)
REDIS_URL=rediss://default:your-redis-password@your-redis-host.upstash.io:6379

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# AI/ML API Keys
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
OPENROUTER_API_KEY=your-openrouter-key
MORPH_API_KEY=your-morph-key
MODEL_TO_USE=your-preferred-model

# Authentication (Clerk)
CLERK_SECRET_KEY=your-clerk-secret
CLERK_DOMAIN=your-domain.clerk.accounts.dev

# Payment Processing (DodoPayments)
DODO_PAYMENTS_API_KEY=your-dodo-api-key
DODO_PAYMENTS_WEBHOOK_SECRET=your-dodo-webhook-secret

# Additional APIs
TAVILY_API_KEY=your-tavily-key
FIRECRAWL_API_KEY=your-firecrawl-key
FIRECRAWL_URL=https://api.firecrawl.dev

# Sandbox Environment (Daytona)
DAYTONA_API_KEY=your-daytona-key
DAYTONA_SERVER_URL=your-daytona-server
DAYTONA_TARGET=your-daytona-target

# Analytics (Langfuse)
LANGFUSE_PUBLIC_KEY=your-langfuse-public-key
LANGFUSE_SECRET_KEY=your-langfuse-secret-key
LANGFUSE_HOST=https://cloud.langfuse.com

# Feature Flags
FREESTYLE_API_KEY=your-freestyle-key
FEATURE_FLAGS_ENABLED=true

# Integration Platform (Pipedream)
PIPEDREAM_CLIENT_ID=your-pipedream-client-id
PIPEDREAM_CLIENT_SECRET=your-pipedream-client-secret
PIPEDREAM_PROJECT_ID=your-pipedream-project-id
PIPEDREAM_X_PD_ENVIRONMENT=production

# Additional Services
SMITHERY_API_KEY=your-smithery-key
MCP_CREDENTIAL_ENCRYPTION_KEY=your-32-character-encryption-key
GOOGLE_API_KEY=your-google-api-key
```

### 2.2 Configuration File Updates

Ensure your `backend/utils/config.py` has optional fields for non-critical APIs:

```python
# Make sure RAPID_API_KEY is optional if not used
RAPID_API_KEY: Optional[str] = None
```

### 2.3 Redis SSL Configuration

Verify SSL configuration in your Redis clients:

**For main Redis client (`backend/services/redis.py`):**
```python
if redis_ssl:
    import ssl
    pool_kwargs.update({
        "connection_class": redis.SSLConnection,  # For redis-py
        "ssl_cert_reqs": ssl.CERT_NONE,
        "ssl_check_hostname": False,
    })
```

**For Dramatiq Redis broker (`backend/run_agent_background.py`):**
```python
if redis_ssl:
    import ssl
    broker_kwargs.update({
        "ssl": True,  # For Dramatiq RedisBroker
        "ssl_cert_reqs": ssl.CERT_NONE,
        "ssl_check_hostname": False,
    })
```

## Step 3: Docker Setup

### 3.1 Verify Docker is Running

```bash
# Check Docker status
docker --version
docker info

# If Docker Desktop is not running, start it manually
```

### 3.2 Build Docker Image

```bash
# Navigate to project root
cd /path/to/your/project

# Build Docker image with your project ID
docker build -t gcr.io/YOUR_PROJECT_ID/backend-api:latest ./backend

# Example:
docker build -t gcr.io/cheatcode-backend/backend-api:latest ./backend
```

### 3.3 Push to Google Container Registry

```bash
# Push the image to GCR
docker push gcr.io/YOUR_PROJECT_ID/backend-api:latest

# Example:
docker push gcr.io/cheatcode-backend/backend-api:latest
```

### 3.4 Docker Build Troubleshooting

If you encounter build issues:

```bash
# Check Docker daemon status
docker system info

# Clean up if needed
docker system prune -f

# Rebuild with no cache
docker build --no-cache -t gcr.io/YOUR_PROJECT_ID/backend-api:latest ./backend
```

## Step 4: Secrets Management

### 4.1 Create Secrets in Google Secret Manager

**Option A: Individual Secrets (Recommended)**

Create each secret individually for better security:

```bash
# Example: Create ENV_MODE secret
echo -n "production" | gcloud secrets create ENV_MODE --data-file=-

# Create all other secrets similarly
# Create Upstash Redis secrets
echo -n "https://your-redis-host.upstash.io" | gcloud secrets create UPSTASH_REDIS_REST_URL --data-file=-
echo -n "your-redis-token" | gcloud secrets create UPSTASH_REDIS_REST_TOKEN --data-file=-
echo -n "rediss://default:your-redis-password@your-redis-host.upstash.io:6379" | gcloud secrets create REDIS_URL --data-file=-

# Continue for all environment variables...
```

**Option B: Bulk Upload via Google Cloud Console**

1. Go to [Google Cloud Console > Secret Manager](https://console.cloud.google.com/security/secret-manager)
2. Click "CREATE SECRET"
3. Upload your `.env` file as a single secret
4. Extract individual secrets as needed

### 4.2 Grant Access to Cloud Run Service Account

```bash
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)")

# Grant Secret Manager access to Cloud Run service account
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

# Example:
gcloud projects add-iam-policy-binding cheatcode-backend \
    --member="serviceAccount:593980410434-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

## Step 5: API Service Deployment

### 5.1 Deploy API Service

```bash
gcloud run deploy cheatcode-api \
  --image gcr.io/YOUR_PROJECT_ID/backend-api:latest \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-secrets "ENV_MODE=ENV_MODE:latest,UPSTASH_REDIS_REST_URL=UPSTASH_REDIS_REST_URL:latest,UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest,REDIS_URL=REDIS_URL:latest,SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest,MORPH_API_KEY=MORPH_API_KEY:latest,MODEL_TO_USE=MODEL_TO_USE:latest,CLERK_SECRET_KEY=CLERK_SECRET_KEY:latest,CLERK_DOMAIN=CLERK_DOMAIN:latest,DODO_PAYMENTS_API_KEY=DODO_PAYMENTS_API_KEY:latest,DODO_PAYMENTS_WEBHOOK_SECRET=DODO_PAYMENTS_WEBHOOK_SECRET:latest,TAVILY_API_KEY=TAVILY_API_KEY:latest,FIRECRAWL_API_KEY=FIRECRAWL_API_KEY:latest,FIRECRAWL_URL=FIRECRAWL_URL:latest,DAYTONA_API_KEY=DAYTONA_API_KEY:latest,DAYTONA_SERVER_URL=DAYTONA_SERVER_URL:latest,DAYTONA_TARGET=DAYTONA_TARGET:latest,LANGFUSE_PUBLIC_KEY=LANGFUSE_PUBLIC_KEY:latest,LANGFUSE_SECRET_KEY=LANGFUSE_SECRET_KEY:latest,LANGFUSE_HOST=LANGFUSE_HOST:latest,FREESTYLE_API_KEY=FREESTYLE_API_KEY:latest,FEATURE_FLAGS_ENABLED=FEATURE_FLAGS_ENABLED:latest,PIPEDREAM_CLIENT_ID=PIPEDREAM_CLIENT_ID:latest,PIPEDREAM_CLIENT_SECRET=PIPEDREAM_CLIENT_SECRET:latest,PIPEDREAM_PROJECT_ID=PIPEDREAM_PROJECT_ID:latest,PIPEDREAM_X_PD_ENVIRONMENT=PIPEDREAM_X_PD_ENVIRONMENT:latest,SMITHERY_API_KEY=SMITHERY_API_KEY:latest,MCP_CREDENTIAL_ENCRYPTION_KEY=MCP_CREDENTIAL_ENCRYPTION_KEY:latest,GOOGLE_API_KEY=GOOGLE_API_KEY:latest" \
  --memory 2Gi \
  --cpu 1 \
  --concurrency 100 \
  --timeout 900 \
  --max-instances 10 \
  --min-instances 0 \
  --port 8000
```

### 5.2 API Service Configuration Explained

| Parameter | Value | Description |
|-----------|-------|-------------|
| `--memory 2Gi` | 2GB RAM | Sufficient for AI/ML processing |
| `--cpu 1` | 1 vCPU | Balanced CPU allocation |
| `--concurrency 100` | 100 requests | Concurrent requests per instance |
| `--timeout 900` | 15 minutes | Extended timeout for AI processing |
| `--max-instances 10` | Auto-scale limit | Maximum service instances |
| `--min-instances 0` | Scale to zero | Cost-effective scaling |
| `--port 8000` | Container port | FastAPI default port |
| `--allow-unauthenticated` | Public access | API accessible from frontend |

## Step 6: Worker Service Deployment

### 6.1 Deploy Worker Service

```bash
gcloud run deploy cheatcode-workers \
  --image gcr.io/YOUR_PROJECT_ID/backend-api:latest \
  --platform managed \
  --region asia-south1 \
  --no-allow-unauthenticated \
  --set-secrets "ENV_MODE=ENV_MODE:latest,UPSTASH_REDIS_REST_URL=UPSTASH_REDIS_REST_URL:latest,UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest,REDIS_URL=REDIS_URL:latest,SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest,MORPH_API_KEY=MORPH_API_KEY:latest,MODEL_TO_USE=MODEL_TO_USE:latest,CLERK_SECRET_KEY=CLERK_SECRET_KEY:latest,CLERK_DOMAIN=CLERK_DOMAIN:latest,DODO_PAYMENTS_API_KEY=DODO_PAYMENTS_API_KEY:latest,DODO_PAYMENTS_WEBHOOK_SECRET=DODO_PAYMENTS_WEBHOOK_SECRET:latest,TAVILY_API_KEY=TAVILY_API_KEY:latest,FIRECRAWL_API_KEY=FIRECRAWL_API_KEY:latest,FIRECRAWL_URL=FIRECRAWL_URL:latest,DAYTONA_API_KEY=DAYTONA_API_KEY:latest,DAYTONA_SERVER_URL=DAYTONA_SERVER_URL:latest,DAYTONA_TARGET=DAYTONA_TARGET:latest,LANGFUSE_PUBLIC_KEY=LANGFUSE_PUBLIC_KEY:latest,LANGFUSE_SECRET_KEY=LANGFUSE_SECRET_KEY:latest,LANGFUSE_HOST=LANGFUSE_HOST:latest,FREESTYLE_API_KEY=FREESTYLE_API_KEY:latest,FEATURE_FLAGS_ENABLED=FEATURE_FLAGS_ENABLED:latest,PIPEDREAM_CLIENT_ID=PIPEDREAM_CLIENT_ID:latest,PIPEDREAM_CLIENT_SECRET=PIPEDREAM_CLIENT_SECRET:latest,PIPEDREAM_PROJECT_ID=PIPEDREAM_PROJECT_ID:latest,PIPEDREAM_X_PD_ENVIRONMENT=PIPEDREAM_X_PD_ENVIRONMENT:latest,SMITHERY_API_KEY=SMITHERY_API_KEY:latest,MCP_CREDENTIAL_ENCRYPTION_KEY=MCP_CREDENTIAL_ENCRYPTION_KEY:latest,GOOGLE_API_KEY=GOOGLE_API_KEY:latest" \
  --memory 2Gi \
  --cpu 2 \
  --concurrency 1000 \
  --max-instances 5 \
  --min-instances 1 \
  --no-cpu-throttling \
  --command="sh" \
  --args="-c,cd /app && uv run python -m dramatiq run_agent_background"
```

### 6.2 Worker Configuration Explained

| Parameter | Value | Description |
|-----------|-------|-------------|
| `--no-allow-unauthenticated` | Private service | Workers don't need HTTP access |
| `--memory 2Gi` | 2GB RAM | AI processing requires memory |
| `--cpu 2` | 2 vCPUs | Parallel task processing |
| `--min-instances 1` | Always running | Workers ready for immediate processing |
| `--max-instances 5` | Scale limit | Handle task bursts efficiently |
| `--no-cpu-throttling` | Always allocated | Workers need consistent CPU |
| `--concurrency 1000` | High concurrency | Multiple tasks per instance |
| `--command` | Custom command | Run Dramatiq instead of FastAPI |

## Step 7: Verification & Testing

### 7.1 Test API Health

```bash
# Test health endpoint (Windows PowerShell)
Invoke-WebRequest -Uri "https://YOUR_SERVICE_URL/api/health" -Method GET

# Expected response:
# StatusCode: 200
# Content: {"status":"ok","timestamp":"2025-08-14T23:25:24.206838+00:00","instance_id":"single"}
```

### 7.2 Check Service Status

```bash
# List all Cloud Run services
gcloud run services list --region=asia-south1

# Get specific service details
gcloud run services describe cheatcode-api --region=asia-south1
gcloud run services describe cheatcode-workers --region=asia-south1
```

### 7.3 Monitor Logs

```bash
# View API logs
gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=cheatcode-api" --limit=50

# View worker logs
gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=cheatcode-workers" --limit=50

# Stream live logs
gcloud logs tail "resource.type=cloud_run_revision AND resource.labels.service_name=cheatcode-api"
```

### 7.4 Test Worker Functionality

Create a test script to verify workers are processing tasks:

```python
# test_workers.py
import asyncio
from services import redis
from run_agent_background import run_agent_in_background

async def test_worker():
    await redis.initialize_async()
    
    # Send a test task
    await run_agent_in_background.send(
        agent_run_id="test-123",
        thread_id="test-thread",
        request_id="test-request",
        user_id="test-user",
        app_type="web"
    )
    
    print("Test task sent to workers!")

if __name__ == "__main__":
    asyncio.run(test_worker())
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Container Startup Failures

**Error**: `Container failed to start and listen on port 8000`

**Solutions**:
- Check container logs: `gcloud logs read "resource.type=cloud_run_revision"`
- Verify PORT environment variable is set to 8000
- Ensure health check endpoint is accessible

#### 2. Secret Manager Permission Errors

**Error**: `Permission denied on secret`

**Solution**:
```bash
# Re-grant secret access
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

#### 3. Redis Connection Issues

**Error**: `Redis connection failed` or `SSL connection errors`

**Solutions**:
- Verify Redis SSL configuration matches library requirements
- Check Redis credentials in Secret Manager
- Ensure Redis host is accessible from Cloud Run

#### 4. Configuration Validation Errors

**Error**: `Missing required configuration fields`

**Solutions**:
- Make optional fields truly optional in `config.py`:
  ```python
  OPTIONAL_FIELD: Optional[str] = None
  ```
- Add all required secrets to Secret Manager
- Verify secret names match configuration field names

#### 5. Docker Build Issues

**Error**: Docker build failures or slow builds

**Solutions**:
```bash
# Check Docker Desktop status
docker system info

# Clean Docker cache
docker system prune -f

# Rebuild without cache
docker build --no-cache -t gcr.io/YOUR_PROJECT_ID/backend-api:latest ./backend
```

### Debugging Commands

```bash
# Check service configuration
gcloud run services describe SERVICE_NAME --region=REGION --format=export

# View recent deployments
gcloud run revisions list --service=SERVICE_NAME --region=REGION

# Get detailed logs with timestamps
gcloud logs read "resource.type=cloud_run_revision" --format="value(timestamp,textPayload)" --limit=100

# Check IAM permissions
gcloud projects get-iam-policy YOUR_PROJECT_ID

# Test secret access
gcloud secrets versions access latest --secret=SECRET_NAME
```

## Monitoring & Maintenance

### 1. Set Up Monitoring

```bash
# Create uptime check
gcloud monitoring uptime create \
    --display-name="API Health Check" \
    --http-check-path="/api/health" \
    --hostname="your-service-url.run.app"
```

### 2. Performance Monitoring

- **Cloud Monitoring**: Set up alerts for high CPU, memory, or error rates
- **Custom Metrics**: Track API response times and worker queue lengths
- **Logging**: Monitor for errors and performance bottlenecks

### 3. Scaling Configuration

```bash
# Update service configuration
gcloud run services update cheatcode-api \
    --region=asia-south1 \
    --min-instances=1 \
    --max-instances=20 \
    --memory=4Gi \
    --cpu=2
```

### 4. Cost Optimization

- **Scale to Zero**: Use `--min-instances=0` for cost savings
- **Right-sizing**: Monitor resource usage and adjust memory/CPU
- **Regional Deployment**: Choose regions close to users
- **Request Limits**: Set appropriate concurrency and timeout values

### 5. Security Best Practices

- **Secrets Rotation**: Regularly rotate API keys and passwords
- **IAM Principle**: Grant minimum required permissions
- **VPC Connector**: Use for private network access if needed
- **HTTPS Only**: Ensure all traffic uses HTTPS

## Production Checklist

Before going live, verify:

- [ ] All secrets are properly configured in Secret Manager
- [ ] Health checks are passing for both API and workers
- [ ] Redis connection is stable and SSL-configured
- [ ] Database connections are working
- [ ] Monitoring and alerting are set up
- [ ] Error tracking is configured (Sentry)
- [ ] Load testing has been performed
- [ ] Backup and disaster recovery plans are in place
- [ ] Documentation is updated
- [ ] Team has access to logs and monitoring

## Service URLs

After successful deployment, your services will be available at:

- **API Service**: `https://cheatcode-api-[PROJECT-NUMBER].[REGION].run.app`
- **Workers**: Internal service (no public URL)

Update your frontend configuration to use the API service URL.

---

## Additional Resources

- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)
- [FastAPI Deployment Guide](https://fastapi.tiangolo.com/deployment/)
- [Dramatiq Documentation](https://dramatiq.io/)
- [Google Secret Manager](https://cloud.google.com/secret-manager/docs)
- [Redis SSL Configuration](https://redis.io/docs/manual/security/encryption/)

---

*This guide was created based on successful deployment of a FastAPI + Dramatiq + Redis + Supabase stack to Google Cloud Run. Adjust configurations based on your specific requirements.*
