"""
Concurrency monitoring and race condition detection utilities.
"""

import asyncio
import time
import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from collections import defaultdict, deque
from utils.logger import logger
from services import redis

@dataclass
class ConcurrencyEvent:
    """Represents a concurrency-related event for monitoring."""
    event_type: str
    resource_id: str
    operation: str
    timestamp: float
    instance_id: str
    thread_id: str
    metadata: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

class ConcurrencyMonitor:
    """Monitor and detect potential race conditions and concurrency issues."""
    
    def __init__(self, instance_id: str):
        self.instance_id = instance_id
        self.events: deque = deque(maxlen=1000)  # Keep last 1000 events
        self.lock_metrics: Dict[str, Dict] = defaultdict(lambda: {
            'acquisitions': 0,
            'failures': 0,
            'avg_hold_time': 0.0,
            'max_hold_time': 0.0,
            'last_acquisition': None
        })
        self.active_locks: Dict[str, float] = {}  # lock_key -> acquisition_time
        
    async def record_lock_acquisition(
        self, 
        lock_key: str, 
        operation: str, 
        metadata: Optional[Dict] = None
    ) -> None:
        """Record a successful lock acquisition."""
        now = time.time()
        thread_id = asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'
        
        event = ConcurrencyEvent(
            event_type='lock_acquired',
            resource_id=lock_key,
            operation=operation,
            timestamp=now,
            instance_id=self.instance_id,
            thread_id=thread_id,
            metadata=metadata or {}
        )
        
        self.events.append(event)
        self.active_locks[lock_key] = now
        self.lock_metrics[lock_key]['acquisitions'] += 1
        self.lock_metrics[lock_key]['last_acquisition'] = now
        
        # Store in Redis for cross-instance visibility
        try:
            await redis.set(
                f"concurrency_event:{self.instance_id}:{int(now * 1000)}",
                json.dumps(event.to_dict()),
                ex=3600  # Keep for 1 hour
            )
        except Exception as e:
            logger.warning(f"Failed to store concurrency event in Redis: {e}")
    
    async def record_lock_release(
        self, 
        lock_key: str, 
        operation: str, 
        metadata: Optional[Dict] = None
    ) -> None:
        """Record a lock release and calculate hold time."""
        now = time.time()
        thread_id = asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'
        
        # Calculate hold time if we have the acquisition time
        hold_time = None
        if lock_key in self.active_locks:
            hold_time = now - self.active_locks[lock_key]
            del self.active_locks[lock_key]
            
            # Update metrics
            metrics = self.lock_metrics[lock_key]
            if hold_time > metrics['max_hold_time']:
                metrics['max_hold_time'] = hold_time
            
            # Update average (simple moving average)
            if metrics['avg_hold_time'] == 0:
                metrics['avg_hold_time'] = hold_time
            else:
                metrics['avg_hold_time'] = (metrics['avg_hold_time'] + hold_time) / 2
        
        event_metadata = metadata or {}
        if hold_time:
            event_metadata['hold_time_seconds'] = hold_time
            
        event = ConcurrencyEvent(
            event_type='lock_released',
            resource_id=lock_key,
            operation=operation,
            timestamp=now,
            instance_id=self.instance_id,
            thread_id=thread_id,
            metadata=event_metadata
        )
        
        self.events.append(event)
        
        # Log long-held locks
        if hold_time and hold_time > 30.0:  # More than 30 seconds
            logger.warning(f"Long-held lock detected: {lock_key} held for {hold_time:.2f}s")
    
    async def record_lock_failure(
        self, 
        lock_key: str, 
        operation: str, 
        reason: str,
        metadata: Optional[Dict] = None
    ) -> None:
        """Record a failed lock acquisition."""
        now = time.time()
        thread_id = asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'
        
        event_metadata = metadata or {}
        event_metadata['failure_reason'] = reason
        
        event = ConcurrencyEvent(
            event_type='lock_failed',
            resource_id=lock_key,
            operation=operation,
            timestamp=now,
            instance_id=self.instance_id,
            thread_id=thread_id,
            metadata=event_metadata
        )
        
        self.events.append(event)
        self.lock_metrics[lock_key]['failures'] += 1
        
        logger.warning(f"Lock acquisition failed: {lock_key} for {operation} - {reason}")
    
    async def cleanup_stale_in_memory_locks(self, redis_client, max_age: int = 300) -> int:
        """
        Clean up in-memory lock tracking for locks that no longer exist in Redis.
        This handles cases where locks were released but record_lock_release was never called.
        """
        if not self.active_locks:
            return 0

        cleaned = 0
        now = time.time()
        locks_to_remove = []

        for lock_key, acquisition_time in list(self.active_locks.items()):
            age = now - acquisition_time

            # Only check locks older than max_age
            if age > max_age:
                try:
                    # Check if lock still exists in Redis
                    exists = await redis_client.exists(lock_key)
                    if not exists:
                        locks_to_remove.append(lock_key)
                        logger.info(f"Removing stale in-memory lock tracking: {lock_key} (age: {age:.0f}s, no longer in Redis)")
                except Exception as e:
                    logger.warning(f"Error checking Redis for lock {lock_key}: {e}")

        # Remove stale entries
        for lock_key in locks_to_remove:
            if lock_key in self.active_locks:
                del self.active_locks[lock_key]
                cleaned += 1

        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} stale in-memory lock entries")

        return cleaned

    async def detect_potential_deadlocks(self) -> List[Dict]:
        """Detect potential deadlock situations."""
        deadlocks = []
        now = time.time()

        # Look for locks held longer than 60 seconds
        for lock_key, acquisition_time in self.active_locks.items():
            if now - acquisition_time > 60:
                deadlocks.append({
                    'type': 'potential_deadlock',
                    'lock_key': lock_key,
                    'held_duration': now - acquisition_time,
                    'instance_id': self.instance_id
                })
        
        # Look for high contention (many failures)
        for lock_key, metrics in self.lock_metrics.items():
            if metrics['failures'] > 10:  # More than 10 failures
                failure_rate = metrics['failures'] / max(1, metrics['acquisitions'])
                if failure_rate > 0.5:  # More than 50% failure rate
                    deadlocks.append({
                        'type': 'high_contention',
                        'lock_key': lock_key,
                        'failure_rate': failure_rate,
                        'total_failures': metrics['failures'],
                        'instance_id': self.instance_id
                    })
        
        return deadlocks
    
    async def get_metrics(self) -> Dict[str, Any]:
        """Get comprehensive concurrency metrics."""
        now = time.time()
        
        # Detect potential issues
        deadlocks = await self.detect_potential_deadlocks()
        
        # Recent events (last 5 minutes)
        recent_events = [
            event for event in self.events 
            if now - event.timestamp < 300
        ]
        
        # Active locks
        active_lock_info = {}
        for lock_key, acquisition_time in self.active_locks.items():
            active_lock_info[lock_key] = {
                'held_duration': now - acquisition_time,
                'acquired_at': acquisition_time
            }
        
        return {
            'instance_id': self.instance_id,
            'timestamp': now,
            'active_locks': len(self.active_locks),
            'active_lock_details': active_lock_info,
            'total_events': len(self.events),
            'recent_events_5min': len(recent_events),
            'lock_metrics': dict(self.lock_metrics),
            'potential_issues': deadlocks,
            'health_status': 'healthy' if not deadlocks else 'warning'
        }
    
    async def log_metrics_summary(self) -> None:
        """Log a summary of concurrency metrics."""
        metrics = await self.get_metrics()
        
        if metrics['potential_issues']:
            logger.warning(f"Concurrency issues detected: {len(metrics['potential_issues'])} potential problems")
            for issue in metrics['potential_issues']:
                logger.warning(f"  - {issue['type']}: {issue}")
        else:
            logger.info(f"Concurrency health: {metrics['active_locks']} active locks, {metrics['recent_events_5min']} recent events")

