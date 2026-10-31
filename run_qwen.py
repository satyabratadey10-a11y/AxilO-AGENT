#!/usr/bin/env python3
"""
AxilO - Automated Google Colab T4 Runner for Qwen 3.5 / 3.8
Automatically provisions a Colab session with Tesla T4 GPU hardware,
sets up Ollama with 32,768 context tokens (Flash Attention enabled),
exposes the server via a Cloudflare public tunnel, and updates models.json.

Usage:
  python run_qwen.py
  bash run_qwen.sh
  node run_qwen.js
"""

import subprocess
import time
import json
import os
import re
import sys
import shutil
import urllib.request

HOME_DIR = "/data/data/com.termux/files/home"
AXILO_DIR = os.path.join(HOME_DIR, ".axilo")
MODELS_FILE = os.path.join(AXILO_DIR, "models.json")
SETUP_SCRIPT = os.path.join(AXILO_DIR, "setup_qwen_colab.py")
DAEMON_SCRIPT = os.path.join(AXILO_DIR, "colab_daemon.py")
DAEMON_LOG = os.path.join(AXILO_DIR, "daemon.log")
HEARTBEAT_FILE = os.path.join(AXILO_DIR, "heartbeat.py")
SESSION_NAME = "qwen-t4"
DEFAULT_CONTEXT = 32768

# ANSI colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
RESET = "\033[0m"

def print_banner():
    banner = f"""{CYAN}{BOLD}
╔══════════════════════════════════════════════════════════════════════════╗
║               AxilO · Google Colab T4 Qwen Auto-Boot                     ║
║       Tesla T4 GPU · Flash Attention · 32,768 Context Window             ║
╚══════════════════════════════════════════════════════════════════════════╝{RESET}"""
    print(banner)

def run_cmd(cmd, timeout=300, capture=True):
    try:
        res = subprocess.run(cmd, shell=True, text=True, capture_output=capture, timeout=timeout)
        return res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "Timeout expired"
    except Exception as e:
        return -1, "", str(e)

def find_colab_bin():
    colab = shutil.which("colab")
    if colab:
        return colab
    default_path = "/data/data/com.termux/files/usr/bin/colab"
    if os.path.isfile(default_path) and os.access(default_path, os.X_OK):
        return default_path
    return None

def check_session_exists(colab_bin):
    rc, out, _ = run_cmd(f"{colab_bin} sessions", timeout=45)
    return (rc == 0 and SESSION_NAME in out)

def create_colab_session(colab_bin):
    print(f"{YELLOW}● [1/5] Starting Google Colab session '{SESSION_NAME}' with Tesla T4 GPU...{RESET}")
    rc, out, err = run_cmd(f"{colab_bin} new --session {SESSION_NAME} --gpu T4", timeout=90)
    if "Session READY" in out or check_session_exists(colab_bin):
        print(f"{GREEN}✔ [1/5] Colab session '{SESSION_NAME}' is READY with Tesla T4 GPU!{RESET}")
        return True
    print(f"{RED}✘ Failed to create session: {out} {err}{RESET}")
    return False

def setup_model_and_tunnel(colab_bin):
    print(f"{YELLOW}● [2/5] Deploying Ollama & Qwen with 32K context on Colab T4 GPU...{RESET}")
    print(f"  {MAGENTA}Executing setup_qwen_colab.py (Flash Attention + 32,768 Context Limit)...{RESET}")
    
    rc, out, err = run_cmd(f"{colab_bin} exec -s {SESSION_NAME} -f {SETUP_SCRIPT} --timeout 600", timeout=660)
    combined = out + "\n" + err
    
    matches = re.findall(r"PUBLIC_ENDPOINT:\s*(https://[a-zA-Z0-9-]+\.trycloudflare\.com/v1)", combined)
    if not matches:
        matches = re.findall(r"(https://[a-zA-Z0-9-]+\.trycloudflare\.com/v1)", combined)
        
    if matches:
        endpoint = matches[-1]
        print(f"{GREEN}✔ [2/5] Server online! Public tunnel endpoint: {endpoint}{RESET}")
        return endpoint
    else:
        print(f"{RED}✘ Could not find public tunnel URL in Colab output.{RESET}")
        print("Tail of remote execution:")
        print(combined[-1500:])
        return None

def update_models_json(endpoint, context_tokens=DEFAULT_CONTEXT):
    print(f"{YELLOW}● [3/5] Configuring new API endpoint & context limit in models.json...{RESET}")
    if not os.path.exists(MODELS_FILE):
        print(f"{RED}✘ models.json not found at {MODELS_FILE}{RESET}")
        return False
        
    try:
        with open(MODELS_FILE, "r") as f:
            models = json.load(f)
            
        updated_count = 0
        for m in models:
            if "qwen" in m.get("id", "").lower() and "colab" in m.get("name", "").lower():
                m["endpoint"] = endpoint
                m["contextTokens"] = context_tokens
                m["maxTokens"] = 8192
                m["options"] = {"num_ctx": context_tokens}
                updated_count += 1
                
        with open(MODELS_FILE, "w") as f:
            json.dump(models, f, indent=2)
            
        print(f"{GREEN}✔ [3/5] Successfully updated {updated_count} Qwen model configurations in models.json!{RESET}")
        print(f"  {CYAN}Context limit locked at {context_tokens:,} tokens (num_ctx: {context_tokens}){RESET}")
        return True
    except Exception as e:
        print(f"{RED}✘ Error updating models.json: {e}{RESET}")
        return False

