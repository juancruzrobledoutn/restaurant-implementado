#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Integrador - Backup Restore Script
# Run from the devOps/ directory: ./backup/restore.sh <backup-file.tar.gz>
# =============================================================================

# Configuration (override via environment variables)
POSTGRES_DB="${POSTGRES_DB:-menu_ops}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
DB_CONTAINER="${DB_CONTAINER:-integrador_db}"
REDIS_CONTAINER="${REDIS_CONTAINER:-integrador_redis}"
SKIP_CONFIRMATION="${SKIP_CONFIRMATION:-false}"

RESTORE_TEMP_DIR=""

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# -----------------------------------------------------------------------------
# Cleanup on exit
# -----------------------------------------------------------------------------
cleanup() {
    if [[ -n "$RESTORE_TEMP_DIR" && -d "$RESTORE_TEMP_DIR" ]]; then
        rm -rf "$RESTORE_TEMP_DIR"
        log_info "Cleaned up temp directory"
    fi
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# Usage
# -----------------------------------------------------------------------------
usage() {
    echo "Usage: $0 <backup-file.tar.gz> [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --skip-confirmation    Skip the interactive confirmation prompt"
    echo "  --postgres-only        Restore only PostgreSQL (skip Redis)"
    echo "  --redis-only           Restore only Redis (skip PostgreSQL)"
    echo "  -h, --help             Show this help"
    echo ""
    echo "Examples:"
    echo "  ./backup/restore.sh ./backups/integrador_backup_20260404_030000.tar.gz"
    echo "  SKIP_CONFIRMATION=true ./backup/restore.sh ./backups/integrador_weekly_20260330_020000.tar.gz"
    exit 1
}

# -----------------------------------------------------------------------------
# Parse arguments
# -----------------------------------------------------------------------------
BACKUP_FILE=""
RESTORE_POSTGRES=true
RESTORE_REDIS=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-confirmation) SKIP_CONFIRMATION=true; shift ;;
        --postgres-only)     RESTORE_REDIS=false; shift ;;
        --redis-only)        RESTORE_POSTGRES=false; shift ;;
        -h|--help)           usage ;;
        -*)                  log_error "Unknown option: $1"; usage ;;
        *)                   BACKUP_FILE="$1"; shift ;;
    esac
done

if [[ -z "$BACKUP_FILE" ]]; then
    log_error "Backup file argument is required"
    usage
fi

# -----------------------------------------------------------------------------
# Validate backup file
# -----------------------------------------------------------------------------
validate_backup() {
    log_info "Validating backup file: ${BACKUP_FILE}"

    if [[ ! -f "$BACKUP_FILE" ]]; then
        log_error "File not found: ${BACKUP_FILE}"
        exit 1
    fi

    if [[ ! "$BACKUP_FILE" == *.tar.gz ]]; then
        log_error "File must be a .tar.gz archive"
        exit 1
    fi

    # Check file is a valid gzip archive
    if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
        log_error "File is not a valid gzip archive"
        exit 1
    fi

    log_info "Backup file is valid"
}

