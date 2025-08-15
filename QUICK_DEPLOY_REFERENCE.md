# FastAPI + Dramatiq Backend - Quick Deploy Reference

## 1. Google Cloud Setup

```powershell
# Initialize gcloud (choose existing project)
gcloud init

# Set region and enable APIs
gcloud config set compute/region asia-south1
gcloud config set run/region asia-south1
gcloud services enable compute.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable secretmanager.googleapis.com

# Configure Docker auth
gcloud auth configure-docker gcr.io
```

## 2. Secrets Setup (Google Cloud Console UI)

1. Go to [Secret Manager](https://console.cloud.google.com/security/secret-manager)
2. Create individual secrets for each environment variable:
   - `ENV_MODE`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `REDIS_URL`
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `MORPH_API_KEY`, `MODEL_TO_USE`
   - `CLERK_SECRET_KEY`, `CLERK_DOMAIN`
   - `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_SECRET`
   - `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `FIRECRAWL_URL`
   - `DAYTONA_API_KEY`, `DAYTONA_SERVER_URL`, `DAYTONA_TARGET`
   - `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`
   - `FREESTYLE_API_KEY`, `FEATURE_FLAGS_ENABLED`
   - `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID`, `PIPEDREAM_X_PD_ENVIRONMENT`
   - `SMITHERY_API_KEY`, `MCP_CREDENTIAL_ENCRYPTION_KEY`, `GOOGLE_API_KEY`

## 3. Grant Secret Access

```powershell
# Get your project number first
gcloud projects describe cheatcode-backend --format="value(projectNumber)"

# Grant Cloud Run service account access to secrets (replace PROJECT_NUMBER with output from above)
gcloud projects add-iam-policy-binding cheatcode-backend --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

## 4. Build & Push Docker Image

```powershell
# Build and push (replace PROJECT_ID)
docker build -t gcr.io/PROJECT_ID/backend-api:latest ./backend
docker push gcr.io/PROJECT_ID/backend-api:latest
```

## 5. Deploy API Service

```powershell
gcloud run deploy cheatcode-api --image gcr.io/PROJECT_ID/backend-api:latest --platform managed --region asia-south1 --allow-unauthenticated --set-secrets "ENV_MODE=ENV_MODE:latest,UPSTASH_REDIS_REST_URL=UPSTASH_REDIS_REST_URL:latest,UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest,REDIS_URL=REDIS_URL:latest,SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest,MORPH_API_KEY=MORPH_API_KEY:latest,MODEL_TO_USE=MODEL_TO_USE:latest,CLERK_SECRET_KEY=CLERK_SECRET_KEY:latest,CLERK_DOMAIN=CLERK_DOMAIN:latest,DODO_PAYMENTS_API_KEY=DODO_PAYMENTS_API_KEY:latest,DODO_PAYMENTS_WEBHOOK_SECRET=DODO_PAYMENTS_WEBHOOK_SECRET:latest,TAVILY_API_KEY=TAVILY_API_KEY:latest,FIRECRAWL_API_KEY=FIRECRAWL_API_KEY:latest,FIRECRAWL_URL=FIRECRAWL_URL:latest,DAYTONA_API_KEY=DAYTONA_API_KEY:latest,DAYTONA_SERVER_URL=DAYTONA_SERVER_URL:latest,DAYTONA_TARGET=DAYTONA_TARGET:latest,LANGFUSE_PUBLIC_KEY=LANGFUSE_PUBLIC_KEY:latest,LANGFUSE_SECRET_KEY=LANGFUSE_SECRET_KEY:latest,LANGFUSE_HOST=LANGFUSE_HOST:latest,FREESTYLE_API_KEY=FREESTYLE_API_KEY:latest,FEATURE_FLAGS_ENABLED=FEATURE_FLAGS_ENABLED:latest,PIPEDREAM_CLIENT_ID=PIPEDREAM_CLIENT_ID:latest,PIPEDREAM_CLIENT_SECRET=PIPEDREAM_CLIENT_SECRET:latest,PIPEDREAM_PROJECT_ID=PIPEDREAM_PROJECT_ID:latest,PIPEDREAM_X_PD_ENVIRONMENT=PIPEDREAM_X_PD_ENVIRONMENT:latest,SMITHERY_API_KEY=SMITHERY_API_KEY:latest,MCP_CREDENTIAL_ENCRYPTION_KEY=MCP_CREDENTIAL_ENCRYPTION_KEY:latest,GOOGLE_API_KEY=GOOGLE_API_KEY:latest" --memory 2Gi --cpu 1 --concurrency 100 --timeout 900 --max-instances 10 --min-instances 1 --port 8000
```

## 6. Deploy Worker Service

```powershell
gcloud run deploy cheatcode-workers-service --image gcr.io/PROJECT_ID/backend-api:latest --platform managed --region asia-south1 --no-allow-unauthenticated --set-secrets "ENV_MODE=ENV_MODE:latest,UPSTASH_REDIS_REST_URL=UPSTASH_REDIS_REST_URL:latest,UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest,REDIS_URL=REDIS_URL:latest,SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest,MORPH_API_KEY=MORPH_API_KEY:latest,MODEL_TO_USE=MODEL_TO_USE:latest,CLERK_SECRET_KEY=CLERK_SECRET_KEY:latest,CLERK_DOMAIN=CLERK_DOMAIN:latest,DODO_PAYMENTS_API_KEY=DODO_PAYMENTS_API_KEY:latest,DODO_PAYMENTS_WEBHOOK_SECRET=DODO_PAYMENTS_WEBHOOK_SECRET:latest,TAVILY_API_KEY=TAVILY_API_KEY:latest,FIRECRAWL_API_KEY=FIRECRAWL_API_KEY:latest,FIRECRAWL_URL=FIRECRAWL_URL:latest,DAYTONA_API_KEY=DAYTONA_API_KEY:latest,DAYTONA_SERVER_URL=DAYTONA_SERVER_URL:latest,DAYTONA_TARGET=DAYTONA_TARGET:latest,LANGFUSE_PUBLIC_KEY=LANGFUSE_PUBLIC_KEY:latest,LANGFUSE_SECRET_KEY=LANGFUSE_SECRET_KEY:latest,LANGFUSE_HOST=LANGFUSE_HOST:latest,FREESTYLE_API_KEY=FREESTYLE_API_KEY:latest,FEATURE_FLAGS_ENABLED=FEATURE_FLAGS_ENABLED:latest,PIPEDREAM_CLIENT_ID=PIPEDREAM_CLIENT_ID:latest,PIPEDREAM_CLIENT_SECRET=PIPEDREAM_CLIENT_SECRET:latest,PIPEDREAM_PROJECT_ID=PIPEDREAM_PROJECT_ID:latest,PIPEDREAM_X_PD_ENVIRONMENT=PIPEDREAM_X_PD_ENVIRONMENT:latest,SMITHERY_API_KEY=SMITHERY_API_KEY:latest,MCP_CREDENTIAL_ENCRYPTION_KEY=MCP_CREDENTIAL_ENCRYPTION_KEY:latest,GOOGLE_API_KEY=GOOGLE_API_KEY:latest" --memory 2Gi --cpu 2 --concurrency 100 --max-instances 5 --min-instances 1 --no-cpu-throttling --port 8080 --command="uv" --args="run,python,worker_service.py"
```

## 7. Test Deployment

```powershell
# Test API health
Invoke-WebRequest -Uri "https://cheatcode-api-PROJECT_NUMBER.asia-south1.run.app/api/health" -Method GET

# Test Worker health
Invoke-WebRequest -Uri "https://cheatcode-workers-service-PROJECT_NUMBER.asia-south1.run.app/health" -Method GET
```

## Common Project Variables

- **PROJECT_ID**: `cheatcode-backend`
- **PROJECT_NUMBER**: Get from `gcloud projects describe PROJECT_ID --format="value(projectNumber)"`
- **Region**: `asia-south1`

## Required Code Files

Ensure these files exist in `backend/`:
- `worker_service.py` (FastAPI wrapper for Dramatiq workers)
- `run_agent_background.py` (Redis SSL: `"ssl": True` for Dramatiq)
- `services/redis.py` (Redis SSL: `"connection_class": redis.SSLConnection`)
- `utils/config.py` (Make `RAPID_API_KEY: Optional[str] = None`)
- `services/dodopayments.py` (Dynamic environment: `"live_mode" if ENV_MODE == "production" else "test_mode"`)

## Service URLs
- **API**: `https://cheatcode-api-PROJECT_NUMBER.asia-south1.run.app`
- **Workers**: `https://cheatcode-workers-service-PROJECT_NUMBER.asia-south1.run.app` (health check only)

---
*Replace PROJECT_ID and PROJECT_NUMBER with your actual values*
