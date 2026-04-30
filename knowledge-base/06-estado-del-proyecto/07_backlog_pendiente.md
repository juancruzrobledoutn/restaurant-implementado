> Creado: 2026-04-05 | Actualizado: 2026-04-06 | Estado: vigente

# Backlog Pendiente — Gap Analysis

## Análisis del Estado Actual

Tras un análisis exhaustivo del repositorio, la base de datos, los servicios de backend, los tres frontends y el gateway de WebSocket, se identificó que el sistema cuenta con una base sólida de funcionalidades operativas. El backend dispone de cincuenta y dos modelos de datos, diez servicios de dominio y nueve grupos de enrutadores. El Dashboard tiene veinticuatro páginas funcionales, el menú digital opera con carrito compartido y pagos integrados, y la aplicación del mozo gestiona mesas con notificaciones en tiempo real. El gateway de WebSocket maneja más de cuarenta tipos de eventos con entrega garantizada para eventos críticos.

Sin embargo, existen brechas significativas entre la infraestructura construida y las funcionalidades que requieren implementación completa, integración de extremo a extremo o refinamiento para alcanzar calidad de producción. Este documento organiza las historias de usuario pendientes en un backlog priorizado con dependencias explícitas y agrupación lógica por épicas.

---

## Criterios de Priorización

Las historias se ordenan según cuatro criterios combinados:

- **Valor operativo**: funcionalidades que habilitan flujos de negocio actualmente interrumpidos o incompletos.
- **Dependencias técnicas**: historias que desbloquean otras historias subsiguientes.
- **Nivel de gobernanza**: las historias en dominios críticos requieren revisión humana obligatoria; las de dominio bajo permiten autonomía completa.
- **Esfuerzo versus impacto**: se priorizan las de alto impacto con esfuerzo moderado sobre las de bajo impacto con alto esfuerzo.

---

## Épica 1 — Integración de Extremo a Extremo del Flujo Operativo

**Objetivo**: garantizar que los flujos principales del restaurante funcionen de manera continua desde el comensal hasta la cocina y de vuelta, sin interrupciones entre componentes.

**Justificación**: actualmente cada componente individual funciona, pero la coordinación entre ellos presenta fricciones que dificultan la operación real.

### HU-1.1 — Sincronización de estado de rondas entre Dashboard y pwaWaiter

**Como** gerente del restaurante, **quiero** que cuando apruebo y envío una ronda a cocina desde el Dashboard, el mozo vea inmediatamente el cambio de estado en su dispositivo, **para que** el personal de sala tenga visibilidad instantánea del progreso de cada pedido sin necesidad de consultar al gerente.

**Criterios de aceptación**:
- El mozo ve la transición CONFIRMED → SUBMITTED en menos de dos segundos tras la acción del gerente.
- El indicador de color de la tarjeta de mesa cambia de amarillo a azul.
- Si el mozo está desconectado temporalmente, al reconectar recibe el estado actualizado.
- El historial de rondas en el detalle de mesa refleja el nuevo estado.

**Dependencias**: ninguna.
**Gobernanza**: MEDIO (Orders).

---

### HU-1.2 — Notificación de pedido listo desde cocina al mozo

**Como** mozo, **quiero** recibir una alerta sonora y visual cuando la cocina marca un pedido como listo, **para que** pueda recogerlo inmediatamente y servirlo caliente al comensal.

**Criterios de aceptación**:
- Al marcar READY en el Dashboard de cocina, el mozo recibe notificación push con sonido en menos de tres segundos.
- La tarjeta de mesa activa la animación naranja pulsante de cinco segundos.
- El banner de pedido listo aparece en el detalle de mesa con el mensaje de recoger en cocina.
- El comensal en el menú digital ve el cambio de estado a listo en su historial de pedidos.
- El evento se transmite por Redis Streams para garantizar la entrega.

**Dependencias**: HU-1.1.
**Gobernanza**: MEDIO (Kitchen).

---

### HU-1.3 — Flujo completo de servido con confirmación del mozo

**Como** mozo, **quiero** marcar una ronda como servida desde mi dispositivo cuando entrego los platos en la mesa, **para que** el sistema registre la entrega y el comensal vea el estado final de su pedido.

**Criterios de aceptación**:
- El botón de marcar servido requiere confirmación antes de ejecutarse.
- Al confirmar, el estado cambia a SERVED en el dispositivo del mozo, el Dashboard y el menú del comensal.
- El contador de rondas abiertas de la tarjeta de mesa se decrementa.
- Si la operación falla por desconexión, se encola automáticamente para reintento.
- La acción se registra en el historial del mozo con marca temporal.

**Dependencias**: HU-1.2.
**Gobernanza**: MEDIO (Waiter).

---

### HU-1.4 — Flujo de cancelación de ronda con propagación completa

