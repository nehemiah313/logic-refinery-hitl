#!/usr/bin/env bash
# =============================================================================
# Logic Refinery v3.0 — i5 Scout Node Setup Script
# =============================================================================
# One-command installer for i5 Scout nodes running phi4-mini reasoning model.
#
# USAGE:
#   chmod +x setup_node.sh
#   ./setup_node.sh --node-id node_01 --orchestrator http://192.168.1.100:5001
#
# WHAT THIS SCRIPT DOES:
#   1. Installs Python 3 and pip
#   2. Installs the 'requests' Python package
#   3. Installs Ollama
#   4. Pulls phi4-mini reasoning model (~2.5GB download)
#   5. Starts Ollama as a background service
#   6. Verifies the orchestrator is reachable
#   7. Starts the worker_client.py as a background process
#   8. Creates a systemd service for auto-restart on reboot (optional)
#
# REQUIREMENTS:
#   - Ubuntu 20.04+ or Debian 11+
#   - 8GB RAM minimum
#   - 10GB free disk space (for phi4-mini model)
#   - Network access to the orchestrator machine
# =============================================================================

set -euo pipefail

# ─── Color helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }
log_section() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════${NC}"; echo -e "${BOLD}${CYAN}  $*${NC}"; echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}"; }

# ─── Parse arguments ─────────────────────────────────────────────────────────
NODE_ID=""
ORCHESTRATOR=""
MODEL="phi4-mini"
TIER="scout"
INSTALL_SYSTEMD=false
WORKER_SCRIPT_PATH="$(dirname "$0")/worker_client.py"

usage() {
    echo ""
    echo "Usage: $0 --node-id <id> --orchestrator <url> [options]"
    echo ""
    echo "Required:"
    echo "  --node-id       Node identifier, e.g. node_01"
    echo "  --orchestrator  Orchestrator URL, e.g. http://192.168.1.100:5001"
    echo ""
    echo "Optional:"
    echo "  --model         Ollama model to use (default: phi4-mini)"
    echo "  --tier          Node tier: scout or refiner (default: scout)"
    echo "  --systemd       Install as a systemd service for auto-restart on reboot"
    echo "  --worker        Path to worker_client.py (default: same directory as this script)"
    echo ""
    echo "Examples:"
    echo "  ./setup_node.sh --node-id node_01 --orchestrator http://192.168.1.100:5001"
    echo "  ./setup_node.sh --node-id node_03 --orchestrator http://192.168.1.100:5001 --systemd"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --node-id)       NODE_ID="$2";           shift 2 ;;
        --orchestrator)  ORCHESTRATOR="$2";      shift 2 ;;
        --model)         MODEL="$2";             shift 2 ;;
        --tier)          TIER="$2";              shift 2 ;;
        --systemd)       INSTALL_SYSTEMD=true;   shift   ;;
        --worker)        WORKER_SCRIPT_PATH="$2"; shift 2 ;;
        -h|--help)       usage ;;
        *)               log_error "Unknown argument: $1"; usage ;;
    esac
done

# ─── Validate required args ───────────────────────────────────────────────────
if [[ -z "$NODE_ID" || -z "$ORCHESTRATOR" ]]; then
    log_error "--node-id and --orchestrator are required."
    usage
fi

if [[ ! -f "$WORKER_SCRIPT_PATH" ]]; then
    log_error "worker_client.py not found at: $WORKER_SCRIPT_PATH"
    log_error "Copy worker_client.py to this directory or use --worker /path/to/worker_client.py"
    exit 1
fi