# Global monitor instance
_monitor: Optional[ConcurrencyMonitor] = None

def get_monitor(instance_id: str) -> ConcurrencyMonitor:
    """Get or create the global concurrency monitor."""
    global _monitor
    if _monitor is None:
        _monitor = ConcurrencyMonitor(instance_id)
    return _monitor

async def monitored_lock(
    lock_key: str, 
    operation: str, 
    redis_client,
    lock_value: str,
    timeout: int = 30,
    metadata: Optional[Dict] = None
) -> bool:
    """
    Acquire a Redis lock with monitoring.
    
    Args:
        lock_key: Redis key for the lock
        operation: Description of the operation requiring the lock
        redis_client: Redis client instance
        lock_value: Unique value for the lock
        timeout: Lock timeout in seconds
        metadata: Additional metadata to record
    
    Returns:
        True if lock was acquired, False otherwise
    """
    monitor = get_monitor('unknown')  # Will be set properly by the caller
    
    try:
        acquired = await redis_client.set(lock_key, lock_value, nx=True, ex=timeout)
        
        if acquired:
            await monitor.record_lock_acquisition(lock_key, operation, metadata)
            return True
        else:
            await monitor.record_lock_failure(lock_key, operation, "already_locked", metadata)
            return False
            
    except Exception as e:
        await monitor.record_lock_failure(lock_key, operation, f"redis_error: {e}", metadata)
        raise

