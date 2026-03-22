# Logic Refinery — Worker Node Setup Guide

**Time to set up one node: ~10 minutes**
**Do this on each of your 7 i5 machines.**

---

## Step 1 — Find Your Orchestrator IP

On the machine running the Flask backend (your main machine), run:

```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

You will see something like `192.168.1.100`. This is your **ORCHESTRATOR_IP**.
Write it down — you will use it on every worker node.

---

## Step 2 — Set Up Each Worker Node

Run these commands on each i5 machine. Replace `node_01` with `node_02` through `node_07` for each machine.

```bash
# 1. Install Python (if not already installed)
sudo apt update && sudo apt install python3 python3-pip -y

# 2. Install the requests library
pip3 install requests

# 3. Install Ollama (if not already installed)
curl -fsSL https://ollama.com/install.sh | sh

# 4. Start Ollama
ollama serve &

# 5. Pull Phi-4-Mini (first time only — ~2.5GB download)
ollama pull phi4-mini

# 6. Copy worker_client.py to this machine
#    (copy from your orchestrator machine, or use git clone)
scp ubuntu@ORCHESTRATOR_IP:/path/to/logic-refinery-hitl/backend/worker_client.py .

# 7. Start the worker (replace node_01 and 192.168.1.100)
python3 worker_client.py \
  --node-id node_01 \
  --orchestrator http://192.168.1.100:5001
```

---

## Step 3 — Verify Connection

After starting the worker, you should see in the terminal:
```
2026-03-22 03:00:00 [worker] INFO — Registered as node_01 @ 192.168.1.101 with orchestrator http://192.168.1.100:5001
2026-03-22 03:00:00 [worker] INFO — Worker node_01 started. Polling http://192.168.1.100:5001 every 30s
```

In the **Cluster Monitor** tab of the web app, the node will appear as **IDLE** (green dot).

---

## Step 4 — Run as a Background Service (Optional)

To keep the worker running after you close the terminal:

```bash
# Using nohup (simple)
nohup python3 worker_client.py --node-id node_01 --orchestrator http://192.168.1.100:5001 > worker.log 2>&1 &

# Or using systemd (recommended for production)
sudo tee /etc/systemd/system/logic-worker.service > /dev/null <<EOF
[Unit]
Description=Logic Refinery Worker Node
After=network.target

[Service]
User=$USER
WorkingDirectory=$HOME
ExecStart=/usr/bin/python3 $HOME/worker_client.py --node-id node_01 --orchestrator http://192.168.1.100:5001
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable logic-worker
sudo systemctl start logic-worker
sudo systemctl status logic-worker
```

---

## Node ID Reference

| Machine | Node ID | Expected IP |
| :--- | :--- | :--- |
| i5 Desktop #1 | `node_01` | 192.168.1.101 |
| i5 Desktop #2 | `node_02` | 192.168.1.102 |
| i5 Desktop #3 | `node_03` | 192.168.1.103 |
| i5 Desktop #4 | `node_04` | 192.168.1.104 |
| i5 Desktop #5 | `node_05` | 192.168.1.105 |
| i5 Desktop #6 | `node_06` | 192.168.1.106 |
| i5 Desktop #7 | `node_07` | 192.168.1.107 |
| Ryzen Validator #1 | `ryzen_01` | 192.168.1.110 |

---

## Throughput Expectations

| Metric | Value |
| :--- | :--- |
| Generation cycle | Every 2 hours (auto) |
| Traces per node per cycle | 5 |
| Total raw traces per cycle | 35 (7 nodes × 5) |
| Stage 3 pass rate | ~70% → ~25 traces reach HITL |
| Human review speed | ~2 min/trace |
| Gold Standard per 8-hour shift | ~80 verified traces |
| Daily Gold value (1 auditor) | $80–$400/day |

---

## Troubleshooting

**"Cannot connect to Ollama"**
→ Make sure `ollama serve` is running: `ps aux | grep ollama`

**"Registration failed"**
→ Check the orchestrator IP and that Flask is running: `curl http://ORCHESTRATOR_IP:5001/api/health`

**"No jobs available"**
→ The 2-hour scheduler fires automatically. To trigger manually, click **Dispatch Cycle** in the Cluster Monitor tab.

**Node shows as OFFLINE in dashboard**
→ The node has not sent a heartbeat in >5 minutes. Restart `worker_client.py` on that machine.
