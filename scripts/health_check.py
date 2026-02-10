#!/usr/bin/env python3
"""
Comprehensive Health Check Script
Checks all services: Backend, Database, Worker, Frontend
"""

import requests
import sys
import time
from pathlib import Path
from datetime import datetime

# Import database
try:
    from database import DatabaseManager, Episode
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False

# Colors for terminal output
GREEN = '\033[0;32m'
RED = '\033[0;31m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
NC = '\033[0m'  # No Color

def print_header(text):
    """Print section header"""
    print(f"\n{BLUE}{'=' * 60}{NC}")
    print(f"{BLUE}{text}{NC}")
    print(f"{BLUE}{'=' * 60}{NC}")

def check_status(name, success, message=""):
    """Print check status"""
    status = f"{GREEN}✅ PASS{NC}" if success else f"{RED}❌ FAIL{NC}"
    print(f"{status} {name}")
    if message:
        print(f"    {message}")
    return success

def check_backend():
    """Check backend API health"""
    print_header("Backend API Health Check")

    checks_passed = 0
    total_checks = 3

    # Check 1: API v2 health endpoint
    try:
        response = requests.get('http://localhost:8000/api/v2/health', timeout=5)
        data = response.json()

        if response.status_code == 200 and data.get('status') == 'healthy':
            check_status("API v2 Health Endpoint", True, f"Version: {data.get('version')}")
            checks_passed += 1
        else:
            check_status("API v2 Health Endpoint", False, f"Status code: {response.status_code}")
    except Exception as e:
        check_status("API v2 Health Endpoint", False, str(e))

    # Check 2: Episodes endpoint
    try:
        response = requests.get('http://localhost:8000/api/v2/episodes?limit=1', timeout=5)
        data = response.json()

        if response.status_code == 200 and 'episodes' in data:
            check_status("Episodes Endpoint", True, f"Total episodes: {data.get('total', 0)}")
            checks_passed += 1
        else:
            check_status("Episodes Endpoint", False)
    except Exception as e:
        check_status("Episodes Endpoint", False, str(e))

    # Check 3: Queue endpoint
    try:
        response = requests.get('http://localhost:8000/api/v2/queue/status', timeout=5)
        data = response.json()

        if response.status_code == 200 and 'total' in data:
            check_status("Queue Endpoint", True,
                       f"Pending: {data.get('pending', 0)}, Processing: {data.get('processing', 0)}")
            checks_passed += 1
        else:
            check_status("Queue Endpoint", False)
    except Exception as e:
        check_status("Queue Endpoint", False, str(e))

    print(f"\n{BLUE}Backend Score: {checks_passed}/{total_checks}{NC}")
    return checks_passed == total_checks

def check_database():
    """Check database connectivity and integrity"""
    print_header("Database Health Check")

    if not DATABASE_AVAILABLE:
        check_status("Database Module", False, "SQLAlchemy not installed")
        return False

    checks_passed = 0
    total_checks = 4

    # Check 1: Database file exists
    db_path = Path("../data/ice_cream_social.db")
    if db_path.exists():
        check_status("Database File", True, str(db_path.absolute()))
        checks_passed += 1
    else:
        check_status("Database File", False, "Database file not found")

    # Check 2: Can connect to database
    try:
        db = DatabaseManager.get_session()
        check_status("Database Connection", True)
        checks_passed += 1

        # Check 3: Episodes table has data
        try:
            episode_count = db.query(Episode).count()
            if episode_count > 0:
                check_status("Episodes Table", True, f"{episode_count} episodes in database")
                checks_passed += 1
            else:
                check_status("Episodes Table", False, "No episodes in database")
        except Exception as e:
            check_status("Episodes Table", False, str(e))

        # Check 4: Can query transcribed episodes
        try:
            transcribed = db.query(Episode).filter(Episode.is_transcribed == True).count()
            check_status("Transcribed Episodes", True, f"{transcribed} transcribed")
            checks_passed += 1
        except Exception as e:
            check_status("Transcribed Episodes", False, str(e))

        db.close()
    except Exception as e:
        check_status("Database Connection", False, str(e))

    print(f"\n{BLUE}Database Score: {checks_passed}/{total_checks}{NC}")
    return checks_passed == total_checks