**Como** gerente, **quiero** cancelar una ronda pendiente o confirmada desde el Dashboard y que todos los actores involucrados reciban la notificación, **para que** el mozo deje de esperar un pedido que ya no se preparará y el comensal vea reflejada la cancelación.

**Criterios de aceptación**:
- Solo rondas en estado PENDING, CONFIRMED o SUBMITTED pueden cancelarse.
- Al cancelar, el evento ROUND_CANCELED llega al mozo, la cocina y el comensal.
- La tarjeta de mesa actualiza el contador de rondas abiertas.
- El motivo de cancelación se registra en el log de auditoría.
- Los ítems cancelados no se incluyen en el cálculo de la cuenta.

**Dependencias**: HU-1.1.
**Gobernanza**: ALTO (Orders).

---

## Épica 2 — Facturación y Pagos de Extremo a Extremo

**Objetivo**: completar el ciclo de pago desde la solicitud de cuenta hasta el cierre de mesa, integrando todos los métodos de pago y asegurando la trazabilidad financiera.

**Justificación**: el modelo de datos de facturación existe completo en el backend (Check, Charge, Allocation, Payment con algoritmo FIFO), pero la integración con los frontends necesita coordinación de extremo a extremo.

### HU-2.1 — Solicitud de cuenta desde el menú digital con notificación al mozo

**Como** comensal, **quiero** solicitar la cuenta desde mi dispositivo y que el mozo reciba una notificación inmediata, **para que** pueda prepararme para pagar sin necesidad de levantar la mano o esperar.

**Criterios de aceptación**:
- Al presionar el botón de solicitar cuenta, el sistema transiciona la sesión a estado PAYING.
- El mozo recibe una notificación con animación púrpura pulsante y sonido de alerta.
- El Dashboard muestra la mesa en estado de pago.
- El comensal ve el desglose de su consumo organizado por rondas.
- El evento CHECK_REQUESTED se transmite por el canal de Outbox para entrega garantizada.
- El comensal puede seguir agregando ítems al carrito durante el estado PAYING.

**Dependencias**: ninguna.
**Gobernanza**: CRITICO (Billing).

---

### HU-2.2 — División de cuenta entre comensales

**Como** comensal, **quiero** dividir la cuenta entre los integrantes de mi mesa eligiendo entre partes iguales, por consumo individual o un monto personalizado, **para que** cada persona pague lo que le corresponde sin complicaciones.

**Criterios de aceptación**:
- La pantalla de cierre muestra tres métodos de división: igualitario, por consumo y personalizado.
- La división por consumo asigna a cada comensal exactamente el monto de los ítems que ordenó.
- La división igualitaria reparte el total en partes iguales redondeando al centavo.
- La división personalizada permite ajustes manuales verificando que la suma total sea correcta.
- El selector de propina se aplica sobre el total y se distribuye proporcionalmente.
- Los montos se muestran en la moneda local con formato correcto.

**Dependencias**: HU-2.1.
**Gobernanza**: CRITICO (Billing).

---

### HU-2.3 — Pago con Mercado Pago desde el menú digital

**Como** comensal, **quiero** pagar mi parte de la cuenta a través de Mercado Pago directamente desde mi dispositivo, **para que** no necesite esperar a que el mozo procese mi tarjeta.

**Criterios de aceptación**:
- Al seleccionar Mercado Pago, el sistema genera una preferencia de pago con el monto del comensal.
- El comensal es redirigido a la pasarela de Mercado Pago.
- Al completar el pago, la aplicación muestra el resultado: aprobado, pendiente o rechazado.
- El evento PAYMENT_APPROVED o PAYMENT_REJECTED se difunde al mozo y al Dashboard.
- El registro de pago se crea atómicamente en la base de datos usando el patrón Outbox.
- En desarrollo se puede utilizar el modo simulado sin interactuar con la pasarela real.

**Dependencias**: HU-2.2.
**Gobernanza**: CRITICO (Billing).

---

### HU-2.4 — Registro de pago manual por el mozo

**Como** mozo, **quiero** registrar pagos en efectivo, tarjeta física o transferencia desde mi dispositivo, **para que** el sistema refleje los pagos realizados por medios no digitales.

**Criterios de aceptación**:
- El mozo puede seleccionar el método manual: efectivo, tarjeta física, transferencia externa u otro.
- El monto se ingresa manualmente con validación de que no exceda el saldo pendiente.
- Al registrar, el evento PAYMENT_APPROVED llega al comensal y al Dashboard.
- El Dashboard refleja el pago parcial o total en el resumen de la sesión.
- La acción se encola para reintento si el mozo está desconectado.

**Dependencias**: HU-2.1.
**Gobernanza**: CRITICO (Billing).

---

### HU-2.5 — Cierre de mesa tras pago completo

**Como** mozo, **quiero** cerrar una mesa cuando todos los pagos se han completado, **para que** la mesa quede liberada para los próximos comensales y el historial de la sesión se archive.