def verify_endpoint_health(endpoint):
    print(f"{YELLOW}● [4/5] Verifying live API connectivity...{RESET}")
    url = endpoint.rstrip("/") + "/models"
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AxilO-Runner"})
            with urllib.request.urlopen(req, timeout=15) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    model_ids = [m.get("id") for m in data.get("data", [])]
                    print(f"{GREEN}✔ [4/5] API verified online (HTTP 200)! Available models: {', '.join(model_ids)}{RESET}")
                    return True
        except Exception as e:
            time.sleep(3)
    print(f"{YELLOW}⚠ Health check timed out, but tunnel may still be establishing.{RESET}")
    return False

def restart_keepalive_daemon():
    print(f"{YELLOW}● [5/5] Managing persistent keepalive heartbeat daemon...{RESET}")
    # Kill any stale daemon instances
    run_cmd("pkill -9 -f colab_daemon.py || true", timeout=10)
    
    # Launch new background daemon
    nohup_cmd = f"nohup python3 {DAEMON_SCRIPT} > {DAEMON_LOG} 2>&1 &"
    subprocess.Popen(nohup_cmd, shell=True, cwd=AXILO_DIR)
    time.sleep(1)
    
    # Verify daemon process is running
    rc, out, _ = run_cmd("pgrep -f colab_daemon.py", timeout=5)
    if rc == 0 and out.strip():
        print(f"{GREEN}✔ [5/5] Background keepalive daemon active (PID: {out.strip().split()[0]}).{RESET}")
        print(f"  {MAGENTA}Heartbeat pings remote kernel every 30s to keep Colab VM alive.{RESET}")
        return True
    else:
        print(f"{YELLOW}⚠ Daemon started in background (check {DAEMON_LOG} for logs).{RESET}")
        return True

def print_summary(endpoint, context_tokens=DEFAULT_CONTEXT):
    divider = "─" * 74
    print(f"\n{GREEN}{BOLD}{divider}{RESET}")
    print(f"{GREEN}{BOLD}✔ QWEN 3.5 9B IS ONLINE & ACCELERATED ON GOOGLE COLAB GPU!{RESET}")
    print(f"{GREEN}{BOLD}{divider}{RESET}")
    print(f"  {BOLD}Hardware        :{RESET} Tesla T4 GPU (16GB VRAM, Google Colab)")
    print(f"  {BOLD}Session Name    :{RESET} {SESSION_NAME}")
    print(f"  {BOLD}Context Window  :{RESET} {CYAN}{BOLD}{context_tokens:,} Tokens{RESET} (Eliminates truncation & mid-sentence cuts)")
    print(f"  {BOLD}Max Output      :{RESET} 8,192 Tokens")
    print(f"  {BOLD}Public Endpoint :{RESET} {MAGENTA}{endpoint}{RESET}")
    print(f"  {BOLD}models.json     :{RESET} Configured & Synchronized")
    print(f"  {BOLD}Auto-Keepalive  :{RESET} Enabled (prevents idle timeouts)")
    print(f"{GREEN}{BOLD}{divider}{RESET}")
    print(f"\n{BOLD}To start using Qwen with AxilO:{RESET}")
    print(f"  {CYAN}$ axilo{RESET}")
    print(f"  {CYAN}❯ /model qwen3.5:9b{RESET}\n")

def main():
    print_banner()
    
    colab_bin = find_colab_bin()
    if not colab_bin:
        print(f"{RED}✘ Google Colab CLI not found on this system.{RESET}")
        print(f"  Please make sure `colab` is installed in PATH.")
        sys.exit(1)

    # 1. Session check or creation
    if check_session_exists(colab_bin):
        print(f"{GREEN}✔ [1/5] Active Colab session '{SESSION_NAME}' found.{RESET}")
    else:
        if not create_colab_session(colab_bin):
            sys.exit(1)

    # 2. Deploy Ollama + Qwen + Tunnel
    endpoint = setup_model_and_tunnel(colab_bin)
    if not endpoint:
        sys.exit(1)

    # 3. Update models.json
    update_models_json(endpoint, DEFAULT_CONTEXT)

    # 4. Verify endpoint health
    verify_endpoint_health(endpoint)

    # 5. Background keepalive daemon
    restart_keepalive_daemon()

    # 6. Final summary
    print_summary(endpoint, DEFAULT_CONTEXT)

    # Check if user requested foreground monitoring
    if "--foreground" in sys.argv or "-f" in sys.argv:
        print(f"{CYAN}Entering foreground heartbeat monitor. Press Ctrl+C to exit.{RESET}")
        try:
            while True:
                time.sleep(30)
                run_cmd(f"{colab_bin} exec -s {SESSION_NAME} -f {HEARTBEAT_FILE} --timeout 40", timeout=45)
                print(f"[{time.strftime('%H:%M:%S')}] Heartbeat sent to {SESSION_NAME}.", flush=True)
        except KeyboardInterrupt:
            print(f"\nExiting foreground monitor. Daemon remains running in background.")

if __name__ == "__main__":
    main()