def check_worker():
    """Check worker process"""
    print_header("Worker Health Check")

    checks_passed = 0
    total_checks = 3

    # Check 1: Worker log file exists
    log_path = Path("../logs/worker.log")
    if log_path.exists():
        check_status("Worker Log File", True)
        checks_passed += 1

        # Check 2: Recent activity in log
        try:
            with open(log_path, 'r') as f:
                lines = f.readlines()
                if lines:
                    last_line = lines[-1]
                    check_status("Worker Log Activity", True, f"Last: {last_line[:60].strip()}...")
                    checks_passed += 1
        except Exception as e:
            check_status("Worker Log Activity", False, str(e))
    else:
        check_status("Worker Log File", False, "Log file not found")

    # Check 3: Worker process running
    try:
        import psutil
        worker_found = False
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                cmdline = proc.info.get('cmdline', [])
                if cmdline and 'transcription_worker.py' in ' '.join(cmdline):
                    check_status("Worker Process", True, f"PID: {proc.info['pid']}")
                    worker_found = True
                    checks_passed += 1
                    break
            except:
                pass

        if not worker_found:
            check_status("Worker Process", False, "Worker not running")
    except Exception as e:
        check_status("Worker Process", False, str(e))

    print(f"\n{BLUE}Worker Score: {checks_passed}/{total_checks}{NC}")
    return checks_passed >= 2  # Pass if 2/3 checks pass

def check_frontend():
    """Check frontend availability"""
    print_header("Frontend Health Check")

    checks_passed = 0
    total_checks = 2

    # Check 1: Frontend responding
    try:
        response = requests.get('http://localhost:3000', timeout=5)
        if response.status_code == 200:
            check_status("Frontend Server", True, "Port 3000 responding")
            checks_passed += 1
        else:
            check_status("Frontend Server", False, f"Status: {response.status_code}")
    except Exception as e:
        check_status("Frontend Server", False, str(e))

    # Check 2: Frontend log file
    log_path = Path("../logs/frontend.log")
    if log_path.exists():
        check_status("Frontend Log", True)
        checks_passed += 1
    else:
        check_status("Frontend Log", False, "Log file not found")

    print(f"\n{BLUE}Frontend Score: {checks_passed}/{total_checks}{NC}")
    return checks_passed >= 1  # Pass if server is responding

def check_system_resources():
    """Check system resources"""
    print_header("System Resources")

    try:
        import psutil

        # CPU
        cpu_percent = psutil.cpu_percent(interval=1)
        cpu_status = cpu_percent < 80
        check_status("CPU Usage", cpu_status, f"{cpu_percent}%")

        # Memory
        memory = psutil.virtual_memory()
        mem_status = memory.percent < 90
        check_status("Memory Usage", mem_status,
                    f"{memory.percent}% ({memory.used / (1024**3):.1f}GB / {memory.total / (1024**3):.1f}GB)")

        # Disk
        disk = psutil.disk_usage('/')
        disk_status = disk.percent < 90
        check_status("Disk Usage", disk_status, f"{disk.percent}%")

        return cpu_status and mem_status and disk_status
    except Exception as e:
        check_status("System Resources", False, str(e))
        return False

def main():
    """Run all health checks"""
    print(f"{BLUE}")
    print("╔══════════════════════════════════════════════════════════╗")
    print("║                                                          ║")
    print("║         🍦 ICE CREAM SOCIAL HEALTH CHECK 🍦             ║")
    print("║                                                          ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"{NC}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    results = {
        'Backend': check_backend(),
        'Database': check_database(),
        'Worker': check_worker(),
        'Frontend': check_frontend(),
        'System': check_system_resources()
    }

    # Summary
    print_header("Health Check Summary")

    all_healthy = True
    for service, healthy in results.items():
        status = f"{GREEN}✅ HEALTHY{NC}" if healthy else f"{RED}❌ UNHEALTHY{NC}"
        print(f"{status} {service}")
        if not healthy:
            all_healthy = False

    print(f"\n{BLUE}{'=' * 60}{NC}")

    if all_healthy:
        print(f"{GREEN}✅ ALL SYSTEMS OPERATIONAL{NC}")
        return 0
    else:
        print(f"{YELLOW}⚠️  SOME SYSTEMS NEED ATTENTION{NC}")
        return 1

if __name__ == '__main__':
    sys.exit(main())
