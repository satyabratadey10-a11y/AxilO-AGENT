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
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_FILE = os.path.join(BASE_DIR, 'models.json')
SETUP_SCRIPT = os.path.join(BASE_DIR, 'setup_qwen_colab.py')
SESSION_NAME = 'qwen-t4'
HEARTBEAT_FILE = '/tmp/heartbeat.py'

# Write small heartbeat script to be executed in remote kernel
with open(HEARTBEAT_FILE, 'w') as f:
    f.write('import time, subprocess; print("[colab-heartbeat]", time.time())\n')

def log(msg):
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] [ColabDaemon] {msg}", flush=True)

def run_cmd(cmd, timeout=120):
    try:
        res = subprocess.run(cmd, shell=True, text=True, capture_output=True, timeout=timeout)
        return res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        return -1, '', 'Timeout expired'
    except Exception as e:
        return -1, '', str(e)

def session_exists():
    rc, out, _ = run_cmd("colab sessions", timeout=30)
    return (rc == 0 and SESSION_NAME in out)

def create_session():
    log(f"Creating new Colab session '{SESSION_NAME}' with Tesla T4 GPU...")
    rc, out, err = run_cmd(f"colab new --session {SESSION_NAME} --gpu T4", timeout=60)
    if "Session READY" in out or session_exists():
        log(f"Colab session '{SESSION_NAME}' is READY.")
        return True
    log(f"Failed to create session: {out} {err}")
    return False

def update_models_json(new_endpoint):
    if not os.path.exists(MODELS_FILE):
        return
    try:
        with open(MODELS_FILE, 'r') as f:
            data = json.load(f)
        
        updated = False
        for m in data:
            if 'qwen' in m.get('id', '').lower() and 'colab' in m.get('name', '').lower():
                if m.get('endpoint') != new_endpoint:
                    m['endpoint'] = new_endpoint
                    updated = True
        
        if updated:
            with open(MODELS_FILE, 'w') as f:
                json.dump(data, f, indent=2)
            log(f"Successfully updated models.json with active endpoint: {new_endpoint}")
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
    rc, out, err = run_cmd(f"colab exec -s {SESSION_NAME} -f {SETUP_SCRIPT} --timeout 600", timeout=660)
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
    log("Starting AxilO Colab Keepalive Daemon...")
    current_endpoint = get_live_endpoint()
    
    if not test_endpoint(current_endpoint):
        log(f"Current endpoint {current_endpoint} is offline. Initializing setup...")
        current_endpoint = setup_and_connect()
    else:
        log(f"Current endpoint {current_endpoint} is verified ONLINE and active.")

    log("Entering persistent heartbeat monitoring loop (30s interval)...")
    failure_count = 0

    while True:
        time.sleep(30)
        
        # 1. Heartbeat to remote Colab kernel to prevent idle timeout
        rc, _, _ = run_cmd(f"colab exec -s {SESSION_NAME} -f {HEARTBEAT_FILE} --timeout 40", timeout=45)
        
        # 2. Check public tunnel endpoint health
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
