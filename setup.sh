#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[36m'
YELLOW='\033[33m'
RED='\033[31m'
GREEN='\033[32m'
NC='\033[0m'

log() {
    echo -e "${CYAN}[TUF-AGENT] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[TUF-AGENT] $1${NC}"
}

fail() {
    echo -e "${RED}[TUF-AGENT] $1${NC}"
    exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

log "Starting setup in ${SCRIPT_DIR}"

ensure_node_runtime() {
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        log "Node.js and npm already available."
        return
    fi

    if command -v pkg >/dev/null 2>&1; then
        warn "Termux detected. Installing Node.js..."
        pkg update -y
        if [ "${TUF_SETUP_UPGRADE:-0}" = "1" ]; then
            pkg upgrade -y
        else
            warn "Skipping full Termux upgrade (set TUF_SETUP_UPGRADE=1 to enable)."
        fi
        pkg install -y nodejs
    elif command -v apt-get >/dev/null 2>&1; then
        warn "Debian/Ubuntu detected. Installing Node.js and npm..."
        if [ "$(id -u)" -eq 0 ]; then
            apt-get update -y
            apt-get install -y nodejs npm
        elif command -v sudo >/dev/null 2>&1; then
            sudo apt-get update -y
            sudo apt-get install -y nodejs npm
        else
            fail "Node.js/npm are missing and no sudo is available. Install them manually, then rerun setup."
        fi
    else
        fail "Unsupported package manager. Install Node.js and npm manually, then rerun setup."
    fi

    command -v node >/dev/null 2>&1 || fail "Node.js installation failed."
    command -v npm >/dev/null 2>&1 || fail "npm installation failed."
}

ensure_python_runtime() {
    if command -v python3 >/dev/null 2>&1; then
        if command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1; then
            log "Python and pip already available."
            return
        fi
    fi

    if command -v pkg >/dev/null 2>&1; then
        warn "Termux detected. Installing Python..."
        pkg install -y python
    elif command -v apt-get >/dev/null 2>&1; then
        warn "Debian/Ubuntu detected. Installing Python..."
        if [ "$(id -u)" -eq 0 ]; then
            apt-get update -y
            apt-get install -y python3 python3-pip
        elif command -v sudo >/dev/null 2>&1; then
            sudo apt-get update -y
            sudo apt-get install -y python3 python3-pip
        else
            fail "Python/pip are missing and no sudo is available. Install them manually, then rerun setup."
        fi
    else
        fail "Unsupported package manager. Install Python 3 and pip manually, then rerun setup."
    fi

    command -v python3 >/dev/null 2>&1 || fail "Python installation failed."
    command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1 || fail "pip installation failed."
}

install_python_dependencies() {
    local pip_cmd

    if [ ! -f "./requirements.txt" ]; then
        warn "requirements.txt not found. Skipping Python dependency install."
        return
    fi

    if command -v pip3 >/dev/null 2>&1; then
        pip_cmd="pip3"
    elif command -v pip >/dev/null 2>&1; then
        pip_cmd="pip"
    else
        fail "pip is not available to install Python dependencies."
    fi

    log "Installing Python dependencies from requirements.txt..."
    "${pip_cmd}" install --no-cache-dir -r ./requirements.txt
}

ensure_json_array_file() {
    local file_path="$1"
    local backup_path

    if [ ! -f "${file_path}" ]; then
        echo "[]" > "${file_path}"
        return
    fi

    if ! node -e "const fs=require('node:fs');const p=process.argv[1];try{const raw=fs.readFileSync(p,'utf8');const parsed=JSON.parse(raw);if(!Array.isArray(parsed))process.exit(2);}catch{process.exit(1);}" "${file_path}"; then
        backup_path="${file_path}.bak.$(date +%Y%m%d%H%M%S)"
        cp "${file_path}" "${backup_path}"
        warn "${file_path} was invalid JSON. Backed it up to ${backup_path} and reset it to []."
        echo "[]" > "${file_path}"
    fi
}

ensure_node_runtime
ensure_python_runtime

log "Installing Node dependencies..."
npm install --no-audit --no-fund

install_python_dependencies

log "Compiling TypeScript sources..."
npx tsc

if [ ! -f "./dist/AIAgentSHD.js" ]; then
    fail "Build did not produce dist/AIAgentSHD.js"
fi

log "Initializing local data files..."
ensure_json_array_file "./models.json"
ensure_json_array_file "./sessions.json"

echo -e "${GREEN}[TUF-AGENT] Setup complete.${NC}"
echo "Step 1: node add_model.js"
echo "Step 2: node test.js"
