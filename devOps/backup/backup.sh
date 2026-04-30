#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Integrador - PostgreSQL & Redis Backup Script
# Run from the devOps/ directory: ./backup/backup.sh
# =============================================================================

# Configuration (override via environment variables)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAILY=${RETENTION_DAILY:-7}
RETENTION_WEEKLY=${RETENTION_WEEKLY:-4}
POSTGRES_DB="${POSTGRES_DB:-menu_ops}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
DB_CONTAINER="${DB_CONTAINER:-integrador_db}"
REDIS_CONTAINER="${REDIS_CONTAINER:-integrador_redis}"

# Derived values
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
BACKUP_NAME="integrador_backup_${TIMESTAMP}"
BACKUP_TYPE="${BACKUP_TYPE:-daily}"
LOG_FILE="${BACKUP_DIR}/backup.log"
TEMP_DIR="${BACKUP_DIR}/tmp_${TIMESTAMP}"

# Mark weekly backups on Sunday or when explicitly requested
if [[ "$DAY_OF_WEEK" -eq 7 ]] || [[ "$BACKUP_TYPE" == "weekly" ]]; then
    BACKUP_NAME="integrador_weekly_${TIMESTAMP}"
    BACKUP_TYPE="weekly"
fi

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
log() {
    local level="$1"
    shift
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] $*"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

log_info()  { log "INFO"  "$@"; }
log_warn()  { log "WARN"  "$@"; }
log_error() { log "ERROR" "$@"; }