**Criterios de aceptación**:
- El botón de cierre solo se habilita cuando el saldo pendiente es cero.
- Al cerrar, la sesión transiciona a CLOSED y la mesa vuelve a estado FREE.
- El evento TABLE_CLEARED se difunde a todos los comensales de la mesa, cerrando sus sesiones.
- El Dashboard refleja la mesa como libre inmediatamente.
- El historial de la sesión queda accesible para consulta desde reportes.
- Los tokens de mesa de los comensales se invalidan.

**Dependencias**: HU-2.3 y HU-2.4.
**Gobernanza**: CRITICO (Billing).

---

## Épica 3 — Tickets de Cocina y Gestión de Preparación

**Objetivo**: implementar el sistema de tickets de cocina que fragmenta las rondas en tickets por estación de preparación, permitiendo a la cocina gestionar la preparación de cada plato de manera independiente.

**Justificación**: el modelo de datos KitchenTicket y KitchenTicketItem existe en el backend junto con los eventos TICKET_IN_PROGRESS, TICKET_READY y TICKET_DELIVERED, pero la interfaz de cocina del Dashboard necesita expandirse para aprovechar este modelo.

### HU-3.1 — Generación automática de tickets al enviar ronda a cocina

**Como** sistema, **quiero** fragmentar automáticamente cada ronda enviada a cocina en tickets individuales agrupados por estación de preparación, **para que** cada sector de la cocina reciba únicamente los ítems que le corresponden.

**Criterios de aceptación**:
- Al transicionar una ronda a SUBMITTED, el backend genera tickets según la estación asignada a cada producto.
- Cada ticket contiene solo los ítems correspondientes a una estación.
- Los tickets se crean atómicamente dentro de la misma transacción que la transición de la ronda.
- El evento ROUND_SUBMITTED incluye los identificadores de los tickets generados.

**Dependencias**: ninguna.
**Gobernanza**: MEDIO (Kitchen).

---

### HU-3.2 — Vista de tickets en la interfaz de cocina

**Como** cocinero, **quiero** ver los tickets de mi estación organizados por prioridad y antigüedad, **para que** pueda preparar los platos en el orden correcto y no se me pase ningún pedido.

**Criterios de aceptación**:
- La vista de cocina muestra tickets en tres columnas: nuevos, en preparación y listos.
- Cada ticket muestra el número de mesa, los ítems con cantidad, notas especiales y el tiempo transcurrido.
- Los tickets se ordenan por hora de llegada, con los más antiguos primero.
- El cocinero puede mover un ticket a en preparación con un toque.
- El cocinero puede marcar un ticket como listo con un toque y confirmación.
- Los eventos TICKET_IN_PROGRESS y TICKET_READY se difunden al mozo y al Dashboard.

**Dependencias**: HU-3.1.
**Gobernanza**: MEDIO (Kitchen).

---

### HU-3.3 — Consolidación de estado de ronda a partir de tickets

**Como** sistema, **quiero** actualizar automáticamente el estado de la ronda cuando todos sus tickets alcanzan el estado de listo, **para que** el mozo reciba una única notificación de pedido completo en lugar de una por cada ticket.

**Criterios de aceptación**:
- Cuando el último ticket de una ronda se marca como READY, la ronda transiciona automáticamente a READY.
- Si algunos tickets están listos y otros en preparación, la ronda muestra el estado IN_KITCHEN.
- El mozo ve el indicador naranja de listo con ítems en cocina cuando la ronda tiene preparación parcial.
- El evento ROUND_READY se emite por Redis Streams para entrega garantizada.

**Dependencias**: HU-3.2.
**Gobernanza**: MEDIO (Kitchen).

---

## Épica 4 — Fidelización de Clientes

**Objetivo**: implementar progresivamente el sistema de fidelización que reconoce a los comensales recurrentes y personaliza su experiencia.

**Justificación**: la fase uno de reconocimiento por dispositivo está operativa. Las fases subsiguientes requieren completar la infraestructura de backend y construir las interfaces de consentimiento y personalización.

### HU-4.1 — Persistencia de preferencias implícitas entre sesiones

**Como** comensal recurrente, **quiero** que mis filtros de alérgenos y preferencias dietéticas se recuerden cuando vuelvo al restaurante, **para que** no tenga que configurarlos nuevamente cada vez que visito.

**Criterios de aceptación**:
- Al activar filtros de alérgenos o preferencias dietéticas, se sincronizan automáticamente con el servidor tras dos segundos de inactividad.
- Las preferencias se asocian al identificador de dispositivo, no a una cuenta de usuario.
- Al escanear el código de mesa en una visita posterior, las preferencias se cargan automáticamente.
- Si la carga de preferencias falla, el menú se muestra sin filtros preconfigurados y sin error visible.
- Las preferencias se almacenan con un identificador de versión que permite migraciones futuras.

