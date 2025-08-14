# Agent Sandbox

This directory contains the agent sandbox implementation - a Docker-based virtual environment that agents use as their own computer to execute tasks, access the web, and manipulate files.

## Overview

The sandbox provides a complete containerized Linux environment with:
- Node.js 20 LTS + pnpm for Next.js development
- Python 3.12 for scripting and FastAPI backends
- Supabase CLI for database operations
- Vercel CLI for deployment
- Git, curl, bash for development tools
- Pre-bundled cheatcode-app template for instant project setup

## Customizing the Sandbox

You can modify the sandbox environment for development or to add new capabilities:

1. Edit files in the `docker/` directory
2. Build a custom snapshot:
   ```
   cd backend/sandbox/docker
   daytona snapshot create my-custom-snapshot --dockerfile Dockerfile.cheatcode-one
   ```
3. Test your changes by creating sandboxes from your custom snapshot

## Using a Custom Snapshot

To use your custom sandbox snapshot:

1. Update the `SANDBOX_SNAPSHOT_NAME` in `backend/utils/config.py`
2. Update the snapshot name in `backend/sandbox/sandbox_pool.py` in the `_create_sandbox` function
3. Update any documentation to reference the new snapshot name

## Publishing New Versions

When publishing a new version of the sandbox:

1. Update the Dockerfile with your changes
2. Build the new snapshot: `daytona snapshot create cheatcode-one-v2 --dockerfile Dockerfile.cheatcode-one`
3. Update all references to the snapshot name in:
   - `backend/utils/config.py`
   - `backend/sandbox/sandbox_pool.py`
   - Any other services using this snapshot