# -----------------------------------------------------------------------------
# Extract and verify contents
# -----------------------------------------------------------------------------
extract_backup() {
    RESTORE_TEMP_DIR=$(mktemp -d)
    log_info "Extracting to temporary directory..."

    tar -xzf "$BACKUP_FILE" -C "$RESTORE_TEMP_DIR"

    # Show metadata if available
    if [[ -f "${RESTORE_TEMP_DIR}/metadata.txt" ]]; then
        echo ""
        echo "--- Backup Metadata ---"
        cat "${RESTORE_TEMP_DIR}/metadata.txt"
        echo "-----------------------"
        echo ""
    fi

    # Verify expected contents
    local has_postgres=false
    local has_redis=false

    if [[ -f "${RESTORE_TEMP_DIR}/postgres/${POSTGRES_DB}.sql" ]]; then
        has_postgres=true
        local pg_size
        pg_size=$(stat -c%s "${RESTORE_TEMP_DIR}/postgres/${POSTGRES_DB}.sql" 2>/dev/null || stat -f%z "${RESTORE_TEMP_DIR}/postgres/${POSTGRES_DB}.sql" 2>/dev/null || echo "0")
        log_info "PostgreSQL dump found ($(numfmt --to=iec "$pg_size" 2>/dev/null || echo "${pg_size} bytes"))"
    else
        log_warn "No PostgreSQL dump found in archive"
        if [[ "$RESTORE_POSTGRES" == true ]]; then
            log_error "PostgreSQL restore requested but no dump file in archive"
            exit 1
        fi
    fi

    if [[ -d "${RESTORE_TEMP_DIR}/redis" ]] && [[ "$(find "${RESTORE_TEMP_DIR}/redis" -type f | wc -l)" -gt 0 ]]; then
        has_redis=true
        log_info "Redis data found"
    else
        log_warn "No Redis data found in archive"
    fi

    if [[ "$has_postgres" == false && "$has_redis" == false ]]; then
        log_error "Archive contains no restorable data"
        exit 1
    fi
}

# -----------------------------------------------------------------------------
# Confirmation prompt
# -----------------------------------------------------------------------------
confirm_restore() {
    if [[ "$SKIP_CONFIRMATION" == true ]]; then
        log_warn "Skipping confirmation (--skip-confirmation)"
        return 0
    fi

    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}         DESTRUCTIVE OPERATION          ${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "This will OVERWRITE the current database and Redis data."
    echo ""
    echo "  Backup file:       $(basename "$BACKUP_FILE")"
    echo "  Restore PostgreSQL: ${RESTORE_POSTGRES}"
    echo "  Restore Redis:      ${RESTORE_REDIS}"
    echo "  Target database:    ${POSTGRES_DB}"
    echo ""
    read -rp "Type 'RESTORE' to confirm: " confirmation

    if [[ "$confirmation" != "RESTORE" ]]; then
        log_info "Restore cancelled by user"
        exit 0
    fi
}

# -----------------------------------------------------------------------------
# Stop application services (keep db and redis running)
# -----------------------------------------------------------------------------
stop_app_services() {
    log_info "Stopping application services (backend, ws_gateway)..."

    docker compose stop backend ws_gateway 2>/dev/null || true

    # Give containers time to fully stop
    sleep 2

    log_info "Application services stopped"
}

# -----------------------------------------------------------------------------
# Restore PostgreSQL
# -----------------------------------------------------------------------------
restore_postgres() {
    if [[ "$RESTORE_POSTGRES" != true ]]; then
        log_info "Skipping PostgreSQL restore"
        return 0
    fi

    local dump_file="${RESTORE_TEMP_DIR}/postgres/${POSTGRES_DB}.sql"

    if [[ ! -f "$dump_file" ]]; then
        log_warn "No PostgreSQL dump to restore"
        return 0
    fi

    log_info "Restoring PostgreSQL database '${POSTGRES_DB}'..."

    # Terminate existing connections to the database
    docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
        2>/dev/null || true

    # Drop and recreate the database
    log_info "Dropping and recreating database..."
    docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c \
        "DROP DATABASE IF EXISTS ${POSTGRES_DB};" 2>/dev/null || true
    docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c \
        "CREATE DATABASE ${POSTGRES_DB};"

    # Ensure pgvector extension is available
    docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
        "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true

    # Restore the dump
    log_info "Loading SQL dump..."
    if docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$dump_file" 2>/dev/null; then
        log_info "PostgreSQL restore complete"
    else
        # psql may return non-zero on warnings (e.g., "role does not exist")
        # Verify by checking table count
        local table_count
        table_count=$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c \
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d '[:space:]')

        if [[ -n "$table_count" && "$table_count" -gt 0 ]]; then
            log_warn "PostgreSQL restore completed with warnings (${table_count} tables restored)"
        else
            log_error "PostgreSQL restore FAILED - no tables found after restore"
            return 1
        fi
    fi
}

