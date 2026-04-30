# 02. Dependencias

## Introduccion

Integrador utiliza un stack moderno tanto en frontend como en backend. Este documento detalla cada dependencia, su version, su proposito en el sistema y las razones por las que fue elegida. Entender las dependencias es fundamental para evaluar actualizaciones, resolver conflictos y tomar decisiones informadas sobre el stack.

---

## Backend (Python)

El backend corre sobre Python 3.12 con FastAPI como framework web. Las dependencias se gestionan con `requirements.txt` (sin poetry ni pipenv por simplicidad).

### Dependencias Principales

| Paquete | Version | Proposito | Notas |
|---------|---------|-----------|-------|
| **fastapi** | 0.115.6 | Framework web ASGI | Soporte nativo async, documentacion OpenAPI automatica, validacion con Pydantic |
| **uvicorn** | 0.34.0 | Servidor ASGI | Servidor de produccion para FastAPI. Usa `watchfiles` para hot-reload en desarrollo |
| **sqlalchemy** | 2.0.36 | ORM y query builder | Estilo 2.0 con `select()` en lugar del legacy `query()`. Soporte async disponible |
| **psycopg** | (bundled) | Driver PostgreSQL | psycopg3, el driver moderno. Reemplaza a psycopg2-binary |
| **alembic** | (presente) | Migraciones de base de datos | Genera migraciones automaticas a partir de cambios en los modelos SQLAlchemy |
| **pydantic** | 2.10.4 | Validacion de datos | Schemas de entrada/salida, serialization. Integrado nativamente con FastAPI |
| **pydantic-settings** | 2.7.1 | Gestion de configuracion | Lee variables de entorno y archivos `.env` con validacion de tipos |
| **redis** | 5.2.1 | Cliente Redis (async) | Pool de conexiones async. Se usa como singleton (no cerrar manualmente) |
| **pyjwt** | 2.10.1 | Tokens JWT | Generacion y verificacion de tokens. Soporta RS256 y HS256 |
| **passlib** | (presente) | Hashing de passwords | Backend bcrypt para hashing seguro de contrasenas |
| **httpx** | 0.28.1 | Cliente HTTP async | Para llamadas a servicios externos (Mercado Pago, Ollama) |
| **slowapi** | 0.1.9 | Rate limiting | Middleware de limitacion de tasa basado en Redis |
| **python-multipart** | (presente) | Upload de archivos | Requerido por FastAPI para parsear form-data (imagenes de productos) |

### Dependencias de IA (Opcionales)

| Paquete | Proposito |
|---------|-----------|
| **pgvector** | Extension PostgreSQL para busqueda vectorial (embeddings) |
| **ollama** (via httpx) | Integracion con modelos locales de IA para embeddings y chat |

### Dependencias de Desarrollo

| Paquete | Proposito |
|---------|-----------|
| **pytest** | Framework de testing |
| **pytest-asyncio** | Soporte para tests async |
| **watchfiles** | Hot-reload para uvicorn en Windows (reemplaza StatReload) |

### Relacion entre Dependencias del Backend

```
FastAPI
  ├── pydantic (validacion de schemas)
  ├── uvicorn (servidor ASGI)
  └── starlette (framework HTTP subyacente)

SQLAlchemy
  ├── psycopg (driver PostgreSQL)
  └── alembic (migraciones)

Seguridad
  ├── pyjwt (tokens)
  ├── passlib[bcrypt] (passwords)
  └── slowapi → redis (rate limiting)

Comunicacion
  ├── redis (eventos, cache, blacklist)
  └── httpx (servicios externos)
```

---

## Frontend Compartido

Los tres frontends comparten un nucleo comun de dependencias. Esto garantiza consistencia en la experiencia de desarrollo y reduce la friccion al moverse entre proyectos.

### Core Compartido

| Paquete | Version | Proposito |
|---------|---------|-----------|
| **react** | 19.2.0 | Libreria de UI. Version 19 con React Compiler para auto-memorizacion |
| **react-dom** | 19.2.0 | Renderizado en el DOM. Incluye nuevas APIs como `useFormStatus` |
| **zustand** | 5.0.9 | State management. 2KB, sin boilerplate, patron de selectores |
| **tailwindcss** | 4.1.18 | Framework CSS utility-first. Version 4 con nuevo engine |
| **typescript** | 5.9.3 | Tipado estatico. Configuracion estricta (`strict: true`) en todos los proyectos |

### Build y Desarrollo

| Paquete | Version | Proposito |
|---------|---------|-----------|
| **vite** | 7.2.4 | Build tool. HMR ultra-rapido, tree-shaking, code splitting automatico |
| **babel-plugin-react-compiler** | 1.0.0 | Compilador de React. Elimina la necesidad de `React.memo`, `useMemo`, `useCallback` manuales |
| **vite-plugin-pwa** | 1.2.0 | Genera Service Worker y manifesto para PWA |
| **workbox-window** | 7.4.0 | Gestion del Service Worker desde el cliente |
| **eslint** | (presente) | Linting con reglas de TypeScript |
| **typescript-eslint** | (presente) | Plugin ESLint para TypeScript |

### Testing

| Paquete | Version | Proposito |
|---------|---------|-----------|
| **vitest** | 4.0.16 (Dashboard, pwaMenu) / 3.2 (pwaWaiter) | Test runner compatible con Vite. API similar a Jest |
| **@testing-library/react** | 16.3.1 | Testing de componentes React. Enfoque en comportamiento, no implementacion |
| **@testing-library/jest-dom** | (presente) | Matchers adicionales para DOM (`toBeInTheDocument`, etc.) |
| **jsdom** | (presente) | Entorno DOM para tests unitarios sin navegador |

