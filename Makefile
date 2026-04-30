# Integrador — Makefile de desarrollo local
#
# Prerequisito: Docker Desktop corriendo
# Uso: make <comando>

.PHONY: dev up down logs build reset migrate seed seed-full shell help

## Levantar todo el sistema (primera vez: construye las imágenes, ~2-3 min)
dev: up

## Levantar todos los servicios en background
up:
	docker compose up -d

## Apagar todos los servicios
down:
	docker compose down

## Ver logs en tiempo real (todos los servicios)
##   Servicio específico: make logs s=backend
logs:
	docker compose logs -f $(s)

## Reconstruir imágenes (necesario si cambiaron Dockerfile o requirements.txt)
build:
	docker compose build

## Correr migraciones manualmente
migrate:
	docker compose exec backend alembic upgrade head

## Correr seed base (tenant, usuarios, menú demo)
seed:
	docker compose exec backend python -m rest_api.seeds.runner

## Correr seed completo (incluye datos de demo ricos — solo para dev)
seed-full:
	docker compose exec backend python -m rest_api.seeds.runner --full

## Abrir shell en un servicio
##   Ejemplo: make shell s=backend
shell:
	docker compose exec $(s) sh

## ⚠️  Borrar TODOS los datos y empezar de cero
reset:
	docker compose down -v
	docker compose up -d

## Mostrar esta ayuda
help:
	@echo ""
	@echo "  Integrador — comandos disponibles:"
	@echo ""
	@grep -E '^##.*' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/^  $$//'
	@echo ""

.DEFAULT_GOAL := help
