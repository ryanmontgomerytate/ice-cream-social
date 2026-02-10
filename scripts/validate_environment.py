#!/usr/bin/env python3
"""
Validate development environment before starting
Run this before starting development to catch issues early
"""

import sys
import subprocess
from pathlib import Path

def check_python_version():
    """Check Python version >= 3.9"""
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 9):
        print("❌ Python 3.9+ required")
        print(f"   Current: {version.major}.{version.minor}.{version.micro}")
        return False
    print(f"✅ Python {version.major}.{version.minor}.{version.micro}")
    return True

def check_venv():
    """Check if virtual environment is activated"""
    if sys.prefix == sys.base_prefix:
        print("❌ Virtual environment not activated")
        print("   Run: source venv/bin/activate")
        return False
    print(f"✅ Virtual environment: {sys.prefix}")
    return True

def check_dependencies():
    """Check if all Python packages are installed"""
    required = [
        ('flask', 'Flask'),
        ('faster_whisper', 'faster-whisper'),
        ('psutil', 'psutil'),
        ('rich', 'rich'),
        ('feedparser', 'feedparser'),
        ('yaml', 'pyyaml'),
    ]
    missing = []

    for module_name, pkg_name in required:
        try:
            __import__(module_name)
            print(f"✅ {pkg_name} installed")
        except ImportError:
            print(f"❌ {pkg_name} missing")
            missing.append(pkg_name)

    if missing:
        print(f"\n   Run: pip install {' '.join(missing)}")
        return False
    return True

def check_node():
    """Check if Node.js is installed"""
    try:
        result = subprocess.run(['node', '--version'],
                              capture_output=True, text=True, timeout=5)
        version = result.stdout.strip()
        print(f"✅ Node.js {version}")
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("❌ Node.js not installed")
        print("   Install: brew install node")
        return False

def check_npm_deps():
    """Check if npm dependencies are installed"""
    script_dir = Path(__file__).parent
    react_dir = script_dir / 'dashboard-react'

    if not react_dir.exists():
        print("⚠️  React dashboard directory not found")
        return True  # Not fatal, optional component

    if not (react_dir / 'node_modules').exists():
        print("❌ npm dependencies not installed")
        print(f"   Run: cd {react_dir} && npm install")
        return False

    print("✅ npm dependencies installed")
    return True

def check_ports():
    """Check if required ports are available or in use"""
    import socket
    ports = {'Backend': 8000, 'Frontend': 3000}

    for name, port in ports.items():
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = sock.connect_ex(('localhost', port))
        sock.close()

        if result == 0:
            print(f"⚠️  {name} port {port} already in use")
        else:
            print(f"✅ Port {port} available")

    return True  # Not fatal, just informational

def check_directories():
    """Check if required directories exist"""
    script_dir = Path(__file__).parent
    required_dirs = {
        'episodes': script_dir / 'episodes',
        'transcripts': script_dir / 'transcripts',
    }

    issues = []
    for name, path in required_dirs.items():
        if not path.exists():
            print(f"⚠️  {name} directory missing: {path}")
            try:
                path.mkdir(parents=True, exist_ok=True)
                print(f"   ✅ Created {name} directory")
            except Exception as e:
                print(f"   ❌ Could not create: {e}")
                issues.append(name)
        else:
            print(f"✅ {name} directory exists")

    return len(issues) == 0

def check_config():
    """Check if config file exists"""
    script_dir = Path(__file__).parent.parent
    config_file = script_dir / 'config.yaml'

    if not config_file.exists():
        print("⚠️  config.yaml not found")
        print(f"   Copy from: cp config.example.yaml config.yaml")
        return False

    print("✅ config.yaml exists")
    return True

if __name__ == "__main__":
    print("🔍 Validating Ice Cream Social Development Environment")
    print("=" * 60 + "\n")

    checks = [
        ("Python Version", check_python_version()),
        ("Virtual Environment", check_venv()),
        ("Python Dependencies", check_dependencies()),
        ("Node.js", check_node()),
        ("npm Dependencies", check_npm_deps()),
        ("Port Availability", check_ports()),
        ("Directories", check_directories()),
        ("Configuration", check_config()),
    ]

    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)

    failed = [name for name, passed in checks if not passed]

    if not failed:
        print("✅ All checks passed! Ready to start development.")
        print("\n📚 Next steps:")
        print("   1. Terminal 1: python dashboard_server.py")
        print("   2. Terminal 2: cd dashboard-react && npm run dev")
        print("   3. Terminal 3: python transcription_worker.py --model medium")
        print("\n📖 For detailed help: See DEVELOPMENT.md")
        sys.exit(0)
    else:
        print(f"❌ {len(failed)} check(s) failed:")
        for name in failed:
            print(f"   • {name}")
        print("\n📖 Fix the issues above, then run this script again.")
        print("📖 For detailed help: See DEVELOPMENT.md")
        sys.exit(1)