**Dependencias**: ninguna.
**Gobernanza**: MEDIO (Customer).

---

### HU-4.2 — Reconocimiento de dispositivo y saludo personalizado

**Como** comensal frecuente, **quiero** que el sistema me reconozca al escanear el código de mesa y me salude por mi nombre anterior, **para que** sienta que el restaurante valora mi fidelidad.

**Criterios de aceptación**:
- Al registrarse como comensal, el sistema consulta si el dispositivo tiene historial previo.
- Si existe historial, el campo de nombre se precarga con el nombre utilizado en la última visita.
- Se muestra un mensaje de bienvenida personalizado indicando el número de visita.
- El comensal puede cambiar el nombre precargado antes de unirse a la mesa.
- La consulta de reconocimiento no bloquea el flujo de ingreso; si falla, se continúa normalmente.

**Dependencias**: HU-4.1.
**Gobernanza**: MEDIO (Customer).

---

### HU-4.3 — Sugerencias basadas en historial de pedidos

**Como** comensal recurrente, **quiero** ver sugerencias de productos basadas en mis pedidos anteriores, **para que** pueda reordenar mis platos favoritos rápidamente.

**Criterios de aceptación**:
- En la pantalla principal del menú, se muestra una sección de tus favoritos si el dispositivo tiene historial.
- Los productos sugeridos se calculan por frecuencia de pedido del dispositivo.
- Se muestran un máximo de seis productos sugeridos en un carrusel horizontal.
- Los productos que ya no están disponibles o activos se excluyen de las sugerencias.
- Si el comensal no tiene historial suficiente, la sección no se muestra.

**Dependencias**: HU-4.2.
**Gobernanza**: BAJO (Customer).

---

### HU-4.4 — Registro voluntario de cliente con consentimiento

**Como** comensal, **quiero** registrarme voluntariamente con mi nombre, correo y teléfono para acceder a beneficios de fidelidad, **para que** mi historial se preserve aunque cambie de dispositivo.

**Criterios de aceptación**:
- El registro es completamente opcional y nunca se solicita de forma intrusiva.
- El formulario incluye casilla de consentimiento explícito para el tratamiento de datos personales.
- El texto de consentimiento cumple con las normativas de protección de datos vigentes.
- Al registrarse, el historial del dispositivo se vincula a la cuenta del cliente.
- El cliente puede consultar y eliminar sus datos en cualquier momento.
- El correo electrónico se valida con formato y el teléfono acepta formatos internacionales.

**Dependencias**: HU-4.3.
**Gobernanza**: CRITICO (Customer — datos personales).

---

## Épica 5 — Reportes y Analítica Operativa

**Objetivo**: dotar al Dashboard de herramientas de análisis que permitan a los gerentes tomar decisiones informadas sobre la operación del restaurante.

**Justificación**: las páginas de reportes existen en el Dashboard y los endpoints de backend están implementados, pero la presentación de datos necesita refinamiento y la cobertura de métricas debe ampliarse.

### HU-5.1 — Panel de ventas con métricas por período

**Como** gerente, **quiero** ver un resumen de ventas diarias, semanales y mensuales con gráficos comparativos, **para que** pueda identificar tendencias y tomar decisiones de negocio.

**Criterios de aceptación**:
- El panel muestra ventas totales, cantidad de pedidos, ticket promedio y comensales atendidos.
- Los datos se pueden filtrar por sucursal, rango de fechas y categoría de producto.
- Se incluyen gráficos de tendencia temporal que permiten comparar períodos.
- Los datos se actualizan en tiempo real cuando se completan pagos.
- El panel funciona correctamente con la zona horaria local del restaurante.

**Dependencias**: HU-2.5 (requiere flujo de pago completo para datos reales).
**Gobernanza**: BAJO (Reports).

---

### HU-5.2 — Productos más vendidos y análisis de categorías

**Como** gerente, **quiero** ver qué productos y categorías generan más ingresos y tienen mayor rotación, **para que** pueda optimizar el menú y las compras de insumos.

**Criterios de aceptación**:
- Se muestra un ranking de productos por cantidad vendida e ingreso generado.
- Los datos se pueden filtrar por sucursal y rango de fechas.
- Se identifica visualmente la participación de cada categoría en las ventas totales.
- Los productos sin ventas en el período se listan por separado para revisión.

**Dependencias**: HU-5.1.
**Gobernanza**: BAJO (Reports).

---

### HU-5.3 — Métricas de tiempo de servicio

**Como** gerente, **quiero** ver el tiempo promedio entre la recepción de un pedido y su entrega al comensal, **para que** pueda evaluar la eficiencia de la cocina y del personal de sala.