# -----------------------------------------------------------------------------
# Cleanup on exit (remove temp files)
# -----------------------------------------------------------------------------
cleanup() {
    if [[ -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
        log_info "Cleaned up temp directory: ${TEMP_DIR}"
    fi
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# Pre-flight checks
# -----------------------------------------------------------------------------
preflight() {
    log_info "Running pre-flight checks..."

    if ! command -v docker &> /dev/null; then
        log_error "docker is not installed or not in PATH"
        exit 1
    fi

    if ! docker compose ps --status running 2>/dev/null | grep -q "$DB_CONTAINER"; then
        log_error "PostgreSQL container '${DB_CONTAINER}' is not running"
        exit 1
    fi

    if ! docker compose ps --status running 2>/dev/null | grep -q "$REDIS_CONTAINER"; then
        log_warn "Redis container '${REDIS_CONTAINER}' is not running - Redis backup will be skipped"
    fi

    log_info "Pre-flight checks passed"
}

# -----------------------------------------------------------------------------
# Create backup directory structure
# -----------------------------------------------------------------------------
setup_dirs() {
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$TEMP_DIR/postgres"
    mkdir -p "$TEMP_DIR/redis"
    log_info "Backup directories ready: ${BACKUP_DIR}"
}

# -----------------------------------------------------------------------------
# PostgreSQL backup via pg_dump inside container
# -----------------------------------------------------------------------------
backup_postgres() {
    log_info "Starting PostgreSQL backup of database '${POSTGRES_DB}'..."

    local dump_file="${TEMP_DIR}/postgres/${POSTGRES_DB}.sql"

    if ! docker compose exec -T db pg_dump \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        --verbose \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        > "$dump_file" 2>> "$LOG_FILE"; then
        log_error "PostgreSQL dump FAILED"
        return 1
    fi

    local dump_size
    dump_size=$(stat -c%s "$dump_file" 2>/dev/null || stat -f%z "$dump_file" 2>/dev/null || echo "0")

    if [[ "$dump_size" -eq 0 ]]; then
        log_error "PostgreSQL dump file is empty (0 bytes)"
        return 1
    fi

    log_info "PostgreSQL backup complete: ${dump_file} ($(numfmt --to=iec "$dump_size" 2>/dev/null || echo "${dump_size} bytes"))"
}

# -----------------------------------------------------------------------------
# Redis backup (AOF + RDB snapshot)
# -----------------------------------------------------------------------------
backup_redis() {
    log_info "Starting Redis backup..."

    # Trigger a BGSAVE to ensure we have a recent RDB snapshot
    if docker compose exec -T redis redis-cli BGSAVE &>> "$LOG_FILE"; then
        log_info "Redis BGSAVE triggered, waiting for completion..."
        sleep 2
    else
        log_warn "Redis BGSAVE failed, proceeding with existing data files"
    fi

    # Copy data from Redis container
    if docker compose cp redis:/data/. "${TEMP_DIR}/redis/" 2>> "$LOG_FILE"; then
        local redis_files
        redis_files=$(find "${TEMP_DIR}/redis" -type f 2>/dev/null | wc -l)
        log_info "Redis backup complete: ${redis_files} file(s) copied"
    else
        log_warn "Redis data copy failed - Redis backup skipped"
    fi
}

# -----------------------------------------------------------------------------
# Compress backup into tar.gz archive
# -----------------------------------------------------------------------------
compress_backup() {
    local archive="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"

    log_info "Compressing backup to ${archive}..."

    # Store metadata
    cat > "${TEMP_DIR}/metadata.txt" <<METADATA
Backup: ${BACKUP_NAME}
Type: ${BACKUP_TYPE}
Timestamp: $(date -Iseconds)
Database: ${POSTGRES_DB}
PostgreSQL Container: ${DB_CONTAINER}
Redis Container: ${REDIS_CONTAINER}
Docker Compose Version: $(docker compose version --short 2>/dev/null || echo "unknown")
METADATA

    if ! tar -czf "$archive" -C "$TEMP_DIR" .; then
        log_error "Compression FAILED"
        return 1
    fi

    local archive_size
    archive_size=$(stat -c%s "$archive" 2>/dev/null || stat -f%z "$archive" 2>/dev/null || echo "0")

    if [[ "$archive_size" -eq 0 ]]; then
        log_error "Archive is empty (0 bytes)"
        return 1
    fi

    log_info "Archive created: ${archive} ($(numfmt --to=iec "$archive_size" 2>/dev/null || echo "${archive_size} bytes"))"
}

# -----------------------------------------------------------------------------
# Rotation: keep N daily + M weekly backups
# -----------------------------------------------------------------------------
rotate_backups() {
    log_info "Rotating backups (keep ${RETENTION_DAILY} daily, ${RETENTION_WEEKLY} weekly)..."

    # Rotate daily backups (exclude weekly)
    local daily_count=0
    while IFS= read -r file; do
        daily_count=$((daily_count + 1))
        if [[ $daily_count -gt $RETENTION_DAILY ]]; then
            log_info "Removing old daily backup: $(basename "$file")"
            rm -f "$file"
        fi
    done < <(find "$BACKUP_DIR" -maxdepth 1 -name "integrador_backup_*.tar.gz" -type f | sort -r)

    # Rotate weekly backups
    local weekly_count=0
    while IFS= read -r file; do
        weekly_count=$((weekly_count + 1))
        if [[ $weekly_count -gt $RETENTION_WEEKLY ]]; then
            log_info "Removing old weekly backup: $(basename "$file")"
            rm -f "$file"
        fi
    done < <(find "$BACKUP_DIR" -maxdepth 1 -name "integrador_weekly_*.tar.gz" -type f | sort -r)

    log_info "Rotation complete (daily: ${daily_count}, weekly: ${weekly_count})"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    log_info "=========================================="
    log_info "Backup started: ${BACKUP_NAME} (type: ${BACKUP_TYPE})"
    log_info "=========================================="

    preflight
    setup_dirs

    local failed=0

    backup_postgres || failed=1

    if [[ $failed -eq 1 ]]; then
        log_error "PostgreSQL backup failed - aborting"
        exit 1
    fi

    backup_redis || log_warn "Redis backup had issues (non-fatal)"

    compress_backup || failed=1

    if [[ $failed -eq 1 ]]; then
        log_error "Compression failed - aborting"
        exit 1
    fi

    rotate_backups

    log_info "=========================================="
    log_info "Backup completed successfully: ${BACKUP_NAME}.tar.gz"
    log_info "=========================================="

    exit 0
}

main "$@"
