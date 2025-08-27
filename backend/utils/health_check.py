"""
Health check utilities for monitoring system health and detecting issues.
"""

import asyncio
import time
import json
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta
from utils.logger import logger
from services import redis
from services.supabase import DBConnection

@dataclass
class HealthStatus:
    """Represents the health status of a system component."""
    component: str
    status: str  # 'healthy', 'warning', 'critical', 'unknown'
    message: str
    timestamp: float
    details: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'component': self.component,
            'status': self.status,
            'message': self.message,
            'timestamp': self.timestamp,
            'details': self.details
        }

class HealthChecker:
    """System health monitoring and diagnostic utilities."""
    
    def __init__(self, instance_id: str):
        self.instance_id = instance_id
        self.last_check = {}
        
    async def check_redis_health(self) -> HealthStatus:
        """Check Redis connection and performance."""
        start_time = time.time()
        
        try:
            # Test basic connectivity
            await redis.ping()
            
            # Test read/write operations
            test_key = f"health_check:{self.instance_id}:{int(time.time())}"
            test_value = "health_test"
            
            # Write test
            write_start = time.time()
            await redis.set(test_key, test_value, ex=60)
            write_time = time.time() - write_start
            
            # Read test
            read_start = time.time()
            retrieved_value = await redis.get(test_key)
            read_time = time.time() - read_start
            
            # Cleanup
            await redis.delete(test_key)
            
            total_time = time.time() - start_time
            
            # Determine health status
            if write_time > 1.0 or read_time > 1.0:
                status = 'warning'
                message = 'Redis operations are slow'
            elif retrieved_value != test_value:
                status = 'critical'
                message = 'Redis read/write integrity issue'
            else:
                status = 'healthy'
                message = 'Redis operations normal'
            
            return HealthStatus(
                component='redis',
                status=status,
                message=message,
                timestamp=time.time(),
                details={
                    'write_time_ms': round(write_time * 1000, 2),
                    'read_time_ms': round(read_time * 1000, 2),
                    'total_time_ms': round(total_time * 1000, 2),
                    'connectivity': 'ok'
                }
            )
            
        except Exception as e:
            return HealthStatus(
                component='redis',
                status='critical',
                message=f'Redis health check failed: {str(e)}',
                timestamp=time.time(),
                details={'error': str(e), 'connectivity': 'failed'}
            )
    
    async def check_database_health(self) -> HealthStatus:
        """Check database connection and performance."""
        start_time = time.time()
        
        try:
            db = DBConnection()
            client = await db.get_client()
            
            # Test basic query
            query_start = time.time()
            result = await client.table('threads').select('thread_id').limit(1).execute()
            query_time = time.time() - query_start
            
            total_time = time.time() - start_time
            
            # Determine health status
            if query_time > 2.0:
                status = 'warning'
                message = 'Database queries are slow'
            elif not hasattr(result, 'data'):
                status = 'critical'
                message = 'Database query returned unexpected result'
            else:
                status = 'healthy'
                message = 'Database operations normal'
            
            return HealthStatus(
                component='database',
                status=status,
                message=message,
                timestamp=time.time(),
                details={
                    'query_time_ms': round(query_time * 1000, 2),
                    'total_time_ms': round(total_time * 1000, 2),
                    'connectivity': 'ok'
                }
            )
            
        except Exception as e:
            return HealthStatus(
                component='database',
                status='critical',
                message=f'Database health check failed: {str(e)}',
                timestamp=time.time(),
                details={'error': str(e), 'connectivity': 'failed'}
            )
    
    async def check_concurrency_health(self) -> HealthStatus:
        """Check for concurrency issues and race conditions."""
        try:
            from utils.concurrency_monitor import get_monitor
            monitor = get_monitor(self.instance_id)
            metrics = await monitor.get_metrics()
            
            # Analyze metrics for health
            active_locks = metrics['active_locks']
            potential_issues = len(metrics['potential_issues'])
            
            if potential_issues > 0:
                status = 'warning' if potential_issues < 3 else 'critical'
                message = f'{potential_issues} potential concurrency issues detected'
            elif active_locks > 20:  # Too many active locks might indicate issues
                status = 'warning'
                message = f'High number of active locks: {active_locks}'
            else:
                status = 'healthy'
                message = 'No concurrency issues detected'
            
            return HealthStatus(
                component='concurrency',
                status=status,
                message=message,
                timestamp=time.time(),
                details={
                    'active_locks': active_locks,
                    'potential_issues': potential_issues,
                    'recent_events': metrics['recent_events_5min']
                }
            )
            
        except Exception as e:
            return HealthStatus(
                component='concurrency',
                status='unknown',
                message=f'Concurrency health check failed: {str(e)}',
                timestamp=time.time(),
                details={'error': str(e)}
            )
    
    async def check_system_resources(self) -> HealthStatus:
        """Check system resource usage."""
        try:
            import psutil
            
            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=1)
            
            # Memory usage
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            
            # Disk usage (current directory)
            disk = psutil.disk_usage('.')
            disk_percent = (disk.used / disk.total) * 100
            
            # Determine health status
            if cpu_percent > 90 or memory_percent > 90 or disk_percent > 90:
                status = 'critical'
                message = 'High resource usage detected'
            elif cpu_percent > 70 or memory_percent > 70 or disk_percent > 80:
                status = 'warning'
                message = 'Elevated resource usage'
            else:
                status = 'healthy'
                message = 'Resource usage normal'
            
            return HealthStatus(
                component='system_resources',
                status=status,
                message=message,
                timestamp=time.time(),
                details={
                    'cpu_percent': cpu_percent,
                    'memory_percent': memory_percent,
                    'disk_percent': disk_percent,
                    'available_memory_gb': round(memory.available / (1024**3), 2)
                }
            )
            
        except ImportError:
            return HealthStatus(
                component='system_resources',
                status='unknown',
                message='psutil not available for resource monitoring',
                timestamp=time.time(),
                details={'error': 'psutil_not_installed'}
            )
        except Exception as e:
            return HealthStatus(
                component='system_resources',
                status='unknown',
                message=f'Resource check failed: {str(e)}',
                timestamp=time.time(),
                details={'error': str(e)}
            )
    
    async def run_comprehensive_health_check(self) -> Dict[str, Any]:
        """Run all health checks and return comprehensive status."""
        logger.info(f"Running comprehensive health check for instance {self.instance_id}")
        
        # Run all checks concurrently
        checks = await asyncio.gather(
            self.check_redis_health(),
            self.check_database_health(),
            self.check_concurrency_health(),
            self.check_system_resources(),
            return_exceptions=True
        )
        
        results = {}
        overall_status = 'healthy'
        critical_issues = []
        warnings = []
        
        check_names = ['redis', 'database', 'concurrency', 'system_resources']
        
        for i, check_result in enumerate(checks):
            component = check_names[i]
            
            if isinstance(check_result, Exception):
                results[component] = HealthStatus(
                    component=component,
                    status='unknown',
                    message=f'Health check failed: {str(check_result)}',
                    timestamp=time.time(),
                    details={'error': str(check_result)}
                ).to_dict()
                warnings.append(f'{component}: health check failed')
            else:
                results[component] = check_result.to_dict()
                
                if check_result.status == 'critical':
                    overall_status = 'critical'
                    critical_issues.append(f'{component}: {check_result.message}')
                elif check_result.status == 'warning' and overall_status != 'critical':
                    overall_status = 'warning'
                    warnings.append(f'{component}: {check_result.message}')
        
        # Store results in Redis for monitoring
        try:
            health_key = f"health_status:{self.instance_id}"
            health_data = {
                'instance_id': self.instance_id,
                'timestamp': time.time(),
                'overall_status': overall_status,
                'components': results,
                'critical_issues': critical_issues,
                'warnings': warnings
            }
            
            await redis.set(health_key, json.dumps(health_data), ex=300)  # 5 minute TTL
        except Exception as e:
            logger.warning(f"Failed to store health status in Redis: {e}")
        
        # Log summary
        if overall_status == 'critical':
            logger.error(f"Health check CRITICAL: {', '.join(critical_issues)}")
        elif overall_status == 'warning':
            logger.warning(f"Health check WARNING: {', '.join(warnings)}")
        else:
            logger.info(f"Health check HEALTHY: All systems operational")
        
        return {
            'instance_id': self.instance_id,
            'timestamp': time.time(),
            'overall_status': overall_status,
            'components': results,
            'critical_issues': critical_issues,
            'warnings': warnings
        }

# Global health checker
_health_checker: Optional[HealthChecker] = None

def get_health_checker(instance_id: str) -> HealthChecker:
    """Get or create the global health checker."""
    global _health_checker
    if _health_checker is None:
        _health_checker = HealthChecker(instance_id)
    return _health_checker

async def start_health_monitoring(instance_id: str, interval: int = 300):
    """Start periodic health monitoring."""
    health_checker = get_health_checker(instance_id)
    
    logger.info(f"Starting health monitoring for instance {instance_id} (interval: {interval}s)")
    
    while True:
        try:
            await health_checker.run_comprehensive_health_check()
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("Health monitoring task cancelled")
            break
        except Exception as e:
            logger.error(f"Error in health monitoring: {e}")
            await asyncio.sleep(60)  # Wait before retrying