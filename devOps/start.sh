#!/bin/bash
# Integrador Backend Startup Script (Unix/Linux/Mac)
# This script starts all backend services in the correct order

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

SKIP_DOCKER=false
API_ONLY=false
WS_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-docker) SKIP_DOCKER=true; shift ;;
        --api-only) API_ONLY=true; shift ;;
        --ws-only) WS_ONLY=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo -e "${CYAN}========================================"
echo -e "  Integrador Backend Startup"
echo -e "========================================${NC}"

# Check if we're in the backend directory
if [ ! -f "rest_api/main.py" ]; then
    echo -e "${RED}Error: Run this script from the backend directory${NC}"
    exit 1
fi

# Step 1: Start Docker containers (PostgreSQL + Redis)
if [ "$SKIP_DOCKER" = false ]; then
    echo -e "\n${YELLOW}[1/4] Starting Docker containers...${NC}"
    docker compose -f ../devOps/docker-compose.yml up -d

    # Wait for services to be healthy
    echo -e "${GRAY}Waiting for PostgreSQL to be ready...${NC}"
    max_attempts=30
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker compose -f ../devOps/docker-compose.yml exec -T db pg_isready -U postgres -d menu_ops > /dev/null 2>&1; then
            echo -e "${GREEN}PostgreSQL is ready!${NC}"
            break
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    if [ $attempt -ge $max_attempts ]; then
        echo -e "${YELLOW}Warning: PostgreSQL health check timed out${NC}"
    fi

    echo -e "${GRAY}Waiting for Redis to be ready...${NC}"
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker compose -f ../devOps/docker-compose.yml exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
            echo -e "${GREEN}Redis is ready!${NC}"
            break
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    if [ $attempt -ge $max_attempts ]; then
        echo -e "${YELLOW}Warning: Redis health check timed out${NC}"
    fi
else
    echo -e "\n${GRAY}[1/4] Skipping Docker (--skip-docker flag)${NC}"
fi

# Step 2: Check Python environment
echo -e "\n${YELLOW}[2/4] Checking Python environment...${NC}"
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo -e "${RED}Error: Python not found in PATH${NC}"
    exit 1
fi

# Determine python command
PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    PYTHON_CMD="python"
fi

# Check if venv exists and activate
if [ -f "venv/bin/activate" ]; then
    echo -e "${GRAY}Activating virtual environment...${NC}"
    source venv/bin/activate
elif [ -f ".venv/bin/activate" ]; then
    echo -e "${GRAY}Activating virtual environment...${NC}"
    source .venv/bin/activate
else
    echo -e "${YELLOW}No virtual environment found, using system Python${NC}"
fi

# Step 3: Check dependencies
echo -e "\n${YELLOW}[3/4] Checking dependencies...${NC}"
if ! $PYTHON_CMD -c "import fastapi; import sqlalchemy; import redis" 2>/dev/null; then
    echo -e "${GRAY}Installing dependencies...${NC}"
    pip install -r requirements.txt
fi
echo -e "${GREEN}Dependencies OK!${NC}"

# Step 4: Start services
echo -e "\n${YELLOW}[4/4] Starting services...${NC}"

cleanup() {
    echo -e "\n${YELLOW}Stopping services...${NC}"
    kill $API_PID 2>/dev/null || true
    kill $WS_PID 2>/dev/null || true
    echo -e "${CYAN}Backend stopped.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

if [ "$WS_ONLY" = true ]; then
    echo -e "${CYAN}Starting WebSocket Gateway only (port 8001)...${NC}"
    cd ..
    export PYTHONPATH="$PWD/backend:$PYTHONPATH"
    $PYTHON_CMD -m uvicorn ws_gateway.main:app --reload --reload-include "*.py" --port 8001
    cd backend
elif [ "$API_ONLY" = true ]; then
    echo -e "${CYAN}Starting REST API only (port 8000)...${NC}"
    uvicorn rest_api.main:app --reload --reload-include "*.py" --port 8000
else
    # Start both services
    echo -e "${CYAN}Starting REST API (port 8000) and WebSocket Gateway (port 8001)...${NC}"
    echo -e "${GRAY}Press Ctrl+C to stop all services${NC}"
    echo ""

    # Start REST API in background
    uvicorn rest_api.main:app --reload --reload-include "*.py" --port 8000 &
    API_PID=$!
    echo -e "${GREEN}[REST API] Started (PID: $API_PID)${NC}"

    sleep 2

    # Start WebSocket Gateway from root directory
    cd ..
    export PYTHONPATH="$PWD/backend:$PYTHONPATH"
    $PYTHON_CMD -m uvicorn ws_gateway.main:app --reload --reload-include "*.py" --port 8001 &
    WS_PID=$!
    cd backend
    echo -e "${GREEN}[WS Gateway] Started (PID: $WS_PID)${NC}"

    # Wait for any process to exit
    wait
fi
