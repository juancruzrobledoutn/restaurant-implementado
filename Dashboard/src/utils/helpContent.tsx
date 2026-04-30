/**
 * Centralized help content for all Dashboard pages.
 *
 * Rules (skill: help-system-content):
 * - Every Dashboard page MUST pass its key to PageContainer via helpContent={helpContent.xxx}
 * - Content lives HERE — never inline JSX inside a page component
 * - Form modals get an inline HelpButton (size="sm") — that content IS inline (not here)
 * - One key per page, following the structure: title → intro → feature list → tip box
 * - Language: Spanish, no tildes to avoid encoding issues
 *
 * Add one entry here for each new Dashboard page (C-15 and beyond).
 */

import type { ReactNode } from 'react'

type HelpContentMap = Record<string, ReactNode>

export const helpContent: HelpContentMap = {
  // ------------------------------------------------------------------
  // Categories — C-15
  // ------------------------------------------------------------------
  categories: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Categorias</p>
      <p>
        Las categorias son las secciones principales del menu de una sucursal (ej: Comidas, Bebidas, Postres).
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Crear categoria:</strong> Hace clic en "Nueva Categoria" para agregar una seccion al menu.</li>
        <li><strong>Editar categoria:</strong> Modifica nombre, icono, imagen y estado.</li>
        <li><strong>Ordenar:</strong> Define el orden de aparicion en el menu.</li>
        <li><strong>Subcategorias:</strong> Cada categoria puede tener multiples subcategorias.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Nota:</p>
        <p className="text-sm mt-1">
          Cada sucursal tiene su propio conjunto de categorias. Primero selecciona una sucursal
          desde el Dashboard para ver y gestionar sus categorias.
        </p>
      </div>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia:</p>
        <p className="text-sm mt-1">
          Al eliminar una categoria se eliminan todas sus subcategorias y productos asociados.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Subcategories — C-15
  // ------------------------------------------------------------------
  subcategories: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Subcategorias</p>
      <p>
        Las subcategorias agrupan productos dentro de una categoria (ej: Pastas, Carnes, Ensaladas dentro de Comidas).
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Crear subcategoria:</strong> Asigna nombre, categoria padre e imagen.</li>
        <li><strong>Filtrar por categoria:</strong> Usa el selector para ver solo las subcategorias de una categoria.</li>
        <li><strong>Orden:</strong> Controla el orden de aparicion dentro de la categoria.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Consejo:</p>
        <p className="text-sm mt-1">
          Una subcategoria siempre pertenece a una categoria y a una sucursal. Selecciona primero
          la sucursal correcta antes de crear subcategorias.
        </p>
      </div>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia:</p>
        <p className="text-sm mt-1">
          Al eliminar una subcategoria se eliminan todos sus productos asociados.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Products — C-15
  // ------------------------------------------------------------------
  products: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Productos</p>
      <p>
        Los productos son los items del menu que los clientes pueden pedir. Cada producto tiene
        un precio base y puede tener precios distintos por sucursal.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Precio base:</strong> Precio en centavos (1250 = $12.50).</li>
        <li><strong>Disponibilidad:</strong> Activa o desactiva el producto por sucursal sin eliminarlo.</li>
        <li><strong>Alergenos:</strong> Vincula alergenos al producto para informar a los clientes.</li>
        <li><strong>Destacado / Popular:</strong> Marca productos para resaltarlos en el menu digital.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Precios por sucursal:</p>
        <p className="text-sm mt-1">
          Cada sucursal puede tener un precio diferente para el mismo producto. El precio base
          se usa cuando no hay precio especifico para la sucursal.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Allergens — C-15
  // ------------------------------------------------------------------
  allergens: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Alergenos</p>
      <p>
        Los alergenos son sustancias que pueden causar reacciones alergicas. Es obligatorio
        informarlos en el menu segun la normativa vigente.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Crear alergeno:</strong> Define nombre, icono, descripcion y severidad.</li>
        <li><strong>Severidad:</strong> Leve, Moderada, Severa o Critica — usada para mostrar alertas.</li>
        <li><strong>Declaracion obligatoria:</strong> Marca los alergenos de declaracion legal obligatoria.</li>
        <li><strong>Vincular a productos:</strong> Desde la pagina de Productos podes asociar alergenos.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Importante:</p>
        <p className="text-sm mt-1">
          Los alergenos son globales al tenant — se comparten entre todas las sucursales.
          Una vez vinculados a productos, se muestran automaticamente en el menu digital.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Ingredients — C-15
  // ------------------------------------------------------------------
  ingredients: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Ingredientes</p>
      <p>
        Los ingredientes estan organizados en grupos (ej: Lacteos, Carnes, Cereales) y se usan
        para definir las recetas de cada producto.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Grupos:</strong> Contenedores logicos para organizar ingredientes por categoria.</li>
        <li><strong>Ingredientes:</strong> Items individuales dentro de un grupo con unidad de medida.</li>
        <li><strong>Sub-ingredientes:</strong> Variantes o componentes de un ingrediente (ej: Leche entera, Leche descremada).</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Consejo:</p>
        <p className="text-sm mt-1">
          Los ingredientes son globales al tenant. Organizalos bien en grupos para facilitar
          la creacion de recetas mas adelante.
        </p>
      </div>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia:</p>
        <p className="text-sm mt-1">
          Al eliminar un grupo se eliminan todos sus ingredientes y sub-ingredientes.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Recipes — C-15
  // ------------------------------------------------------------------
  recipes: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Recetas</p>
      <p>
        Las recetas definen los ingredientes necesarios para preparar un producto, incluyendo
        cantidades y unidades de medida.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Crear receta:</strong> Asocia la receta a un producto y agrega los ingredientes con cantidades.</li>
        <li><strong>Ingredientes:</strong> Selecciona ingredientes del catalogo global del tenant.</li>
        <li><strong>Unidades:</strong> Especifica la unidad de cada ingrediente (g, ml, unidades, etc.).</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Uso tipico:</p>
        <p className="text-sm mt-1">
          Las recetas se usan para control de stock y costeo. Un producto puede tener una
          receta activa que define sus costos de produccion.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Sectors — C-16
  // ------------------------------------------------------------------
  sectors: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Sectores</p>
      <p>
        Los sectores son las zonas fisicas de la sucursal (ej: Salon Principal, Terraza, Barra).
        Cada mesa pertenece a un sector.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Crear sector:</strong> Define el nombre del area. El estado puede cambiarse sin eliminar.</li>
        <li><strong>Editar sector:</strong> Modifica el nombre o activa/desactiva el sector.</li>
        <li><strong>Mesas:</strong> Cada sector puede tener multiples mesas asignadas.</li>
        <li><strong>Mozos:</strong> Los mozos se asignan a sectores por dia en la pagina de Asignaciones.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Consejo:</p>
        <p className="text-sm mt-1">
          Organiza los sectores segun la distribucion fisica del local.
          Un buen esquema de sectores facilita la asignacion de mozos y el seguimiento de pedidos.
        </p>
      </div>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia:</p>
        <p className="text-sm mt-1">
          Al eliminar un sector se eliminan todas sus mesas. Las sesiones activas en esas
          mesas pueden verse afectadas. Desactiva el sector en lugar de eliminarlo si hay actividad.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Tables — C-16
  // ------------------------------------------------------------------
  tables: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Mesas</p>
      <p>
        Las mesas son los puntos de servicio fisicos de la sucursal. Cada mesa tiene un codigo QR
        que usan los clientes para acceder al menu digital.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Numero:</strong> Identificador numerico visible para el personal.</li>
        <li><strong>Codigo:</strong> Codigo interno o QR de la mesa (ej: A-01).</li>
        <li><strong>Sector:</strong> Zona de la sucursal donde esta ubicada la mesa.</li>
        <li><strong>Capacidad:</strong> Cantidad maxima de comensales.</li>
        <li><strong>Estado:</strong> Cambia automaticamente con WebSocket (Disponible / Ocupada / Reservada).</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Estado en tiempo real:</p>
        <p className="text-sm mt-1">
          El estado de cada mesa se actualiza automaticamente via WebSocket cuando se abre
          o cierra una sesion. No es necesario refrescar la pagina.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Staff — C-16
  // ------------------------------------------------------------------
  staff: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Personal</p>
      <p>
        Administra los usuarios del sistema y sus roles por sucursal. Cada usuario puede tener
        diferentes roles en diferentes sucursales.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Roles:</strong> ADMIN, MANAGER, KITCHEN, WAITER. Un usuario puede tener un rol por sucursal.</li>
        <li><strong>ADMIN:</strong> Acceso total al sistema.</li>
        <li><strong>MANAGER:</strong> Gestion de operaciones de la sucursal (sin eliminar staff).</li>
        <li><strong>KITCHEN:</strong> Solo visualiza el display de cocina.</li>
        <li><strong>WAITER:</strong> Atiende mesas desde la app de mozo.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Importante:</p>
        <p className="text-sm mt-1">
          Solo los ADMIN pueden eliminar usuarios. Los MANAGER pueden crear y editar
          usuarios pero no borrarlos.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Waiter Assignments — C-16
  // ------------------------------------------------------------------
  waiterAssignments: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Asignacion de Mozos</p>
      <p>
        Define que mozo trabaja en cada sector en cada dia. Las asignaciones son ephemeras —
        se crean y eliminan, no se editan.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Seleccionar fecha:</strong> Usa el datepicker para ver o planificar asignaciones de cualquier dia.</li>
        <li><strong>Mozo:</strong> Solo aparecen usuarios con rol WAITER en la sucursal activa.</li>
        <li><strong>Sector:</strong> La zona donde trabajara el mozo ese dia.</li>
        <li><strong>Eliminar:</strong> Si el mozo cambia de sector, elimina la asignacion y crea una nueva.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Consejo:</p>
        <p className="text-sm mt-1">
          Configura las asignaciones del dia antes del servicio. La app de mozo muestra
          automaticamente las mesas del sector asignado.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Kitchen Display — C-16
  // ------------------------------------------------------------------
  kitchenDisplay: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Display de Cocina</p>
      <p>
        Vista en tiempo real de todos los pedidos en cocina. Los tickets se actualizan
        automaticamente via WebSocket — sin necesidad de refrescar.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Enviados:</strong> Pedidos recibidos, esperando ser tomados por cocina.</li>
        <li><strong>En Cocina:</strong> Pedidos en preparacion activa.</li>
        <li><strong>Listos:</strong> Pedidos terminados, esperando ser servidos.</li>
        <li><strong>Urgencia:</strong> El badge de color indica el tiempo transcurrido (verde / amarillo / naranja / rojo).</li>
        <li><strong>Audio:</strong> Activa el icono de volumen para oir una notificacion cuando un pedido este listo.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Modo cocina:</p>
        <p className="text-sm mt-1">
          Esta pantalla esta disenada para usarse en una tablet o monitor montado en cocina.
          No requiere interaccion frecuente — los pedidos llegan solos.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Sales — C-16
  // ------------------------------------------------------------------
  sales: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Ventas del Dia</p>
      <p>
        Resumen de KPIs diarios y productos mas vendidos. Los datos se calculan sobre las
        cuentas con estado PAID del dia seleccionado.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Ingresos:</strong> Suma de todos los pagos APROBADOS del dia.</li>
        <li><strong>Ordenes:</strong> Cantidad de cuentas cerradas (PAID) en el dia.</li>
        <li><strong>Ticket promedio:</strong> Ingresos / Ordenes.</li>
        <li><strong>Top productos:</strong> Los mas vendidos por revenue, de mayor a menor.</li>
        <li><strong>Cambiar fecha:</strong> Usa el datepicker para ver reportes de dias anteriores.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Precios:</p>
        <p className="text-sm mt-1">
          Todos los valores monetarios se muestran en pesos argentinos (ARS).
          Los precios se almacenan en centavos internamente.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Promotions — C-27
  // ------------------------------------------------------------------
  promotions: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Promociones</p>
      <p>
        Las promociones permiten definir precios especiales por rango de fecha y hora,
        vinculadas a sucursales y productos especificos del catalogo.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Crear:</strong> Define nombre, precio en centavos, tipo (2x1, combo, etc.), vigencia de inicio y fin, sucursales y productos incluidos.</li>
        <li><strong>Editar:</strong> Modifica cualquier campo. Los cambios se aplican de forma instantanea con actualizacion optimista.</li>
        <li><strong>Vigencia:</strong> La fecha y hora de inicio/fin controla cuando la promocion es "proxima", "vigente" o "vencida". El estado se evalua en la hora local del navegador.</li>
        <li><strong>Precio:</strong> Se ingresa en centavos (12550 = $125.50). El display convierte automaticamente.</li>
        <li><strong>Sucursales:</strong> Una promocion puede aplicar a multiples sucursales a la vez.</li>
        <li><strong>Items:</strong> Vincula productos del catalogo para detallar que incluye la promocion.</li>
        <li><strong>Activar / Desactivar:</strong> El toggle en la columna Estado aplica el cambio de forma instantanea sin abrir el formulario.</li>
        <li><strong>Eliminar:</strong> Solo ADMIN. Muestra una vista previa de cuantas sucursales e items seran desvinculados antes de confirmar.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Nota:</p>
        <p className="text-sm mt-1">
          La vigencia se evalua en la hora local del navegador del administrador.
          Si el estado de una promocion no parece actualizado (por ejemplo, sigue como "proxima"
          cuando ya deberia ser "vigente"), refresaca la pagina para recalcular con el horario actual.
        </p>
      </div>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia:</p>
        <p className="text-sm mt-1">
          Al eliminar una promocion se remueven automaticamente todos sus vinculos a sucursales
          y productos. Esta accion no se puede deshacer.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Checks — C-26
  // ------------------------------------------------------------------
  checks: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Cuentas del Dia</p>
      <p>
        Lista todas las cuentas generadas en la sucursal para la fecha seleccionada.
        Cada cuenta agrupa los cargos de una mesa en una sesion.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Fecha:</strong> Filtra las cuentas por dia. El default es hoy.</li>
        <li><strong>Estado Pendiente:</strong> La cuenta fue solicitada pero todavia no se cubrieron todos los cargos.</li>
        <li><strong>Estado Pagada:</strong> Todos los cargos fueron cubiertos con pagos aprobados.</li>
        <li><strong>Total:</strong> La suma de todos los cargos de la cuenta (en centavos).</li>
        <li><strong>Cubierto:</strong> La parte del total ya pagada y asignada via FIFO.</li>
        <li><strong>Ver detalle:</strong> Abre el modal con cargos, asignaciones y pagos completos.</li>
        <li><strong>KPIs:</strong> Se calculan en tiempo real desde las cuentas cargadas.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Tiempo real:</p>
        <p className="text-sm mt-1">
          Las cuentas se actualizan automaticamente via WebSocket cuando se solicitan o pagan.
          No es necesario refrescar la pagina.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Payments — C-26
  // ------------------------------------------------------------------
  payments: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Historial de Pagos</p>
      <p>
        Lista todos los pagos registrados en la sucursal para el rango de fechas seleccionado.
        Permite filtrar por metodo de pago y estado.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Desde / Hasta:</strong> Define el rango de fechas. El limite maximo es 90 dias.</li>
        <li><strong>Metodo:</strong> Filtra por efectivo, tarjeta, transferencia o MercadoPago.</li>
        <li><strong>Estado Aprobado:</strong> El pago fue procesado exitosamente.</li>
        <li><strong>Estado Pendiente:</strong> El pago esta en espera de confirmacion (ej: MP webhook).</li>
        <li><strong>Estado Rechazado / Fallido:</strong> El pago no pudo procesarse.</li>
        <li><strong>Cuenta (ID):</strong> Hace clic para abrir el detalle de la cuenta asociada.</li>
        <li><strong>Resumen por metodo:</strong> Tabla al pie que muestra totales por metodo (solo APROBADOS).</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Contabilidad:</p>
        <p className="text-sm mt-1">
          Solo los pagos con estado APROBADO aparecen en el resumen por metodo.
          Los pagos RECHAZADOS y PENDIENTES no se consideran ingresos.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Home page — C-30 (operational dashboard)
  // ------------------------------------------------------------------
  home: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Panel Principal</p>
      <p>
        Vista operativa de la sucursal seleccionada. Muestra el pulso del negocio en tiempo real:
        mesas activas, ventas del dia y accesos rapidos a las vistas operativas.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Mesas activas:</strong> Cantidad de mesas ocupadas sobre el total habilitado. Se actualiza en tiempo real via WebSocket.</li>
        <li><strong>Pedidos del dia:</strong> Total de cuentas cerradas (PAID) en el dia de hoy.</li>
        <li><strong>Ingresos del dia:</strong> Suma de todos los pagos aprobados del dia.</li>
        <li><strong>Ticket promedio:</strong> Ingresos dividido la cantidad de pedidos.</li>
        <li><strong>Accesos rapidos:</strong> Navega directamente a Cocina, Ventas, Mesas, Personal y Asignacion de Mozos.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Consejo:</p>
        <p className="text-sm mt-1">
          Si no ves datos, asegurate de haber seleccionado una sucursal desde el selector en la barra superior.
          Los KPIs de ventas se actualizan automaticamente cuando se cierran rondas o pagos.
        </p>
      </div>
      <div className="bg-gray-700 p-4 rounded-lg mt-2">
        <p className="text-orange-400 font-medium">Datos en tiempo real:</p>
        <p className="text-sm mt-1">
          El estado de mesas se sincroniza instantaneamente. Los KPIs de ventas se recalculan
          cada vez que se registra un nuevo pago o cierre de ronda (con un intervalo de hasta 3 segundos).
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Orders — C-25
  // ------------------------------------------------------------------
  orders: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Gestion de Pedidos (Rondas)</p>
      <p>
        Esta pantalla muestra todas las rondas de la sucursal seleccionada en tiempo real,
        organizadas por estado en vista kanban o como lista paginada.
      </p>

      <div>
        <p className="font-medium text-white mb-1">Los 7 estados posibles de una ronda:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 text-sm">
          <li><strong>Pendiente:</strong> Ronda creada, aun no confirmada por el mozo.</li>
          <li><strong>Confirmada:</strong> El mozo confirmo la ronda antes de enviarla.</li>
          <li><strong>Enviada:</strong> La ronda fue enviada a cocina.</li>
          <li><strong>En cocina:</strong> El equipo de cocina esta preparando los items.</li>
          <li><strong>Lista:</strong> La preparacion esta terminada, esperando ser llevada a la mesa.</li>
          <li><strong>Servida:</strong> Los items fueron entregados al cliente.</li>
          <li><strong>Cancelada:</strong> La ronda fue cancelada antes de ser servida.</li>
        </ul>
      </div>

      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Vista kanban:</strong> Una columna por estado. Clic en una tarjeta para ver el detalle.</li>
        <li><strong>Vista lista:</strong> Tabla paginada con filtros aplicados.</li>
        <li><strong>Filtros:</strong> Filtra por fecha, sector, estado y codigo de mesa.</li>
        <li><strong>Tiempo real:</strong> Las rondas se actualizan automaticamente por WebSocket.</li>
      </ul>

      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Quien puede cancelar:</p>
        <p className="text-sm mt-1">
          Solo ADMIN y MANAGER pueden cancelar una ronda.
          Una ronda puede cancelarse si esta en estado Pendiente, Confirmada, Enviada, En cocina o Lista.
          Una ronda ya Servida o Cancelada no puede volver a cancelarse.
        </p>
      </div>

      <div className="bg-gray-700 p-4 rounded-lg mt-2">
        <p className="text-orange-400 font-medium">Actualizacion en tiempo real:</p>
        <p className="text-sm mt-1">
          Los cambios de estado llegan automaticamente por WebSocket. Al cancelar una ronda,
          la tarjeta desaparece del tablero cuando el servidor confirma la cancelacion.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Settings — Branch Tab (C-28)
  // ------------------------------------------------------------------
  settingsBranch: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Configuracion de Sucursal</p>
      <p>
        Administra la informacion operativa de la sucursal: nombre, direccion, slug de URL, zona horaria y horarios de apertura.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Nombre:</strong> Nombre visible de la sucursal en el Dashboard.</li>
        <li><strong>Slug:</strong> Identificador unico en la URL del menu publico (ej: mi-sucursal). Solo minusculas, numeros y guiones.</li>
        <li><strong>Zona horaria:</strong> Se usa para mostrar horarios correctamente segun la ubicacion.</li>
        <li><strong>Horarios:</strong> Define los intervalos de apertura para cada dia de la semana.</li>
      </ul>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia — Cambio de Slug:</p>
        <p className="text-sm mt-1">
          Cambiar el slug rompe todas las URLs anteriores del menu publico. Los clientes con la URL vieja deberan usar la nueva.
          Se pedira confirmacion escribiendo el nuevo slug.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Settings — Profile Tab (C-28)
  // ------------------------------------------------------------------
  settingsProfile: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Perfil y Seguridad</p>
      <p>
        Cambia tu contrasena y configura la autenticacion de dos factores (2FA) para proteger tu cuenta.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Cambiar contrasena:</strong> La nueva contrasena debe tener al menos 8 caracteres, una mayuscula y un numero.</li>
        <li><strong>2FA:</strong> Usa Google Authenticator, Authy u otra app TOTP para agregar una capa de seguridad extra.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Recuperacion de 2FA:</p>
        <p className="text-sm mt-1">
          Si perdiste acceso a tu app TOTP, contacta al administrador del sistema para deshabilitar el 2FA de tu cuenta.
          No hay codigos de recuperacion — guarda el secreto TOTP en un lugar seguro al activar.
        </p>
      </div>
    </div>
  ),

  // ------------------------------------------------------------------
  // Settings — Tenant Tab (C-28)
  // ------------------------------------------------------------------
  settingsTenant: (
    <div className="space-y-4 text-gray-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Configuracion del Negocio</p>
      <p>
        Administra el nombre de tu organizacion (tenant). Este nombre es visible para todos los usuarios del sistema.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li><strong>Nombre del negocio:</strong> Aparece en el encabezado del Dashboard y en reportes.</li>
      </ul>
      <div className="bg-gray-700 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Solo ADMIN:</p>
        <p className="text-sm mt-1">
          Esta seccion solo es visible para usuarios con rol ADMIN. Los cambios afectan a toda la organizacion.
        </p>
      </div>
    </div>
  ),
}
