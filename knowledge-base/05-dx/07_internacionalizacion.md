> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Internacionalizacion (i18n)

Estado completo de internacionalizacion en todos los componentes del sistema.

---

## Estado general

| Componente | Framework | Setup | Idiomas | Keys | Cobertura | Calidad |
|------------|-----------|:-----:|---------|:----:|-----------|---------|
| pwaMenu | i18next + react-i18next | Completo | es, en, pt | ~500 | 100% (zero hardcoded) | es=alta, en=buena, pt=buena |
| Dashboard | i18next + react-i18next | Setup basico | es, en | ~25 | ~5% (sidebar + common) | Scaffold |
| pwaWaiter | Ninguno | Sin setup | es (hardcoded) | 0 | 0% | Sin i18n |
| Backend errors | Mensajes inline | Parcial | es | N/A | ~50% | Mensajes en espanol hardcodeados |
| Backend schemas | Pydantic | N/A | Agnostico | N/A | N/A | Field names en ingles |

---

## pwaMenu — COMPLETO

El unico componente con i18n completo y funcional.

### Configuracion

| Aspecto | Detalle |
|---------|---------|
| Config | `pwaMenu/src/i18n/index.ts` |
| Locales | `pwaMenu/src/i18n/locales/{es,en,pt}.json` |
| Fallback chain | en → es, pt → es (espanol es el idioma mas completo) |
| Detector | localStorage validado (previene injection de idiomas no soportados) |
| Storage key | `pwamenu-language` |
| Keys totales | ~500 |

### Regla estricta

**TODO texto visible al usuario DEBE usar `t()`** — zero strings hardcodeados. Esto incluye:
- Labels, placeholders, tooltips
- Mensajes de error mostrados al usuario
- Textos de botones y links
- Banners y notificaciones (ej: `cart.payingBanner`)

### Ejemplo de uso

```typescript
import { useTranslation } from 'react-i18next'

function MyComponent() {
  const { t } = useTranslation()
  return <button>{t('cart.submit')}</button>
}
```

### Estructura de keys

```json
{
  "common": {
    "loading": "Cargando...",
    "error": "Ocurrio un error",
    "retry": "Reintentar"
  },
  "menu": {
    "title": "Menu",
    "search": "Buscar platos..."
  },
  "cart": {
    "title": "Tu pedido",
    "submit": "Enviar pedido",
    "payingBanner": "Mesa en proceso de pago"
  }
}
```

---

## Dashboard — SCAFFOLD

Setup basico creado pero sin adopcion generalizada.

### Configuracion

| Aspecto | Detalle |
|---------|---------|
| Config | `Dashboard/src/i18n/index.ts` |
| Locales | `Dashboard/src/i18n/locales/{es,en}.json` |
| Keys totales | ~25 (sidebar: 14, common: ~10) |

### Estado actual

- Los archivos de configuracion y locales existen
- **NO esta importado** en `App.tsx` ni `main.tsx`
- Las dependencias `i18next` y `react-i18next` pueden no estar instaladas
- El 95% de la UI sigue usando strings hardcodeados en espanol

### Para activar

```bash
# 1. Instalar dependencias (si no estan)
cd Dashboard && npm install i18next react-i18next

# 2. Importar en main.tsx
import './i18n'  # Agregar al inicio del archivo

# 3. Usar en componentes
import { useTranslation } from 'react-i18next'
const { t } = useTranslation()
```

### Esfuerzo para completar

- Paginas del Dashboard: ~20
- Componentes con texto: ~50+
- Estimacion: 3-5 dias para migracion completa

---

## pwaWaiter — SIN i18n

No tiene ningun setup de internacionalizacion. Todo el texto esta hardcodeado en espanol.

### Para implementar desde cero

1. Copiar estructura de `pwaMenu/src/i18n/`
2. Instalar `i18next` y `react-i18next`
3. Crear archivos de locales (`es.json`, `en.json`)
4. Importar en `main.tsx`
5. Migrar todos los strings hardcodeados a `t()`

### Alcance

| Elemento | Cantidad aproximada |
|----------|-------------------|
| Paginas | 7 |
| Componentes con texto | ~15 |
| Strings a migrar | ~100-150 |
| Esfuerzo estimado | 2-3 dias |

---

## Backend — PARCIAL

### Estado actual

**Mensajes en espanol hardcodeados:**
```python
# En servicios de dominio
entity_name = "Producto"          # Se usa en mensajes de error
raise NotFoundError("Producto", product_id)  # "Producto 42 no encontrado"
raise ValidationError("La sesion no esta activa")
```

**Schemas Pydantic:**
```python
# Field names en ingles (snake_case) — esto es correcto y no necesita i18n
class ProductOutput(BaseModel):
    id: int
    name: str
    price_cents: int
    is_active: bool
```

### Opciones para i18n backend

| Opcion | Complejidad | Beneficio |
|--------|-------------|-----------|
| Mantener como esta | Ninguna | Mensajes de error solo los ven devs y logs |
| Accept-Language header | Media | Errores en idioma del cliente |
| gettext / i18n middleware | Alta | Internacionalizacion completa |

> **Recomendacion:** Los mensajes de error del backend son consumidos por los frontends, que pueden traducirlos localmente. Internacionalizar el backend tiene bajo ROI.

---

## Prioridades de implementacion

### Prioridad alta

**Completar Dashboard i18n**
- Impacto: Permite a managers y admins de diferentes paises usar el sistema
- Esfuerzo: 3-5 dias
- Prerrequisito: Instalar dependencias, importar en main.tsx, migrar pagina por pagina

### Prioridad media

**Agregar i18n a pwaWaiter**
- Impacto: Permite a mozos de diferentes paises usar la app
- Esfuerzo: 2-3 dias
- Prerrequisito: Ninguno (empezar de cero)

### Prioridad baja

**i18n de mensajes de error del backend**
- Impacto: Mejora debugging para equipos no hispanohablantes
- Esfuerzo: 1-2 dias
- Prerrequisito: Definir estrategia (Accept-Language vs gettext)

### No necesario

**i18n de schemas Pydantic**
- Los field names son API interna (snake_case ingles)
- Cambiarlos romperia todos los frontends
- No tiene sentido traducirlos

---

## Consideraciones tecnicas

### Pluralizacion

i18next maneja pluralizacion automaticamente:

```json
{
  "items": "{{count}} item",
  "items_plural": "{{count}} items"
}
```

Portugues tiene reglas de pluralizacion diferentes al espanol/ingles — verificar que las traducciones PT las manejen correctamente.

### Formatos de fecha y moneda

Actualmente NO hay formateo locale-aware de fechas ni monedas. El sistema usa:
- Fechas: formato ISO o custom por componente
- Moneda: siempre pesos argentinos (ARS), formateado en frontend

Para soportar multiples monedas/formatos, considerar `Intl.NumberFormat` y `Intl.DateTimeFormat`.

### RTL (Right-to-Left)

No hay soporte RTL ni esta planificado. Si se agrega arabe o hebreo en el futuro, se necesitaria:
- CSS logical properties (`margin-inline-start` en vez de `margin-left`)
- Atributo `dir="rtl"` condicional en el HTML root
- Revision de layouts flexbox/grid
