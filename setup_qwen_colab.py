import subprocess
import time
import os
import re
import sys

def run(cmd):
    print(f"[RUN] {cmd}")
    res = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if res.stdout:
        print(res.stdout)
    if res.stderr:
        print(f"[STDERR] {res.stderr}")
    return res

print("=== 1. VERIFYING GPU ACCELERATION ===")
gpu_res = run("nvidia-smi")

print("=== 2. INSTALLING PREREQUISITES ===")
run("command -v zstd >/dev/null || (apt-get update -y && apt-get install -y zstd curl pciutils)")

print("=== 3. INSTALLING CLOUDFLARED ===")
run("command -v cloudflared >/dev/null || (curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && dpkg -i /tmp/cf.deb)")

print("=== 4. INSTALLING OLLAMA ===")
run("command -v ollama >/dev/null || (curl -fsSL https://ollama.com/install.sh | sh)")

print("=== 5. STARTING OLLAMA SERVICE (GPU ACCELERATED, 24H KEEP-ALIVE, FLASH ATTN) ===")
run("pkill -9 ollama || true")
run("CUDA_VISIBLE_DEVICES=0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KEEP_ALIVE=24h OLLAMA_NUM_PARALLEL=2 OLLAMA_HOST=0.0.0.0:11434 OLLAMA_ORIGINS='*' nohup ollama serve > /tmp/ollama.log 2>&1 &")
time.sleep(5)

print("=== 6. PULLING QWEN MODEL ===")
pulled_model = None
for candidate in ["qwen3.5:9b", "qwen3.5", "qwen2.5:7b"]:
    print(f"Trying to pull: {candidate}...")
    res = subprocess.run(f"ollama pull {candidate}", shell=True, text=True)
    if res.returncode == 0:
        pulled_model = candidate
        print(f"Successfully pulled {candidate}!")
        break

if not pulled_model:
    print("Failed to pull candidate models, pulling qwen2.5:7b")
    run("ollama pull qwen2.5:7b")
    pulled_model = "qwen2.5:7b"

print("=== 6.1 CONFIGURING MAXIMUM CONTEXT WINDOW (32,768 TOKENS) ===")
modelfile_content = f"""FROM {pulled_model}
PARAMETER num_ctx 32768
PARAMETER temperature 0.3
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"
PARAMETER stop "<|im_start|>"
"""
with open("/tmp/Modelfile", "w") as f:
    f.write(modelfile_content)

run(f"ollama create {pulled_model} -f /tmp/Modelfile || true")

# Create aliases for 3.5, 3.8, and 9b with 32k context so any model ID requested by AxilO matches
for alias in ["qwen3.5", "qwen-3.5", "qwen3.5:9b", "qwen-3.5-9b", "qwen3.8", "qwen-3.8"]:
    if alias != pulled_model:
        run(f"ollama cp {pulled_model} {alias} || true")

print("=== 7. WARMING UP MODEL ON GPU ===")
run(f"ollama run {pulled_model} 'Hi' || true")

print("=== 8. CHECKING GPU VRAM USAGE AFTER MODEL LOAD ===")
run("nvidia-smi")

print("=== 9. EXPOSING VIA CLOUDFLARE PUBLIC TUNNEL ===")
run("pkill -9 cloudflared || true")
run("rm -f /tmp/cf_tunnel.log")
run("nohup cloudflared tunnel --url http://127.0.0.1:11434 --logfile /tmp/cf_tunnel.log > /dev/null 2>&1 &")
time.sleep(8)

tunnel_url = None
for _ in range(30):
    if os.path.exists("/tmp/cf_tunnel.log"):
        with open("/tmp/cf_tunnel.log", "r") as f:
            content = f.read()
            matches = re.findall(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", content)
            if matches:
                tunnel_url = matches[-1]
                break
    time.sleep(2)

print("\n==========================================")
if tunnel_url:
    print(f"SUCCESS! QWEN MODEL SERVER IS LIVE ON GPU!")
    print(f"PUBLIC_ENDPOINT: {tunnel_url}/v1")
    print(f"ACTIVE_MODEL: {pulled_model}")
    print(f"CONTEXT_LIMIT: 32768 Tokens")
    with open("/tmp/endpoint.txt", "w") as f:
        f.write(f"{tunnel_url}/v1\n")
else:
    print("Could not find public tunnel URL in logs.")
    if os.path.exists("/tmp/cf_tunnel.log"):
        with open("/tmp/cf_tunnel.log") as f:
            print(f.read())
print("==========================================")