# ─── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}"
echo "  ██╗      ██████╗  ██████╗ ██╗ ██████╗"
echo "  ██║     ██╔═══██╗██╔════╝ ██║██╔════╝"
echo "  ██║     ██║   ██║██║  ███╗██║██║"
echo "  ██║     ██║   ██║██║   ██║██║██║"
echo "  ███████╗╚██████╔╝╚██████╔╝██║╚██████╗"
echo "  ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝ ╚═════╝"
echo "  REFINERY — i5 Scout Node Setup v3.0"
echo -e "${NC}"
echo -e "  Node ID:      ${BOLD}${GREEN}$NODE_ID${NC}"
echo -e "  Orchestrator: ${BOLD}${GREEN}$ORCHESTRATOR${NC}"
echo -e "  Model:        ${BOLD}${GREEN}$MODEL${NC} (phi4-mini reasoning)"
echo -e "  Tier:         ${BOLD}${GREEN}$TIER${NC}"
echo ""

# ─── Step 1: System packages ──────────────────────────────────────────────────
log_section "Step 1 — System Packages"

if command -v apt-get &>/dev/null; then
    log_info "Updating package list..."
    sudo apt-get update -qq
    log_info "Installing Python 3, pip, curl..."
    sudo apt-get install -y python3 python3-pip curl wget 2>/dev/null
    log_ok "System packages installed."
elif command -v dnf &>/dev/null; then
    sudo dnf install -y python3 python3-pip curl wget
    log_ok "System packages installed (dnf)."
else
    log_warn "Unknown package manager. Assuming Python 3 and curl are already installed."
fi

# ─── Step 2: Python requests ──────────────────────────────────────────────────
log_section "Step 2 — Python Dependencies"

log_info "Installing 'requests' library..."
pip3 install requests --quiet
log_ok "Python 'requests' installed."

# ─── Step 3: Ollama ───────────────────────────────────────────────────────────
log_section "Step 3 — Ollama Installation"

if command -v ollama &>/dev/null; then
    OLLAMA_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
    log_ok "Ollama already installed: $OLLAMA_VERSION"
else
    log_info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    log_ok "Ollama installed."
fi

# ─── Step 4: Start Ollama service ─────────────────────────────────────────────
log_section "Step 4 — Starting Ollama Service"

if pgrep -x "ollama" > /dev/null; then
    log_ok "Ollama is already running."
else
    log_info "Starting Ollama in background..."
    nohup ollama serve > ~/ollama.log 2>&1 &
    sleep 3
    if pgrep -x "ollama" > /dev/null; then
        log_ok "Ollama started (PID: $(pgrep -x ollama))."
    else
        log_error "Ollama failed to start. Check ~/ollama.log"
        exit 1
    fi
fi

# ─── Step 5: Pull phi4-mini reasoning model ───────────────────────────────────
log_section "Step 5 — Pulling $MODEL Reasoning Model"

log_info "Checking if $MODEL is already available..."
if ollama list 2>/dev/null | grep -q "$MODEL"; then
    log_ok "$MODEL is already pulled and ready."
else
    log_info "Pulling $MODEL (~2.5GB). This may take several minutes on first run..."
    log_warn "Do not interrupt this step — the model must fully download."
    ollama pull "$MODEL"
    log_ok "$MODEL pulled successfully."
fi

# ─── Step 6: Verify Ollama responds to phi4-mini ─────────────────────────────
log_section "Step 6 — Verifying phi4-mini Reasoning"

log_info "Running a quick inference test on $MODEL..."
TEST_RESPONSE=$(curl -s -X POST http://localhost:11434/api/generate \
    -H "Content-Type: application/json" \
    -d "{\"model\": \"$MODEL\", \"prompt\": \"<think>CPT 27447 is Total Knee Arthroplasty.</think>\\nReturn JSON: {\\\"cpt\\\": \\\"27447\\\", \\\"description\\\": \\\"TKA\\\"}\", \"stream\": false, \"options\": {\"num_predict\": 64}}" \
    2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('response','')[:80])" 2>/dev/null || echo "")

if [[ -n "$TEST_RESPONSE" ]]; then
    log_ok "phi4-mini reasoning test passed."
    log_info "Sample output: ${TEST_RESPONSE:0:60}..."
else
    log_warn "phi4-mini test returned empty. Model may still be loading — worker will retry automatically."
fi

# ─── Step 7: Verify orchestrator reachability ─────────────────────────────────
log_section "Step 7 — Orchestrator Connectivity"