> **Nota**: pwaWaiter usa Vitest 3.2 en lugar de 4.0 porque fue creado antes de la actualizacion del stack. Esta pendiente la unificacion.

---

## Dashboard - Dependencias Especificas

| Paquete | Version | Proposito |
|---------|---------|-----------|
| **react-router-dom** | 7.2.0 | Enrutamiento SPA. Version 7 con loader/action pattern |
| **lucide-react** | 0.468.0 | Libreria de iconos. 400+ iconos como componentes React. Elegida sobre FontAwesome por su tamano |
| **web-vitals** | 5.1.0 | Monitoreo de performance (LCP, FID, CLS). Reporta metricas reales del usuario |

### Arquitectura de Dependencias del Dashboard

```
Dashboard
  ├── react-router-dom (navegacion entre secciones admin)
  ├── zustand (stores: auth, branch, tables, products, etc.)
  ├── lucide-react (iconografia consistente)
  └── web-vitals (metricas de rendimiento)
```

El Dashboard es la aplicacion mas pesada en terminos de funcionalidad pero mantiene dependencias minimas. No usa librerias de UI como Material UI o Ant Design; todo el diseno es custom con Tailwind CSS.

---

## pwaMenu - Dependencias Especificas

| Paquete | Version | Proposito |
|---------|---------|-----------|
| **i18next** | 25.7.3 | Framework de internacionalizacion. Soporte para espanol, ingles y portugues |
| **react-i18next** | 16.5.0 | Integracion de i18next con React. Hook `useTranslation()` y componente `Trans` |
| **mercadopago** | 2.11.0 | SDK oficial de Mercado Pago para pagos online |
| **qrcode.react** | 4.2.0 | Generacion de codigos QR como componentes React (para compartir mesa) |

### Arquitectura de Dependencias de pwaMenu

```
pwaMenu
  ├── i18next + react-i18next (toda la UI en 3 idiomas)
  ├── zustand (store modular: session, cart, menu, diners)
  ├── mercadopago SDK (checkout online)
  ├── qrcode.react (QR para invitar a la mesa)
  └── workbox (offline support, cache de menu)
```

### Sobre i18next

La internacionalizacion es un requisito central de pwaMenu. Ningun texto visible al usuario puede estar hardcodeado; todo pasa por la funcion `t()`. Los archivos de traduccion viven en `pwaMenu/public/locales/{es,en,pt}/translation.json`.

### Sobre Mercado Pago

Se usa el SDK de frontend (`mercadopago`) para renderizar el brick de pago. La clave publica (`VITE_MP_PUBLIC_KEY`) es la unica credencial expuesta al cliente. El access token del servidor se configura en el backend.

---

## pwaWaiter - Dependencias Especificas

| Paquete | Version | Proposito |
|---------|---------|-----------|
| **html2canvas** | 1.4.1 | Captura screenshots del DOM como canvas. Se usa para generar la imagen del ticket |
| **jspdf** | 4.1.0 | Generacion de PDFs en el cliente. Crea comprobantes fiscales para pagos manuales |

### Arquitectura de Dependencias de pwaWaiter

```
pwaWaiter
  ├── zustand (store: auth, tables, sectors, rounds)
  ├── html2canvas + jspdf (generacion de tickets/recibos)
  └── workbox (offline-first: cola de retry para acciones criticas)
```

### Sobre la Generacion de PDF

El flujo de generacion de comprobante fiscal es: captura del componente React con `html2canvas` y conversion a PDF con `jspdf`. Este enfoque evita dependencias de servidor para la generacion de documentos y funciona offline.

---

## Mapa de Versiones Criticas

| Tecnologia | Version | Fecha Estimada de EOL | Riesgo |
|------------|---------|----------------------|--------|
| React | 19.2.0 | ~2028 | Bajo (version actual) |
| Python | 3.12 | Oct 2028 | Bajo |
| PostgreSQL | 16 | Nov 2028 | Bajo |
| Node.js | 22 LTS | Apr 2027 | Bajo |
| Vite | 7.2 | ~2027 | Bajo (version actual) |
| TypeScript | 5.9 | ~2026 | Bajo (actualizar frecuentemente) |

---

## Politica de Actualizacion

1. **Dependencias de seguridad**: Actualizar inmediatamente (pyjwt, passlib, redis).
2. **Dependencias menores**: Actualizar mensualmente. Ejecutar tests completos antes de mergear.
3. **Dependencias mayores** (React, Vite, FastAPI): Evaluar en cada release. Actualizar solo si hay beneficio claro o la version actual se acerca a EOL.
4. **Dependencias de desarrollo** (eslint, vitest, prettier): Actualizar cuando sea conveniente. No bloquean produccion.

---

## Dependencias Notablemente Ausentes

| Libreria | Por Que No Se Usa | Alternativa |
|----------|-------------------|-------------|
| Redux | Excesivo boilerplate para este proyecto | Zustand |
| Material UI / Ant Design | Bundle size, personalizacion limitada | Tailwind CSS custom |
| Axios | httpx en backend, fetch nativo en frontend | fetch con wrapper custom |
| Socket.io | Demasiado pesado, abstracciones innecesarias | WebSocket nativo |
| Prisma / TypeORM (frontend) | No hay ORM en frontend | Fetch directo a API |
| Django | Demasiado opinionado, rendimiento inferior para async | FastAPI |
| Express | No tiene soporte nativo de tipos ni async | FastAPI (Python) |
