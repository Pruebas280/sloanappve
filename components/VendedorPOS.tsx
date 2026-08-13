'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import CreateClientModal from '@/components/CreateClientModal'

// ============================================================================
// CONFIGURACIÓN DE SUPABASE Y TYPES
// ============================================================================

// Respaldos condicionales para evitar fallos de build en Netlify (si faltan las vars)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

const supabase = createBrowserClient(supabaseUrl, supabaseKey)

export interface Producto {
  id: string
  sku: string
  nombre: string
  precio_usd: number
  precio_bs: number
  stock_disponible: number
  imagenes: string[] | null
}

export interface Cliente {
  id: string
  nombre: string
  cedula_rif: string
  direccion?: string
}

export interface CartItem extends Producto {
  cantidad_carrito: number
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function VendedorPOS() {
  // Estados Globales de la Vista
  const [productos, setProductos] = useState<Producto[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  
  // Estado del Formulario de Orden
  const [selectedCliente, setSelectedCliente] = useState<string>('')
  const [metodoPago, setMetodoPago] = useState<string>('Zelle')
  const [modalidadPago, setModalidadPago] = useState<string>('Contado')
  const [diasCredito, setDiasCredito] = useState<number>(0)
  const [inicialMonto, setInicialMonto] = useState<number>(0)
  const [condicionEntrega, setCondicionEntrega] = useState<string>('Retiro')
  const [direccionEnvio, setDireccionEnvio] = useState<string>('')
  const [precioPersonalizado, setPrecioPersonalizado] = useState<boolean>(false)
  const [totalPersonalizado, setTotalPersonalizado] = useState<number>(0)
  const [showClientModal, setShowClientModal] = useState<boolean>(false)
  // comprobante state removed
  const [tasaCambio, setTasaCambio] = useState<number>(36.5)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error', texto: string } | null>(null)

  // Carga inicial de datos
  useEffect(() => {
    const fetchData = async () => {
      // Evitar fetch si el build no tiene variables reales
      if (supabaseUrl === 'https://placeholder.supabase.co') return

      try {
        const [resProductos, resClientes] = await Promise.all([
          supabase.from('productos').select('*').eq('activo', true),
          supabase.from('clientes').select('*')
        ])

        if (resProductos.data) setProductos(resProductos.data)
        if (resClientes.data) setClientes(resClientes.data)
      } catch (error) {
        console.error("Error al cargar datos base:", error)
      }
    }
    fetchData()
  }, [])

  // ============================================================================
  // LÓGICA DE NEGOCIO Y MANEJADORES
  // ============================================================================

  // Filtro de catálogo en tiempo real
  const productosFiltrados = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return productos.filter(p => 
      p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    )
  }, [productos, searchQuery])

  // Totales
  const totalUSD = cart.reduce((acc, item) => acc + (item.precio_usd * item.cantidad_carrito), 0)