log_info "Pinging orchestrator at $ORCHESTRATOR..."
HEALTH=$(curl -s --connect-timeout 5 "$ORCHESTRATOR/api/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unreachable")

if [[ "$HEALTH" == "ok" ]]; then
    log_ok "Orchestrator is reachable and healthy."
else
    log_error "Cannot reach orchestrator at $ORCHESTRATOR/api/health (got: $HEALTH)"
    log_error "Check:"
    log_error "  1. Flask is running on the orchestrator: python3 app.py"
    log_error "  2. Port 5001 is open: sudo ufw allow 5001/tcp"
    log_error "  3. The IP address is correct"
    log_warn "Continuing setup — worker will retry connection automatically."
fi

# ─── Step 8: Start the worker ─────────────────────────────────────────────────
log_section "Step 8 — Starting Worker Node"

LOG_FILE="$HOME/worker_${NODE_ID}.log"

# Kill any existing worker for this node
pkill -f "worker_client.py.*$NODE_ID" 2>/dev/null && log_info "Stopped existing worker for $NODE_ID." || true

log_info "Starting worker $NODE_ID in background..."
nohup python3 "$WORKER_SCRIPT_PATH" \
    --node-id "$NODE_ID" \
    --orchestrator "$ORCHESTRATOR" \
    --tier "$TIER" \
    --model "$MODEL" \
    > "$LOG_FILE" 2>&1 &

WORKER_PID=$!
sleep 2

if kill -0 "$WORKER_PID" 2>/dev/null; then
    log_ok "Worker started (PID: $WORKER_PID). Logging to: $LOG_FILE"
else
    log_error "Worker failed to start. Check: $LOG_FILE"
    tail -20 "$LOG_FILE" 2>/dev/null || true
    exit 1
fi

# ─── Step 9: Optional systemd service ────────────────────────────────────────
if [[ "$INSTALL_SYSTEMD" == true ]]; then
    log_section "Step 9 — Installing systemd Service"

    SERVICE_NAME="logic-refinery-${NODE_ID}"
    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    PYTHON_BIN=$(which python3)
    WORKER_ABS=$(realpath "$WORKER_SCRIPT_PATH")

    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Logic Refinery Worker — $NODE_ID ($TIER tier, $MODEL)
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME
ExecStart=$PYTHON_BIN $WORKER_ABS --node-id $NODE_ID --orchestrator $ORCHESTRATOR --tier $TIER --model $MODEL
Restart=on-failure
RestartSec=30
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
    sudo systemctl start "$SERVICE_NAME"
    log_ok "systemd service '$SERVICE_NAME' installed and started."
    log_info "Manage with: sudo systemctl status $SERVICE_NAME"
fi

# ─── Final Summary ────────────────────────────────────────────────────────────
log_section "Setup Complete"

echo ""
echo -e "  ${BOLD}${GREEN}✓ Node $NODE_ID is online and running.${NC}"
echo ""
echo -e "  ${BOLD}Model:${NC}        $MODEL (phi4-mini reasoning)"
echo -e "  ${BOLD}Tier:${NC}         $TIER"
echo -e "  ${BOLD}Orchestrator:${NC} $ORCHESTRATOR"
echo -e "  ${BOLD}Log file:${NC}     $LOG_FILE"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "    View live logs:   ${CYAN}tail -f $LOG_FILE${NC}"
echo -e "    Stop worker:      ${CYAN}pkill -f 'worker_client.py.*$NODE_ID'${NC}"
echo -e "    Restart worker:   ${CYAN}./setup_node.sh --node-id $NODE_ID --orchestrator $ORCHESTRATOR${NC}"
if [[ "$INSTALL_SYSTEMD" == true ]]; then
echo -e "    Service status:   ${CYAN}sudo systemctl status logic-refinery-$NODE_ID${NC}"
fi
echo ""
echo -e "  ${BOLD}Check the Cluster Monitor tab in the HITL app to confirm this node appears.${NC}"
echo ""
