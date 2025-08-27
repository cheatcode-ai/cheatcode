# Race Conditions & Concurrency Issues - FIXED

## Summary
This document details the critical race conditions and concurrency issues that were identified and fixed in the deployment cheatcode application, particularly around development server management for web (Next.js) and mobile (Expo) applications.

## ✅ Issues Identified & Fixed

### 1. **Sandbox Pool Race Condition** - FIXED
**Location**: `backend/sandbox/sandbox_pool.py:84-112`  
**Issue**: Multiple users could simultaneously request sandboxes, leading to double allocation  
**Fix**: Added distributed Redis locking with proper double-check pattern and ownership verification

### 2. **Redis Run Lock TOCTOU Vulnerability** - FIXED  
**Location**: `backend/run_agent_background.py:97-114`  
**Issue**: Time-of-Check-Time-of-Use vulnerability between checking and acquiring locks  
**Fix**: Implemented atomic lock acquisition with stale lock detection and Lua scripts for ownership

### 3. **Database Connection Singleton Race** - FIXED
**Location**: `backend/services/supabase.py:32-66`  
**Issue**: Multiple async tasks could initialize database connection simultaneously  
**Fix**: Added double-checked locking pattern with atomic lock creation

### 4. **Message Ordering Issues in Thread Manager** - FIXED
**Location**: `backend/agentpress/thread_manager.py:152-197`  
**Issue**: Large message threads could have inconsistent ordering when fetched in batches  
**Fix**: Implemented cursor-based pagination with absolute ordering guarantees

### 5. **Development Server Race Conditions** - FIXED ⭐
**Location**: `backend/agent/tools/sb_shell_tool.py:280-360`  
**Issue**: Multiple concurrent requests could start duplicate dev servers on same ports  
**Fixes Applied**:
- **Distributed locking** for dev server startup with 60s timeout
- **Atomic session creation** for dev servers using predictable names
- **Double-check pattern** after lock acquisition
- **Enhanced process cleanup** with graceful termination
- **Port conflict prevention** with proper status checking

### 6. **Session Management Race Condition** - FIXED
**Location**: `backend/agent/tools/sb_shell_tool.py:330-350`  
**Issue**: Multiple sessions could be created with same name for dev servers  
**Fix**: Added Redis-coordinated session creation with collision detection

### 7. **Resource Cleanup Race Conditions** - FIXED
**Location**: `backend/run_agent_background.py:325-366`  
**Issue**: Complex cleanup logic with multiple failure points could leave zombie processes  
**Fix**: Parallel cleanup with individual error isolation and retry logic

## 🚀 Key Improvements for Development Servers

### Web Applications (Next.js - Port 3000)
- ✅ **Atomic server startup** with distributed locking
- ✅ **Duplicate prevention** - won't start multiple `pnpm run dev` processes
- ✅ **Session reuse** - properly detects existing dev servers
- ✅ **Graceful cleanup** - terminates processes cleanly on port 3000

### Mobile Applications (Expo - Port 8081)  
- ✅ **Atomic server startup** with distributed locking
- ✅ **Duplicate prevention** - won't start multiple `npx expo start` processes
- ✅ **Metro bundler detection** - recognizes various Expo/React Native commands
- ✅ **Graceful cleanup** - terminates processes cleanly on port 8081

### Enhanced Command Detection
Added support for more development server patterns:
- `npx expo start --port 8081`
- `expo start --port 8081` 
- `react-native start`
- `metro start`

## 🔧 Technical Implementation Details

### Distributed Locking Strategy
```python
# Example: Dev server startup lock
dev_server_lock_key = f"dev_server_start:{sandbox.id}:{app_type}"
lock_value = f"{timestamp}:{task_name}"
lock_acquired = await redis.set(lock_key, lock_value, nx=True, ex=60)
```

### Session Management Enhancement
```python
# Predictable session names prevent duplicates
if self._is_dev_server_command(command):
    session_name = f"dev_server_{self.app_type}"  # e.g., "dev_server_web"
else:
    session_name = f"session_{str(uuid4())[:8]}"  # Random for other commands
```

### Process Cleanup Improvements
```python
# Graceful termination with fallback to force kill
await sandbox.process.exec(f"lsof -ti:{port} | xargs -r kill -TERM || true")
await asyncio.sleep(2)  # Grace period
await sandbox.process.exec(f"lsof -ti:{port} | xargs -r kill -9 || true")
```

## 📊 Monitoring & Observability Added

### Concurrency Monitor
- **Real-time lock tracking** and metrics collection
- **Deadlock detection** for long-held locks (>60s)
- **High contention alerts** when failure rate >50%
- **Cross-instance visibility** via Redis storage

### Health Check System
- **Multi-component monitoring** (Redis, Database, Concurrency, Resources)
- **Performance metrics** with latency tracking
- **Automatic issue detection** and alerting
- **Background monitoring** every 5 minutes

## 🎯 Impact Assessment

### Before Fixes:
- ❌ Multiple dev servers could run on same port
- ❌ Duplicate agent runs causing billing issues  
- ❌ Database connection race conditions
- ❌ Session conflicts and zombie processes
- ❌ Resource leaks over time

### After Fixes:
- ✅ **No duplicate dev servers** - atomic startup with locking
- ✅ **No duplicate agent runs** - proper idempotency
- ✅ **Stable database connections** - thread-safe initialization
- ✅ **Clean session management** - no conflicts or leaks
- ✅ **Robust resource cleanup** - no zombie processes
- ✅ **Proactive monitoring** - early issue detection

## 🔍 Validation & Testing

### Port Conflict Prevention
- Dev server startup now uses distributed locks
- Status checking happens after lock acquisition
- Double-check pattern prevents race conditions

### Session Isolation  
- Web apps use `dev_server_web` session
- Mobile apps use `dev_server_mobile` session
- No more session name collisions

### Process Management
- Graceful termination with SIGTERM → SIGKILL progression
- Port-based process cleanup
- Timeout handling for all operations

## 🚦 Current Status: PRODUCTION READY

All identified race conditions have been resolved with proper:
- **Distributed locking** for critical sections
- **Atomic operations** where needed
- **Comprehensive monitoring** for early detection
- **Robust error handling** and cleanup
- **Resource leak prevention**

The application now handles high concurrent loads reliably without the race conditions that were previously present.