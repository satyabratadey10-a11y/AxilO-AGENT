#!/usr/bin/env python3
"""
AxilO Colab Keepalive & Auto-Healing Daemon
Maintains the Google Colab GPU runtime, prevents idle pruning via active heartbeats,
exposes Ollama/Qwen via Cloudflare tunnel, and automatically updates models.json.
"""

import subprocess
import time
import json
import os
import re
import sys
import shutil
import urllib.request
import signal

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_FILE = os.path.join(BASE_DIR, 'models.json')
SETUP_SCRIPT = os.path.join(BASE_DIR, 'setup_qwen_colab.py')
HEARTBEAT_FILE = os.path.join(BASE_DIR, 'heartbeat.py')
SESSION_NAME = 'qwen-t4'

# Ensure heartbeat script exists in permanent ~/.axilo/ directory (never in /tmp)
with open(HEARTBEAT_FILE, 'w') as f:
    f.write('''import time
try:
    import torch
    if torch.cuda.is_available():
        _t = torch.zeros((1,), device="cuda")
except Exception:
    pass
print(f"[colab-heartbeat] active at {time.strftime('%Y-%m-%d %H:%M:%S')}")
''')

def log(msg):
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] [ColabDaemon] {msg}", flush=True)

def get_colab_bin():
    colab = shutil.which("colab")
    if colab:
        return colab
    for candidate in [
        "/data/data/com.termux/files/usr/bin/colab",
        "/usr/local/bin/colab",
        "/usr/bin/colab"
    ]:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return "colab"

COLAB_BIN = get_colab_bin()

def run_cmd(cmd, timeout=120):
    try:
        res = subprocess.run(cmd, shell=True, text=True, capture_output=True, timeout=timeout)
        return res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        return -1, '', 'Timeout expired'
    except Exception as e:
        return -1, '', str(e)

def session_exists():
    rc, out, _ = run_cmd(f"{COLAB_BIN} sessions", timeout=30)
    if rc != 0:
        return False
    for line in out.splitlines():
        if SESSION_NAME in line and "Pruned" not in line and "TERMINATED" not in line:
            return True
    return False

def create_session():
    log(f"Creating new Colab session '{SESSION_NAME}' with Tesla T4 GPU...")
    rc, out, err = run_cmd(f"{COLAB_BIN} new --session {SESSION_NAME} --gpu T4", timeout=90)
    if "Session READY" in out or session_exists():
        log(f"Colab session '{SESSION_NAME}' is READY.")
        return True
    log(f"Failed to create session: {out} {err}")
    return False

def update_models_json(new_endpoint, context_tokens=32768):
    if not os.path.exists(MODELS_FILE):
        return
    try:
        with open(MODELS_FILE, 'r') as f:
            data = json.load(f)
        
        updated = False
        for m in data:
            if 'qwen' in m.get('id', '').lower() and 'colab' in m.get('name', '').lower():
                m['endpoint'] = new_endpoint
                m['contextTokens'] = context_tokens
                m['maxTokens'] = 8192
                m['options'] = {"num_ctx": context_tokens}
                updated = True
        
        if updated:
            with open(MODELS_FILE, 'w') as f:
                json.dump(data, f, indent=2)
            log(f"Successfully updated models.json with active endpoint: {new_endpoint} (Context: {context_tokens})")
    except Exception as e:
        log(f"Error updating models.json: {e}")

def get_live_endpoint():
    try:
        with open(MODELS_FILE, 'r') as f:
            data = json.load(f)
        for m in data:
            if m.get('id') == 'qwen3.5:9b':
                return m.get('endpoint')
    except:
        pass
    return None

def test_endpoint(endpoint):
    if not endpoint:
        return False
    try:
        url = endpoint.rstrip('/') + '/models'
        req = urllib.request.Request(url, headers={'User-Agent': 'AxilO-Daemon'})
        with urllib.request.urlopen(req, timeout=15) as res:
            return (res.status == 200)
    except:
        return False

def setup_and_connect():
    if not session_exists():
        if not create_session():
            return None
    
    log("Running setup_qwen_colab.py on Colab GPU...")
    rc, out, err = run_cmd(f"{COLAB_BIN} exec -s {SESSION_NAME} -f {SETUP_SCRIPT} --timeout 600", timeout=660)
    log(f"Setup execution finished with code {rc}.")
    
    combined = out + "\n" + err
    matches = re.findall(r"PUBLIC_ENDPOINT:\s*(https://[a-zA-Z0-9-]+\.trycloudflare\.com/v1)", combined)
    if not matches:
        matches = re.findall(r"(https://[a-zA-Z0-9-]+\.trycloudflare\.com/v1)", combined)
    
    if matches:
        endpoint = matches[-1]
        log(f"Discovered live public endpoint: {endpoint}")
        update_models_json(endpoint)
        return endpoint
    else:
        log("Could not find public endpoint in setup logs. Raw output tail:")
        print(out[-1000:], flush=True)
        return None

def main():
    log(f"Starting AxilO Colab Keepalive Daemon (using colab binary: {COLAB_BIN})...")
    current_endpoint = get_live_endpoint()
    
    if not test_endpoint(current_endpoint):
        log(f"Current endpoint '{current_endpoint}' is offline. Verifying session and initializing setup...")
        current_endpoint = setup_and_connect()
    else:
        log(f"Current endpoint '{current_endpoint}' is verified ONLINE and active.")

    log("Entering persistent heartbeat monitoring loop (30s interval)...")
    failure_count = 0

    while True:
        time.sleep(30)
        
        # 1. Verify remote session exists; if Google terminated it, trigger auto-recovery
        if not session_exists():
            log(f"Warning: Colab session '{SESSION_NAME}' no longer exists on server. Recovering...")
            current_endpoint = setup_and_connect()
            failure_count = 0
            continue

        # 2. Heartbeat to remote Colab kernel to keep kernel active and prevent idle timeout
        rc, out, err = run_cmd(f"{COLAB_BIN} exec -s {SESSION_NAME} -f {HEARTBEAT_FILE} --timeout 40", timeout=45)
        if rc == 0:
            log(f"Heartbeat OK: {out.strip()}")
        else:
            log(f"Heartbeat warning (rc={rc}): {err.strip() or out.strip()}")

        # 3. Check public tunnel endpoint health
        is_healthy = test_endpoint(current_endpoint)
        
        if is_healthy:
            failure_count = 0
            continue
        
        failure_count += 1
        log(f"Warning: Health check failed ({failure_count}/2) for {current_endpoint}")
        
        if failure_count >= 2:
            log("Endpoint confirmed offline. Attempting automatic recovery...")
            current_endpoint = setup_and_connect()
            failure_count = 0

if __name__ == '__main__':
    main()
