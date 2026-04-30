# Guía de desarrollo local

## Prerequisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) corriendo
- Git

Nada más. No necesitás instalar Python, Node, ni configurar nada manualmente.

---

## Levantar el sistema

Desde la raíz del repo:

```bash
docker compose up -d
```

La primera vez construye las imágenes (~2-3 minutos). Las siguientes veces arranca en segundos.

Cuando termina, tenés disponible:

| URL | Servicio |
|-----|---------|
| http://localhost:5177 | Dashboard (admin) |
| http://localhost:8000 | Backend API |
| ws://localhost:8001 | WebSocket Gateway |
| http://localhost:5050 | pgAdmin (explorar la DB) |

### Usuarios de prueba

| Email | Contraseña | Rol |
|-------|-----------|-----|
| admin@demo.com | admin123 | ADMIN |
| manager@demo.com | manager123 | MANAGER |
| waiter@demo.com | waiter123 | WAITER |
| kitchen@demo.com | kitchen123 | KITCHEN |

Los usuarios y datos de demo se crean automáticamente al iniciar.

---

## Comandos útiles

```bash
# Apagar todo
docker compose down

# Ver logs de todos los servicios
docker compose logs -f

# Ver logs de un servicio específico
docker compose logs -f backend

# Abrir shell en el backend
docker compose exec backend sh

# Correr migraciones manualmente
docker compose exec backend alembic upgrade head

# Seed con datos de demo ricos (útil para testing manual)
docker compose exec backend python -m rest_api.seeds.runner --full

# Reconstruir imágenes (después de cambiar Dockerfile o requirements.txt)
docker compose build

# Borrar todos los datos y empezar de cero
docker compose down -v && docker compose up -d
```

Si tenés `make` instalado, hay shortcuts equivalentes:

```bash
make            # ver todos los comandos disponibles
make up         # levantar todo
make down       # apagar todo
make logs s=backend   # logs de un servicio
make seed-full  # seed con datos ricos
make reset      # borrar datos y reiniciar
```

---

## Hot-reload

Los cambios en el código se detectan automáticamente sin reiniciar los contenedores:

- **Backend** (`backend/`): uvicorn detecta cambios y recarga el módulo
- **Dashboard** (`Dashboard/src/`): Vite HMR actualiza el browser al instante

Si cambiás `requirements.txt` o `package.json`, necesitás reconstruir:

```bash
docker compose build backend   # o: dashboard
docker compose up -d
```

---

## Variables de entorno

Para desarrollo local **no necesitás crear ningún archivo `.env`** — todas las variables están configuradas en `compose.yaml` con valores de desarrollo.

Para producción, usá `devOps/docker-compose.prod.yml` con secrets reales (ver `knowledge-base/04-infraestructura/01_configuracion_y_entornos.md`).

---

## Estructura del sistema

```
compose.yaml          ← punto de entrada para desarrollo local
backend/              ← FastAPI + SQLAlchemy (puerto 8000)
ws_gateway/           ← WebSocket Gateway (puerto 8001)
Dashboard/            ← React 19 + Vite (puerto 5177)
pwaMenu/              ← PWA para comensales (puerto 5176)
pwaWaiter/            ← PWA para mozos (puerto 5178)
devOps/               ← Docker Compose de producción + monitoreo
knowledge-base/       ← documentación del dominio y arquitectura
openspec/             ← specs y changes (workflow SDD)
```

---

## Solución de problemas frecuentes

**Los contenedores no inician / error de puerto ocupado**

Verificá que no haya otros servicios corriendo en los mismos puertos:
```bash
docker compose down
docker compose up -d
```

**Error de permisos en volúmenes (Linux/Mac)**

```bash
sudo chown -R $USER:$USER backend/ Dashboard/
```

**Quiero empezar de cero (borrar todos los datos)**

```bash
docker compose down -v
docker compose up -d
```

**El backend tarda en iniciar**

Es normal en el primer arranque — espera a que aplique las migraciones y el seed. Podés seguir el progreso con:
```bash
docker compose logs -f backend
```