**Criterios de aceptación**:
- Se calcula el tiempo promedio por ronda desde SUBMITTED hasta SERVED.
- Se desglosa en tiempo de cocina (SUBMITTED → READY) y tiempo de servicio (READY → SERVED).
- Los datos se pueden filtrar por sucursal, sector y franja horaria.
- Se identifican los pedidos con tiempos atípicos para investigación.
- Los promedios se muestran con su desviación estándar para contextualizar.

**Dependencias**: HU-1.3 (requiere flujo de servido operativo para datos reales).
**Gobernanza**: BAJO (Reports).

---

### HU-5.4 — Historial de sesiones con detalle de consumo

**Como** gerente, **quiero** consultar el historial de sesiones de mesa con el detalle completo de consumo, pagos y tiempos, **para que** pueda resolver discrepancias y analizar patrones de ocupación.

**Criterios de aceptación**:
- Se lista el historial de sesiones con filtros por sucursal, fecha, mesa y mozo.
- Cada sesión muestra: hora de apertura, hora de cierre, cantidad de comensales, total consumido, método de pago y mozo asignado.
- Se puede expandir cada sesión para ver el detalle de rondas con ítems individuales.
- Los datos se paginan con diez registros por página.
- Se puede exportar el historial en formato de hoja de cálculo.

**Dependencias**: HU-2.5.
**Gobernanza**: BAJO (Reports).

---

## Épica 6 — Robustez Operativa y Calidad de Producción

**Objetivo**: resolver las brechas técnicas identificadas que podrían causar problemas en un entorno de producción con carga real.

### HU-6.1 — Persistencia durable de la cola de mensajes fallidos

**Como** administrador del sistema, **quiero** que los mensajes que fallan repetidamente en el gateway de WebSocket se persistan en almacenamiento durable, **para que** no se pierdan datos críticos si Redis se reinicia.

**Criterios de aceptación**:
- Los mensajes que alcanzan tres reintentos fallidos se archivan en almacenamiento persistente además de la cola de mensajes fallidos en Redis.
- El archivo incluye el evento completo, la razón del fallo, las marcas temporales de cada intento y el identificador de inquilino.
- Existe un mecanismo para reprocesar manualmente los mensajes archivados.
- Las métricas de Prometheus incluyen un contador de mensajes archivados.

**Dependencias**: ninguna.
**Gobernanza**: ALTO (WebSocket).

---

### HU-6.2 — Pruebas de integración del flujo completo de pedido

**Como** equipo de desarrollo, **quiero** contar con pruebas automatizadas que verifiquen el flujo completo desde que un comensal agrega un ítem al carrito hasta que la ronda se marca como servida, **para que** las regresiones se detecten antes del despliegue.

**Criterios de aceptación**:
- La prueba cubre: agregar ítem al carrito, enviar ronda, confirmar por mozo, enviar a cocina, marcar como lista, marcar como servida.
- Se verifica que cada evento WebSocket se emite correctamente en cada transición.
- Se verifica que el estado de la ronda es consistente en el backend tras cada paso.
- La prueba se ejecuta en el pipeline de integración continua.
- El tiempo de ejecución no excede los treinta segundos.

**Dependencias**: HU-1.3.
**Gobernanza**: BAJO.

---

### HU-6.3 — Reconciliación automática de estado tras reconexión

**Como** mozo, **quiero** que al reconectar mi dispositivo después de una desconexión prolongada, todas las mesas muestren su estado real actualizado, **para que** no tome decisiones basadas en información obsoleta.

**Criterios de aceptación**:
- Al detectar reconexión WebSocket, la aplicación del mozo solicita el estado completo de sus mesas.
- Los estados locales se reemplazan con los datos del servidor sin duplicar animaciones.
- Los llamados de servicio pendientes se resincronizarán correctamente.
- La cola de reintentos se procesa automáticamente tras la reconciliación.
- El proceso de reconciliación no bloquea la interfaz del usuario.

**Dependencias**: ninguna.
**Gobernanza**: MEDIO (Waiter).

---

### HU-6.4 — Manejo de sesiones concurrentes de comensal

**Como** comensal, **quiero** que si abro el menú digital en múltiples pestañas o dispositivos con el mismo token de mesa, todas las instancias se mantengan sincronizadas, **para que** no pierda ítems del carrito ni vea información contradictoria.

**Criterios de aceptación**:
- Las operaciones del carrito en una pestaña se reflejan en las demás pestañas en menos de tres segundos.
- Si se envía un pedido desde una pestaña, las demás limpian su carrito automáticamente.
- Los indicadores de estado de pedido son consistentes entre todas las instancias.
- Al cerrar una pestaña, las demás no se ven afectadas.

**Dependencias**: ninguna.
**Gobernanza**: MEDIO (Tables).

---

## Épica 7 — Gestión Avanzada de Promociones

**Objetivo**: expandir el sistema de promociones para cubrir escenarios comerciales frecuentes en la gastronomía.

### HU-7.1 — Activación y desactivación automática de promociones por horario