  // Manejador del Carrito (Sumar/Restar con validación de stock)
  const handleUpdateCart = (producto: Producto, delta: number) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === producto.id)
      
      if (existing) {
        const nuevaCantidad = existing.cantidad_carrito + delta
        if (nuevaCantidad <= 0) {
          return prev.filter(item => item.id !== producto.id)
        }
        if (nuevaCantidad > producto.stock_disponible) {
          alert('Stock máximo alcanzado')
          return prev
        }
        return prev.map(item => item.id === producto.id ? { ...item, cantidad_carrito: nuevaCantidad } : item)
      } else {
        if (delta > 0 && producto.stock_disponible >= delta) {
          return [...prev, { ...producto, cantidad_carrito: delta }]
        }
        return prev
      }
    })
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    // Validaciones
    if (cart.length === 0) return setMensaje({ tipo: 'error', texto: 'El carrito está vacío' })
    if (!selectedCliente) return setMensaje({ tipo: 'error', texto: 'Selecciona un cliente' })

    const totalVenta = precioPersonalizado ? (Number(totalPersonalizado) || 0) : (Number(totalUSD) || 0)
    if (modalidadPago === 'Crédito' && Number(inicialMonto) > totalVenta) {
      return setMensaje({ tipo: 'error', texto: 'La inicial no puede superar el monto total de la venta' })
    }

    setIsSubmitting(true)
    setMensaje(null)

    try {
      // 1. Obtener usuario autenticado
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error("No hay una sesión de vendedor activa.")

      // 3. Crear cabecera de la Orden
      const ordenPayload = {
        vendedor_id: user.id || null,
        cliente_id: selectedCliente || null,
        total_usd: precioPersonalizado ? (Number(totalPersonalizado) || 0) : (Number(totalUSD) || 0),
        metodo_pago: metodoPago,
        modalidad_pago: modalidadPago,
        inicial_monto: modalidadPago === 'Crédito' ? (Number(inicialMonto) || 0) : 0,
        dias_credito: modalidadPago === 'Crédito' ? (Number(diasCredito) || 0) : 0,
        condicion_entrega: condicionEntrega,
        direccion_envio: direccionEnvio || clientes.find(c => c.id === selectedCliente)?.direccion || 'Sin dirección especificada',
        precio_personalizado: precioPersonalizado ? (Number(totalPersonalizado) || null) : null,
        estado: 'aprobado',
        observaciones: 'Orden registrada desde Vendedor POS App',
        total_bs: 0,
        tasa_cambio: 0
      }

      const { data: ordenData, error: ordenError } = await supabase
        .from('ordenes')
        .insert([ordenPayload])
        .select()
        .single()

      if (ordenError) throw new Error(`Fallo creando orden: ${ordenError.message}`)

      // 4. Insertar los items en 'orden_items'
      const ordenItems = cart.map(item => ({
        orden_id: ordenData.id,
        producto_id: item.id,
        cantidad: item.cantidad_carrito,
        precio_unitario_usd: item.precio_usd,
        precio_unitario_bs: 0
      }))

      const { error: itemsError } = await supabase.from('orden_items').insert(ordenItems)
      if (itemsError) throw new Error(`Fallo registrando items: ${itemsError.message}`)

      // 5. Descontar stock manualmente en la tabla de 'productos'
      for (const item of cart) {
        const nuevoStock = item.stock_disponible - item.cantidad_carrito;
        const { error: stockError } = await supabase
          .from('productos')
          .update({ stock_disponible: nuevoStock })
          .eq('id', item.id);
          
        if (stockError) {
          console.warn(`No se pudo descontar stock del producto ${item.id}:`, stockError);
        }
      }

      // 6. Éxito y reseteo
      setCart([])
      setSelectedCliente('')
      setMetodoPago('Zelle')
      setModalidadPago('Contado')
      setInicialMonto(0)
      setDiasCredito(0)
      setCondicionEntrega('Retiro')
      setDireccionEnvio('')
      setPrecioPersonalizado(false)
      
      // Actualizar el inventario visualmente sin recargar la página
      setProductos(prev => prev.map(p => {
        const cartItem = cart.find(c => c.id === p.id)
        if (cartItem) return { ...p, stock_disponible: p.stock_disponible - cartItem.cantidad_carrito }
        return p
      }))

      setMensaje({ tipo: 'exito', texto: 'Orden registrada exitosamente. Pendiente por aprobación de pago.' })

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error general del sistema'
      setMensaje({ tipo: 'error', texto: errorMsg })
    } finally {
      setIsSubmitting(false)
    }
  }

  // ============================================================================
  // RENDER (UI/UX)
  // ============================================================================
  return (
    <div className="flex flex-col md:flex-row w-full min-h-screen bg-slate-50 font-sans text-slate-800">
      
      {/* ---------------- IZQUIERDA: CATÁLOGO Y BÚSQUEDA ---------------- */}
      <div className="flex-1 p-4 md:p-6 flex flex-col h-full overflow-hidden">
        
        {/* Encabezado Catálogo */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-blue-900 mb-4">Catálogo de Productos</h1>
          <input 
            type="search"
            placeholder="Buscar por nombre o SKU..."
            className="w-full h-14 pl-4 rounded-xl border-2 border-slate-200 focus:border-blue-500 focus:ring-0 outline-none text-lg transition-colors"
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Grid de Productos (Touch First) */}
        <div className="flex-1 overflow-y-auto pb-24 md:pb-0 pr-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {productosFiltrados.map(prod => (
              <div key={prod.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex flex-col justify-between hover:shadow-md transition-shadow">
                
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{prod.sku}</span>
                  <h3 className="text-lg font-bold leading-tight mt-1 mb-2 line-clamp-2">{prod.nombre}</h3>
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <p className="text-xl font-black text-blue-600">${prod.precio_usd.toFixed(2)}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-lg text-xs font-bold ${prod.stock_disponible > 5 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      Stock: {prod.stock_disponible}
                    </span>
                  </div>
                </div>

                {/* Controles Táctiles (Touch First Buttons) */}
                <div className="flex items-center justify-between bg-slate-50 rounded-xl p-1 border border-slate-200">
                  <button 
                    type="button"
                    className="w-12 h-12 flex items-center justify-center rounded-lg bg-white shadow-sm text-slate-600 text-xl font-bold active:bg-slate-200 disabled:opacity-50"
                    onClick={() => handleUpdateCart(prod, -1)}
                  >
                    -
                  </button>
                  <span className="text-lg font-bold w-12 text-center">
                    {cart.find(c => c.id === prod.id)?.cantidad_carrito || 0}
                  </span>
                  <button 
                    type="button"
                    className="w-12 h-12 flex items-center justify-center rounded-lg bg-blue-600 shadow-sm text-white text-xl font-bold active:bg-blue-800 disabled:opacity-50"
                    onClick={() => handleUpdateCart(prod, 1)}
                    disabled={prod.stock_disponible <= (cart.find(c => c.id === prod.id)?.cantidad_carrito || 0)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- DERECHA: CARRITO Y FORMULARIO DE ORDEN ---------------- */}
      <div className="w-full md:w-[400px] lg:w-[450px] bg-white border-l border-slate-200 shadow-2xl flex flex-col z-10 md:h-screen">
        
        <div className="p-6 border-b border-slate-100 bg-blue-50">
          <h2 className="text-xl font-black text-blue-900">Carrito de Orden</h2>
        </div>

        {/* Lista de Items */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {cart.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-400 font-medium text-center">
              Tu carrito está vacío.<br/>Agrega productos desde el catálogo.
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map(item => (
                <div key={item.id} className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                  <div className="flex-1 pr-4">
                    <h4 className="font-bold text-sm leading-tight text-slate-700 line-clamp-1">{item.nombre}</h4>
                    <p className="text-xs text-slate-500 mt-1">{item.cantidad_carrito} un. x ${item.precio_usd}</p>
                  </div>
                  <div className="font-black text-blue-700 whitespace-nowrap">
                    ${(item.precio_usd * item.cantidad_carrito).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer: Totales y Formulario */}
        <div className="p-6 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            
            {/* Totales */}
            <div className="bg-blue-900 text-white p-4 rounded-2xl flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-blue-200 font-medium">Total USD:</span>
                <span className="text-2xl font-black">${totalUSD.toFixed(2)}</span>
              </div>
            </div>

            {/* Selector de Cliente */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-bold text-slate-700">Cliente Asignado</label>
                <button 
                  type="button"
                  onClick={() => setShowClientModal(true)}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded transition-colors"
                >
                  + Nuevo Cliente
                </button>
              </div>
              <select 
                className="w-full h-14 bg-slate-50 border border-slate-200 rounded-xl px-4 font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-colors"
                value={selectedCliente}
                onChange={(e) => {
                  const val = e.target.value
                  setSelectedCliente(val)
                  const clienteSel = clientes.find(c => c.id === val)
                  setDireccionEnvio(clienteSel?.direccion || '')
                }}
                required
              >
                <option value="" disabled>Seleccionar cliente...</option>
                {clientes.map(cli => (
                  <option key={cli.id} value={cli.id}>{cli.nombre} - {cli.cedula_rif}</option>
                ))}
              </select>
            </div>

            {/* Método de Pago */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Método de Pago</label>
              <select 
                className="w-full h-14 bg-slate-50 border border-slate-200 rounded-xl px-4 font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-colors"
                value={metodoPago}
                onChange={(e) => setMetodoPago(e.target.value)}
                required
              >
                <option value="Zelle">Zelle</option>
                <option value="Efectivo">Efectivo Divisas</option>
                <option value="Binance">Binance</option>
                <option value="Transferencia">Transferencia / Pago Móvil</option>
                <option value="Panama">Cuenta Panamá</option>
              </select>
            </div>

            {/* Modalidad y Condición */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-bold text-slate-700 mb-2">Modalidad</label>
                <div className="flex gap-2">
                  <select 
                    className="flex-1 h-14 bg-slate-50 border border-slate-200 rounded-xl px-4 font-medium text-slate-800 outline-none focus:border-blue-500 transition-colors"
                    value={modalidadPago}
                    onChange={(e) => setModalidadPago(e.target.value)}
                  >
                    <option value="Contado">Contado</option>
                    <option value="Crédito">Crédito</option>
                  </select>
                  {modalidadPago === 'Crédito' && (
                    <div className="flex gap-2">
                      <input 
                        type="number" 
                        placeholder="Inicial ($)" 
                        className="w-24 h-14 bg-slate-50 border border-slate-200 rounded-xl px-2 font-medium text-slate-800 outline-none focus:border-blue-500 transition-colors text-center"
                        value={inicialMonto || ''}
                        onChange={(e) => setInicialMonto(Number(e.target.value))}
                        min="0"
                      />
                      <input 
                        type="number" 
                        placeholder="Días" 
                        className="w-20 h-14 bg-slate-50 border border-slate-200 rounded-xl px-2 font-medium text-slate-800 outline-none focus:border-blue-500 transition-colors text-center"
                        value={diasCredito || ''}
                        onChange={(e) => setDiasCredito(Number(e.target.value))}
                        min="1"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-bold text-slate-700 mb-2">Condición</label>
                <select 
                  className="w-full h-14 bg-slate-50 border border-slate-200 rounded-xl px-4 font-medium text-slate-800 outline-none focus:border-blue-500 transition-colors"
                  value={condicionEntrega}
                  onChange={(e) => setCondicionEntrega(e.target.value)}
                >
                  <option value="Retiro">Retiro Cliente</option>
                  <option value="Despacho">Despacho</option>
                </select>
              </div>
            </div>

            {/* Dirección de Envío */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Dirección de Envío / Despacho</label>
              <textarea 
                className="w-full h-20 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-colors resize-none"
                value={direccionEnvio}
                onChange={(e) => setDireccionEnvio(e.target.value)}
                placeholder="Dirección donde se entregará la mercancía..."
              />
            </div>

            {/* Ajuste de Precio */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input 
                  type="checkbox" 
                  className="w-5 h-5 text-blue-600 rounded"
                  checked={precioPersonalizado}
                  onChange={(e) => {
                    setPrecioPersonalizado(e.target.checked)
                    if (e.target.checked) setTotalPersonalizado(totalUSD)
                  }}
                />
                <span className="text-sm font-bold text-slate-700">Ajuste de Precio Final (USD)</span>
              </label>
              {precioPersonalizado && (
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full h-12 bg-white border border-slate-300 rounded-lg px-4 font-medium text-slate-800 outline-none focus:border-blue-500 mt-2"
                  value={totalPersonalizado}
                  onChange={(e) => setTotalPersonalizado(Number(e.target.value))}
                />
              )}
            </div>

            {/* Alertas */}
            {mensaje && (
              <div className={`p-4 rounded-xl text-sm font-bold ${mensaje.tipo === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {mensaje.texto}
              </div>
            )}

            {/* Botón de Envío (Grande / Táctil) */}
            <button 
              type="submit" 
              disabled={isSubmitting || cart.length === 0}
              className="w-full h-16 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-lg font-black tracking-wide shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-2"
            >
              {isSubmitting ? 'Procesando Orden...' : 'Generar Orden'}
            </button>
          </form>
        </div>
      </div>
      
      {/* Modal Crear Cliente */}
      <CreateClientModal 
        isOpen={showClientModal} 
        onClose={() => setShowClientModal(false)} 
        onSuccess={(nuevoCliente) => {
          setClientes(prev => [...prev, nuevoCliente])
          setSelectedCliente(nuevoCliente.id)
          alert('Cliente registrado exitosamente.')
        }}
      />
    </div>
  )
}