async def monitored_lock_release(
    lock_key: str,
    operation: str,
    redis_client,
    lock_value: str,
    metadata: Optional[Dict] = None
) -> bool:
    """
    Release a Redis lock with monitoring.
    
    Args:
        lock_key: Redis key for the lock
        operation: Description of the operation
        redis_client: Redis client instance
        lock_value: Expected lock value (for ownership verification)
        metadata: Additional metadata to record
    
    Returns:
        True if lock was released, False if not owned
    """
    monitor = get_monitor('unknown')  # Will be set properly by the caller
    
    try:
        # Enhanced Lua script for atomic release with prefix-based ownership check
        # This handles cases where lock_value might be a prefix (like "instance_id:")
        release_script = """
        local current_value = redis.call('GET', KEYS[1])
        if current_value then
            -- Check for exact match first
            if current_value == ARGV[1] then
                return redis.call('DEL', KEYS[1])
            end
            -- Check if current value starts with our prefix (for partial matches)
            if string.len(ARGV[1]) > 0 and string.find(current_value, ARGV[1]) == 1 then
                return redis.call('DEL', KEYS[1])
            end
        end
        return 0
        """
        
        result = await redis_client.eval(release_script, 1, lock_key, lock_value)
        
        if result:
            await monitor.record_lock_release(lock_key, operation, metadata)
            return True
        else:
            # Get current value for better debugging
            current_value = await redis_client.get(lock_key)
            logger.warning(f"Attempted to release lock {lock_key} but not owned by this process. Current: {current_value}, Expected: {lock_value}")
            return False
            
    except Exception as e:
        logger.error(f"Error releasing lock {lock_key}: {e}")
        raise

# Background monitoring task
async def start_monitoring_task(instance_id: str, interval: int = 300):
    """Start a background task to periodically log concurrency metrics."""
    monitor = get_monitor(instance_id)
    
    while True:
        try:
            await asyncio.sleep(interval)
            await monitor.log_metrics_summary()
        except asyncio.CancelledError:
            logger.info("Concurrency monitoring task cancelled")
            break
        except Exception as e:
            logger.error(f"Error in concurrency monitoring task: {e}")
            await asyncio.sleep(60)  # Wait before retrying

async def cleanup_stale_locks(redis_client, max_lock_age: int = 300):
    """Clean up stale locks that weren't properly released."""
    try:
        # Scan for agent_run_lock patterns
        cursor = 0
        stale_locks_cleaned = 0
        
        while True:
            cursor, keys = await redis_client.scan(cursor=cursor, match="agent_run_lock:*", count=100)
            
            if keys:
                # Use pipeline for efficient batch operations
                pipe = redis_client.pipeline()
                for key in keys:
                    # Get lock value to extract timestamp
                    pipe.get(key)
                
                values = await pipe.execute()
                
                # Check each lock for staleness
                current_time = int(time.time())
                stale_keys = []
                
                for i, value in enumerate(values):
                    if value:
                        try:
                            # Decode bytes to string if needed
                            if isinstance(value, bytes):
                                value = value.decode('utf-8')
                            # Lock value format: instance_id:timestamp
                            parts = value.split(':')
                            if len(parts) >= 2:
                                lock_timestamp = int(parts[1])
                                age = current_time - lock_timestamp

                                if age > max_lock_age:
                                    stale_keys.append((keys[i], age))
                        except (ValueError, IndexError):
                            # Invalid lock format, consider it stale
                            stale_keys.append((keys[i], max_lock_age + 1))
                
                # Delete stale locks
                if stale_keys:
                    delete_pipe = redis_client.pipeline()
                    for key, age in stale_keys:
                        delete_pipe.delete(key)
                        logger.warning(f"Cleaning up stale lock: {key} (age: {age}s)")
                    
                    await delete_pipe.execute()
                    stale_locks_cleaned += len(stale_keys)
            
            if cursor == 0:  # Scan complete
                break
        
        if stale_locks_cleaned > 0:
            logger.info(f"Cleaned up {stale_locks_cleaned} stale locks")
        
        return stale_locks_cleaned
        
    except Exception as e:
        logger.error(f"Error during stale lock cleanup: {e}")
        return 0

async def start_stale_lock_cleanup_task(redis_client, interval: int = 60, max_lock_age: int = 300):
    """Start background task to periodically clean up stale locks (both Redis and in-memory)."""
    logger.info(f"Starting stale lock cleanup task (interval: {interval}s, max_age: {max_lock_age}s)")

    # Run immediate cleanup on startup to clear existing stale locks
    try:
        logger.info("Running immediate stale lock cleanup on startup...")
        redis_cleaned = await cleanup_stale_locks(redis_client, max_lock_age)
        if redis_cleaned > 0:
            logger.info(f"Startup cleanup: removed {redis_cleaned} stale Redis locks")

        # Also clean up in-memory tracking
        monitor = get_monitor('single')  # Use same instance ID as run_agent_background
        memory_cleaned = await monitor.cleanup_stale_in_memory_locks(redis_client, max_lock_age)
        if memory_cleaned > 0:
            logger.info(f"Startup cleanup: removed {memory_cleaned} stale in-memory lock entries")
    except Exception as e:
        logger.error(f"Error during startup stale lock cleanup: {e}")

    while True:
        try:
            await asyncio.sleep(interval)
            # Clean up both Redis and in-memory stale locks
            await cleanup_stale_locks(redis_client, max_lock_age)

            # Clean up stale in-memory tracking entries
            monitor = get_monitor('single')
            await monitor.cleanup_stale_in_memory_locks(redis_client, max_lock_age)
        except asyncio.CancelledError:
            logger.info("Stale lock cleanup task cancelled")
            break
        except Exception as e:
            logger.error(f"Error in stale lock cleanup task: {e}")
            await asyncio.sleep(30)  # Shorter wait for cleanup task