**Como** gerente, **quiero** que las promociones se activen y desactiven automáticamente según las fechas y horarios configurados, **para que** no tenga que intervenir manualmente para iniciar o finalizar una oferta.

**Criterios de aceptación**:
- Las promociones con fecha y hora de inicio futuras se activan automáticamente al llegar el momento.
- Las promociones cuya fecha y hora de fin han pasado se desactivan automáticamente.
- El menú digital del comensal refleja la disponibilidad de promociones en tiempo real.
- Las promociones activas se resaltan visualmente en el menú con el distintivo correspondiente.
- Los precios promocionales se aplican automáticamente al agregar ítems promocionados al carrito.

**Dependencias**: ninguna.
**Gobernanza**: BAJO (Promotions).

---

### HU-7.2 — Visualización de promociones activas en el menú digital

**Como** comensal, **quiero** ver las promociones activas del restaurante destacadas en el menú, **para que** pueda aprovechar las ofertas disponibles durante mi visita.

**Criterios de aceptación**:
- Las promociones activas se muestran en un carrusel dedicado en la vista principal del menú.
- Cada promoción muestra su nombre, productos incluidos, precio promocional y el ahorro respecto al precio normal.
- Las promociones con restricción horaria muestran el horario de vigencia.
- Al tocar una promoción, se agrega el combo completo al carrito en una sola acción.
- Las promociones expiradas durante la sesión desaparecen del menú sin recargar la página.

**Dependencias**: HU-7.1.
**Gobernanza**: BAJO (Promotions).

---

## Épica 8 — Gestión Avanzada del Personal

**Objetivo**: completar las funcionalidades de gestión de personal que permiten a la gerencia organizar eficientemente los turnos y asignaciones.

### HU-8.1 — Asignación diaria de mozos a sectores desde el Dashboard

**Como** gerente, **quiero** asignar mozos a sectores del salón para la jornada del día desde el Dashboard, **para que** cada mozo reciba únicamente los eventos de las mesas que tiene a su cargo.

**Criterios de aceptación**:
- La interfaz muestra los sectores de la sucursal con los mozos disponibles.
- Se puede arrastrar y soltar o seleccionar mozos para cada sector.
- Un mozo puede asignarse a múltiples sectores simultáneamente, con un máximo de diez.
- Las asignaciones se guardan con la fecha del día y se reinician automáticamente al día siguiente.
- Al guardar, los mozos conectados reciben la actualización de sectores sin necesidad de reconectar.

**Dependencias**: ninguna.
**Gobernanza**: MEDIO (Staff).

---

### HU-8.2 — Vista de desempeño del mozo

**Como** gerente, **quiero** ver estadísticas de desempeño de cada mozo durante la jornada, **para que** pueda evaluar la eficiencia del personal y distribuir mejor las cargas de trabajo.

**Criterios de aceptación**:
- Se muestra por cada mozo: mesas atendidas, rondas procesadas, tiempo promedio de respuesta a llamados de servicio y monto total facturado.
- Los datos se calculan para la jornada actual y se pueden consultar para jornadas anteriores.
- El tiempo de respuesta se mide desde SERVICE_CALL_CREATED hasta SERVICE_CALL_ACKED.
- Los datos se actualizan en tiempo real durante la jornada.

**Dependencias**: HU-8.1, HU-5.3.
**Gobernanza**: MEDIO (Staff).

---

## Épica 9 — Experiencia del Comensal con Alérgenos

**Objetivo**: refinar el sistema de alérgenos para que los comensales con restricciones alimentarias tengan una experiencia segura y completa.

### HU-9.1 — Alerta de alérgenos al agregar producto al carrito

**Como** comensal con alergias, **quiero** recibir una alerta cuando intento agregar al carrito un producto que contiene o puede contener un alérgeno que he excluido en mis filtros, **para que** no agregue accidentalmente un producto que podría causarme una reacción.

**Criterios de aceptación**:
- Si el producto contiene un alérgeno excluido, se muestra una alerta de advertencia antes de agregarlo.
- La alerta muestra qué alérgenos del producto coinciden con las exclusiones activas del comensal.
- El comensal puede optar por agregar el producto de todas formas o cancelar la acción.
- La alerta distingue visualmente entre alérgenos confirmados y posibles trazas.
- Si el comensal no tiene filtros activos, no se muestra ninguna alerta.

**Dependencias**: ninguna.
**Gobernanza**: CRITICO (Allergens).

---

### HU-9.2 — Indicador de alérgenos en el carrito compartido

**Como** comensal, **quiero** ver los indicadores de alérgenos junto a cada producto en el carrito compartido, **para que** todos los comensales de la mesa puedan verificar la información de alérgenos de los productos pedidos por otros.