# -----------------------------------------------------------------------------
# Restore Redis
# -----------------------------------------------------------------------------
restore_redis() {
    if [[ "$RESTORE_REDIS" != true ]]; then
        log_info "Skipping Redis restore"
        return 0
    fi

    local redis_dir="${RESTORE_TEMP_DIR}/redis"

    if [[ ! -d "$redis_dir" ]] || [[ "$(find "$redis_dir" -type f | wc -l)" -eq 0 ]]; then
        log_warn "No Redis data to restore"
        return 0
    fi

    log_info "Restoring Redis data..."

    # Stop Redis to replace data files
    docker compose stop redis
    sleep 1

    # Copy data files into the volume
    docker compose cp "${redis_dir}/." redis:/data/ 2>/dev/null || {
        # If container is stopped, start it briefly to copy
        docker compose start redis
        sleep 2
        docker compose cp "${redis_dir}/." redis:/data/
        docker compose stop redis
        sleep 1
    }

    # Start Redis back up
    docker compose start redis
    sleep 2

    # Verify Redis is responding
    if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
        log_info "Redis restore complete and responding"
    else
        log_warn "Redis may not have started correctly after restore"
    fi
}

# -----------------------------------------------------------------------------
# Restart all services and verify health
# -----------------------------------------------------------------------------
restart_and_verify() {
    log_info "Starting all services..."

    docker compose up -d

    log_info "Waiting for services to become healthy (up to 60s)..."

    local max_wait=60
    local elapsed=0
    local all_healthy=false

    while [[ $elapsed -lt $max_wait ]]; do
        sleep 5
        elapsed=$((elapsed + 5))

        local db_ok=false
        local redis_ok=false
        local backend_ok=false

        # Check DB
        if docker compose exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &>/dev/null; then
            db_ok=true
        fi

        # Check Redis
        if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
            redis_ok=true
        fi

        # Check Backend
        if curl -sf http://localhost:8000/api/health &>/dev/null; then
            backend_ok=true
        fi

        echo -ne "\r  [${elapsed}s] DB: $([ "$db_ok" = true ] && echo 'OK' || echo '..') | Redis: $([ "$redis_ok" = true ] && echo 'OK' || echo '..') | Backend: $([ "$backend_ok" = true ] && echo 'OK' || echo '..')"

        if [[ "$db_ok" == true && "$redis_ok" == true && "$backend_ok" == true ]]; then
            all_healthy=true
            break
        fi
    done

    echo ""

    if [[ "$all_healthy" == true ]]; then
        log_info "All services are healthy"
    else
        log_warn "Some services may not be fully healthy yet. Check with: docker compose ps"
    fi

    # Post-restore verification: check table count
    if [[ "$RESTORE_POSTGRES" == true ]]; then
        local table_count
        table_count=$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c \
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d '[:space:]')
        log_info "PostgreSQL verification: ${table_count} tables in '${POSTGRES_DB}'"
    fi

    if [[ "$RESTORE_REDIS" == true ]]; then
        local redis_keys
        redis_keys=$(docker compose exec -T redis redis-cli DBSIZE 2>/dev/null || echo "unknown")
        log_info "Redis verification: ${redis_keys}"
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    echo ""
    log_info "=========================================="
    log_info "Integrador - Backup Restore"
    log_info "=========================================="
    echo ""

    validate_backup
    extract_backup
    confirm_restore
    stop_app_services
    restore_postgres
    restore_redis
    restart_and_verify

    echo ""
    log_info "=========================================="
    log_info "Restore completed successfully"
    log_info "=========================================="
    echo ""
    log_info "Recommended post-restore checks:"
    echo "  1. Open Dashboard:  http://localhost:5177"
    echo "  2. Check API:       curl http://localhost:8000/api/health/detailed"
    echo "  3. Check WebSocket: curl http://localhost:8001/ws/health"
    echo "  4. Test login:      admin@demo.com / admin123"
    echo ""

    exit 0
}

main "$@"