**Criterios de aceptación**:
- Cada ítem del carrito muestra íconos de los alérgenos que contiene.
- Los íconos utilizan el mismo código de color que el detalle de producto: rojo para contiene, amarillo para puede contener.
- Los íconos son lo suficientemente pequeños para no saturar visualmente el carrito.
- Al tocar un ícono de alérgeno, se muestra un tooltip con el nombre completo del alérgeno.

**Dependencias**: ninguna.
**Gobernanza**: CRITICO (Allergens).

---

## Épica 10 — Infraestructura y Despliegue

**Objetivo**: preparar la infraestructura necesaria para un despliegue en producción confiable.

### HU-10.1 — Pipeline de integración continua

**Como** equipo de desarrollo, **quiero** contar con un pipeline de integración continua que ejecute pruebas, verificación de tipos y análisis estático en cada pull request, **para que** las regresiones se detecten antes de integrar cambios.

**Criterios de aceptación**:
- El pipeline ejecuta las pruebas de los tres frontends y del backend.
- Se verifica el tipado estricto de TypeScript en los tres frontends.
- Se ejecuta el linter en todos los proyectos.
- El pipeline falla si alguna prueba, verificación de tipos o regla de linter no pasa.
- El tiempo total de ejecución no excede los cinco minutos.

**Dependencias**: ninguna.
**Gobernanza**: BAJO.

---

### HU-10.2 — Configuración de entorno de producción

**Como** administrador del sistema, **quiero** que las variables de entorno de producción estén documentadas y validadas al arranque, **para que** un despliegue con configuración incompleta sea detectado inmediatamente.

**Criterios de aceptación**:
- El backend valida al arranque que todas las variables de entorno requeridas estén presentes.
- Si falta una variable crítica, el servicio no arranca y emite un mensaje de error claro.
- Las variables con valores por defecto inseguros emiten una advertencia en producción.
- La documentación de despliegue lista todas las variables necesarias con su descripción y formato.

**Dependencias**: ninguna.
**Gobernanza**: ALTO (Infrastructure).

---

### HU-10.3 — Monitoreo y alertas de salud del sistema

**Como** administrador del sistema, **quiero** recibir alertas cuando algún componente del sistema presenta degradación de rendimiento o deja de funcionar, **para que** pueda intervenir antes de que los usuarios se vean afectados.

**Criterios de aceptación**:
- Los endpoints de salud del API REST y del gateway de WebSocket responden con estado detallado.
- Las métricas de Prometheus del gateway incluyen latencia de difusión, conexiones activas y tasa de errores.
- Se configuran alertas para: conexión Redis perdida, tasa de errores superior al cinco por ciento, y latencia de difusión superior a quinientos milisegundos.
- Los registros estructurados incluyen identificadores de correlación para trazar eventos entre servicios.

**Dependencias**: ninguna.
**Gobernanza**: ALTO (Infrastructure).

---

## Backlog Priorizado — Orden de Implementación

El siguiente orden de implementación respeta las dependencias técnicas, maximiza el valor operativo en las primeras iteraciones y agrupa las historias en bloques coherentes que pueden planificarse como sprints.

### Bloque 1 — Flujo Operativo Central (Sprints 1-2)

| Orden | Historia | Épica | Gobernanza | Dependencia |
|-------|----------|-------|------------|-------------|
| 1 | HU-1.1 | Flujo E2E | MEDIO | — |
| 2 | HU-1.2 | Flujo E2E | MEDIO | HU-1.1 |
| 3 | HU-1.3 | Flujo E2E | MEDIO | HU-1.2 |
| 4 | HU-1.4 | Flujo E2E | ALTO | HU-1.1 |
| 5 | HU-6.3 | Robustez | MEDIO | — |
| 6 | HU-6.4 | Robustez | MEDIO | — |

**Resultado**: el flujo de pedido funciona de extremo a extremo con todos los actores sincronizados y resilientes a desconexiones.

### Bloque 2 — Facturación y Pagos (Sprints 3-4)

| Orden | Historia | Épica | Gobernanza | Dependencia |
|-------|----------|-------|------------|-------------|
| 7 | HU-2.1 | Billing | CRITICO | — |
| 8 | HU-2.2 | Billing | CRITICO | HU-2.1 |
| 9 | HU-2.4 | Billing | CRITICO | HU-2.1 |
| 10 | HU-2.3 | Billing | CRITICO | HU-2.2 |
| 11 | HU-2.5 | Billing | CRITICO | HU-2.3, HU-2.4 |

**Resultado**: el ciclo completo de pago opera de extremo a extremo con todos los métodos de pago soportados.

### Bloque 3 — Cocina y Tickets (Sprint 5)

| Orden | Historia | Épica | Gobernanza | Dependencia |
|-------|----------|-------|------------|-------------|
| 12 | HU-3.1 | Kitchen | MEDIO | — |
| 13 | HU-3.2 | Kitchen | MEDIO | HU-3.1 |
| 14 | HU-3.3 | Kitchen | MEDIO | HU-3.2 |

**Resultado**: la cocina gestiona tickets por estación con consolidación automática de estado de rondas.

### Bloque 4 — Seguridad Alimentaria y Alérgenos (Sprint 6)

| Orden | Historia | Épica | Gobernanza | Dependencia |
|-------|----------|-------|------------|-------------|
| 15 | HU-9.1 | Alérgenos | CRITICO | — |
| 16 | HU-9.2 | Alérgenos | CRITICO | — |

**Resultado**: los comensales con alergias tienen una experiencia segura con alertas proactivas.

### Bloque 5 — Fidelización Progresiva (Sprints 7-8)

| Orden | Historia | Épica | Gobernanza | Dependencia |
|-------|----------|-------|------------|-------------|
| 17 | HU-4.1 | Fidelización | MEDIO | — |
| 18 | HU-4.2 | Fidelización | MEDIO | HU-4.1 |
| 19 | HU-4.3 | Fidelización | BAJO | HU-4.2 |
| 20 | HU-4.4 | Fidelización | CRITICO | HU-4.3 |

**Resultado**: el sistema reconoce comensales recurrentes y ofrece personalización progresiva.

### Bloque 6 — Gestión de Personal y Promociones (Sprint 9)

| Orden | Historia | Épica | Gobernanza | Dependencia |
|-------|----------|-------|------------|-------------|
| 21 | HU-8.1 | Personal | MEDIO | — |
| 22 | HU-7.1 | Promos | BAJO | — |
| 23 | HU-7.2 | Promos | BAJO | HU-7.1 |

**Resultado**: las asignaciones de personal y las promociones operan automáticamente.

### Bloque 7 — Analítica y Reportes (Sprint 10)

| Orden | Historia | Épica | Gobernanza | Dependencia |
|-------|----------|-------|------------|-------------|
| 24 | HU-5.1 | Reportes | BAJO | HU-2.5 |
| 25 | HU-5.2 | Reportes | BAJO | HU-5.1 |
| 26 | HU-5.3 | Reportes | BAJO | HU-1.3 |
| 27 | HU-5.4 | Reportes | BAJO | HU-2.5 |
| 28 | HU-8.2 | Personal | MEDIO | HU-8.1, HU-5.3 |

**Resultado**: los gerentes cuentan con herramientas analíticas para decisiones de negocio.

### Bloque 8 — Infraestructura de Producción (Sprint 11)

| Orden | Historia | Épica | Gobernanza | Dependencia |
|-------|----------|-------|------------|-------------|
| 29 | HU-10.1 | Infra | BAJO | — |
| 30 | HU-10.2 | Infra | ALTO | — |
| 31 | HU-10.3 | Infra | ALTO | — |
| 32 | HU-6.1 | Robustez | ALTO | — |
| 33 | HU-6.2 | Robustez | BAJO | HU-1.3 |

**Resultado**: el sistema está preparado para despliegue en producción con monitoreo y resiliencia.

---

## Diagrama de Dependencias

```
HU-1.1 ──→ HU-1.2 ──→ HU-1.3 ──→ HU-6.2
  │                        │
  └──→ HU-1.4             └──→ HU-5.3 ──→ HU-8.2
                                              ↑
HU-2.1 ──→ HU-2.2 ──→ HU-2.3 ──┐          HU-8.1
  │                              ├──→ HU-2.5 ──→ HU-5.1 ──→ HU-5.2
  └──→ HU-2.4 ──────────────────┘       │
                                         └──→ HU-5.4
HU-3.1 ──→ HU-3.2 ──→ HU-3.3

HU-4.1 ──→ HU-4.2 ──→ HU-4.3 ──→ HU-4.4

HU-7.1 ──→ HU-7.2

HU-9.1 (independiente)
HU-9.2 (independiente)
HU-6.1 (independiente)
HU-6.3 (independiente)
HU-6.4 (independiente)
HU-10.1 (independiente)
HU-10.2 (independiente)
HU-10.3 (independiente)
```

---

## Resumen Ejecutivo

| Métrica | Valor |
|---------|-------|
| Total de historias de usuario | 33 |
| Épicas | 10 |
| Bloques de implementación | 8 |
| Sprints estimados | 11 |
| Historias en dominio CRITICO | 7 (requieren revisión humana) |
| Historias en dominio ALTO | 4 (requieren propuesta previa) |
| Historias en dominio MEDIO | 12 (implementación con checkpoints) |
| Historias en dominio BAJO | 10 (autonomía completa) |
| Historias independientes (sin dependencia) | 15 |
| Cadena de dependencia más larga | 5 pasos (HU-2.1 → 2.2 → 2.3 → 2.5 → 5.1) |

El plan prioriza los flujos operativos centrales que afectan directamente la experiencia del cliente y la operación diaria del restaurante, relegando los reportes y la infraestructura de producción a etapas posteriores donde el sistema ya genera datos reales sobre los cuales analizar.
