'use client'

import React, { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, CircleAlert, CircleCheck, CircleX, Minus, PackageX, Plus, Search, SearchX, ShoppingCart, Trash2, TriangleAlert, UserPlus, UserRound, X, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listarProductosActivos } from '@/lib/services/productos'
import { listarClientes } from '@/lib/services/clientes'
import { precioSegunMoneda } from '@/lib/domain/precios'
import { coincideProducto, estadoStock, imagenPrincipal, type EstadoStock, type Producto } from '@/lib/domain/productos'
import { coincideConBusqueda, type Cliente } from '@/lib/domain/clientes'
import { numero, plural, usd } from '@/lib/formato'
import CreateClientModal from '@/components/CreateClientModal'
import ImagenProducto from '@/components/ui/ImagenProducto'
import Modal from '@/components/ui/Modal'
import Boton from '@/components/ui/Boton'
import Campo, { ariaCampo, claseEntrada } from '@/components/ui/Campo'
import { Bloque } from '@/components/ui/Esqueleto'
import { useToast } from '@/components/ui/Toast'
import { useConfirmacion } from '@/components/ui/Confirmacion'

// ============================================================================
// TIPOS Y OPCIONES
// ============================================================================

export interface CartItem extends Producto {
  cantidad_carrito: number
  precio_unitario_editable: number
  moneda_aplicada: 'USD' | 'BCV'
}

interface Opcion {
  valor: string
  etiqueta: string
}

// El valor es el que se guarda en la orden (el de siempre); la etiqueta es solo lo que se ve
const METODOS_PAGO: Opcion[] = [
  { valor: 'Zelle', etiqueta: 'Zelle' },
  { valor: 'Efectivo', etiqueta: 'Efectivo divisas' },
  { valor: 'Binance', etiqueta: 'Binance' },
  { valor: 'Transferencia', etiqueta: 'Transferencia / Pago móvil' },
  { valor: 'Panama', etiqueta: 'Cuenta Panamá' },
]
const MODALIDADES: Opcion[] = [{ valor: 'Contado', etiqueta: 'Contado' }, { valor: 'Crédito', etiqueta: 'Crédito' }]
const CONDICIONES: Opcion[] = [{ valor: 'Retiro', etiqueta: 'Retiro del cliente' }, { valor: 'Despacho', etiqueta: 'Despacho' }]

type CampoOrden = 'cliente' | 'inicial' | 'dias' | 'descuento' | 'totalPersonalizado'
// En el orden en que aparecen: se enfoca el primero con error
const CAMPOS_ORDEN: CampoOrden[] = ['cliente', 'inicial', 'dias', 'descuento', 'totalPersonalizado']
// Los que traen límites en el propio input (min, max, step), los mismos de siempre
const CAMPOS_CON_LIMITES: CampoOrden[] = ['inicial', 'dias', 'descuento', 'totalPersonalizado']

const AYUDA_DESCUENTO = 'De 0 a 20 %.'
const MAX_CLIENTES_VISIBLES = 60

/** Aviso para un input fuera de sus límites (antes lo daba el navegador en un globo) */
function mensajeDeLimites(entrada: HTMLInputElement): string | null {
  const { validity } = entrada
  if (validity.valid) return null
  if (validity.badInput) return 'Escribe un número válido.'
  if (validity.rangeUnderflow) return `El mínimo es ${entrada.min}.`
  if (validity.rangeOverflow) return `El máximo es ${entrada.max}.`
  if (validity.stepMismatch) return entrada.step && entrada.step !== '1' ? 'Usa como máximo dos decimales.' : 'Usa un número entero.'
  return entrada.validationMessage
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function VendedorPOS() {
  const [supabase] = useState(() => createClient())
  const toast = useToast()
  const confirmar = useConfirmacion()
  const idFormulario = useId()
  const idCampo = (campo: CampoOrden) => `${idFormulario}-${campo}`
  const raiz = useRef<HTMLDivElement>(null)
  const posicionCatalogo = useRef(0)

  // Estados Globales de la Vista
  const [productos, setProductos] = useState<Producto[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const consulta = useDeferredValue(searchQuery)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [errorProductos, setErrorProductos] = useState<string | null>(null)
  const [recargaProductos, setRecargaProductos] = useState(0)
  const [cargandoClientes, setCargandoClientes] = useState(true)
  const [errorClientes, setErrorClientes] = useState<string | null>(null)
  const [recargaClientes, setRecargaClientes] = useState(0)

  // Estados de la Orden
  const [selectedCliente, setSelectedCliente] = useState<string>('')
  const [metodoPago, setMetodoPago] = useState<string>('Transferencia')
  const [modalidadPago, setModalidadPago] = useState<string>('Contado')
  const [inicialMonto, setInicialMonto] = useState<number | null>(null)
  const [diasCredito, setDiasCredito] = useState<number | null>(null)
  const [condicionEntrega, setCondicionEntrega] = useState<string>('Retiro')
  const [direccionEnvio, setDireccionEnvio] = useState<string>('')
  const [precioPersonalizado, setPrecioPersonalizado] = useState<boolean>(false)
  const [totalPersonalizado, setTotalPersonalizado] = useState<number>(0)
  const [porcentajeDescuento, setPorcentajeDescuento] = useState<number>(0)
  const [showClientModal, setShowClientModal] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)

  // Presentación: errores junto a cada campo, selector de cliente y vista activa en móvil
  const [errores, setErrores] = useState<Partial<Record<CampoOrden, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [eligiendoCliente, setEligiendoCliente] = useState(false)
  const [vistaMovil, setVistaMovil] = useState<'catalogo' | 'orden'>('catalogo')

  // Carga inicial de datos: las mismas tablas de siempre, por páginas y con aviso si falla
  useEffect(() => {
    const control = new AbortController()
    listarProductosActivos(supabase, { signal: control.signal }).then(resultado => {
      if (control.signal.aborted) return
      if (resultado.ok) setProductos(resultado.datos)
      else setErrorProductos(resultado.error)
      setIsLoading(false)
    })
    return () => control.abort()
  }, [supabase, recargaProductos])

  useEffect(() => {
    const control = new AbortController()
    listarClientes(supabase, { signal: control.signal }).then(resultado => {
      if (control.signal.aborted) return
      if (resultado.ok) setClientes(resultado.datos)
      else setErrorClientes(resultado.error)
      setCargandoClientes(false)
    })
    return () => control.abort()
  }, [supabase, recargaClientes])

  const reintentarProductos = () => {
    setIsLoading(true)
    setErrorProductos(null)
    setRecargaProductos(n => n + 1)
  }
  const reintentarClientes = () => {
    setCargandoClientes(true)
    setErrorClientes(null)
    setRecargaClientes(n => n + 1)
  }

  // Filtrado de Productos (nombre o SKU, sin distinguir mayúsculas ni acentos)
  const productosFiltrados = useMemo(() => productos.filter(p => coincideProducto(p, consulta)), [productos, consulta])
  const cantidades = useMemo(() => new Map(cart.map(item => [item.id, item.cantidad_carrito])), [cart])
  const clienteElegido = clientes.find(c => c.id === selectedCliente) ?? null

  // Totales
  const subtotalUSD = cart.reduce((acc, item) => {
    // Ambos valores (USD y BCV) representan montos directos en USD. 1:1
    const price = item.precio_unitario_editable !== undefined ? item.precio_unitario_editable : item.precio_usd;
    return acc + (price * item.cantidad_carrito);
  }, 0)

  const montoDescuento = subtotalUSD * (porcentajeDescuento / 100);
  const totalUSD = subtotalUSD - montoDescuento;
  // Lo que se cobra: el mismo cálculo que va en total_usd
  const totalACobrar = precioPersonalizado ? (Number(totalPersonalizado) || 0) : (Number(totalUSD) || 0)
  const unidades = cart.reduce((suma, item) => suma + item.cantidad_carrito, 0)

  const avisarTope = (producto: Producto) =>
    toast.aviso('Stock máximo alcanzado', { descripcion: `${producto.nombre}: hay ${numero(producto.stock_disponible)} disponibles.` })

  // Manejador del Carrito (Sumar/Restar con validación de stock)
  const handleUpdateCart = (producto: Producto, delta: number) => {
    // El aviso va aquí y no dentro del updater de estado, que React puede ejecutar dos veces
    const enCarrito = cart.find(item => item.id === producto.id)
    if (enCarrito) {
      const nuevaCantidad = enCarrito.cantidad_carrito + delta
      if (nuevaCantidad > 0 && nuevaCantidad > producto.stock_disponible) {
        avisarTope(producto)
        return
      }
    }
    setCart(prev => {
      const existing = prev.find(item => item.id === producto.id)
      
      if (existing) {
        const nuevaCantidad = existing.cantidad_carrito + delta
        if (nuevaCantidad <= 0) {
          return prev.filter(item => item.id !== producto.id)
        }
        if (nuevaCantidad > producto.stock_disponible) {
          return prev
        }
        return prev.map(item => item.id === producto.id ? { ...item, cantidad_carrito: nuevaCantidad } : item)
      } else {
        if (delta > 0 && producto.stock_disponible >= delta) {
          return [...prev, { 
            ...producto, 
            cantidad_carrito: delta, 
            precio_unitario_editable: producto.precio_usd, 
            moneda_aplicada: 'USD' 
          }]
        }
        return prev
      }
    })
  }

  // Cantidad escrita a mano: mismo tope de stock; si se pasa, queda en el máximo disponible
  const fijarCantidad = (producto: Producto, cantidad: number) => {
    const actual = cantidades.get(producto.id) ?? 0
    const permitida = Math.min(cantidad, producto.stock_disponible)
    if (cantidad > producto.stock_disponible) avisarTope(producto)
    if (permitida > 0 && permitida !== actual) handleUpdateCart(producto, permitida - actual)
  }

  const handleEditPrice = (id: string, newPrice: number) => {
    setCart(prev => prev.map(item => item.id === id ? { ...item, precio_unitario_editable: newPrice } : item))
  }

  const handleEditCurrency = (id: string, newCurrency: 'USD' | 'BCV') => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        // Ambos valores son directos en USD: en BCV se usa el precio diferencial del owner, si lo hay
        const suggestedPrice = precioSegunMoneda(item, newCurrency);
        return { ...item, moneda_aplicada: newCurrency, precio_unitario_editable: suggestedPrice }
      }
      return item;
    }))
  }

  const limpiarError = (campo: CampoOrden) => setErrores(actual => (actual[campo] ? { ...actual, [campo]: undefined } : actual))

  // Igual que al elegirlo en la lista de siempre: la dirección de envío pasa a ser la del cliente
  const elegirCliente = (cliente: Cliente) => {
    setSelectedCliente(cliente.id)
    setDireccionEnvio(cliente.direccion || '')
    limpiarError('cliente')
  }

  const vaciarOrden = async () => {
    const confirmado = await confirmar({
      titulo: '¿Vaciar la orden?',
      descripcion: `Se quitan ${plural(cart.length, 'producto', 'productos')} de la orden. El cliente y los datos de pago se mantienen.`,
      confirmar: 'Vaciar orden',
      tono: 'peligro',
    })
    if (confirmado) setCart([])
  }

  // En móvil catálogo y orden son dos vistas; al volver al catálogo se recupera la posición
  const contenedorConScroll = () => {
    let elemento = raiz.current?.parentElement ?? null
    while (elemento && !/(auto|scroll)/.test(getComputedStyle(elemento).overflowY)) elemento = elemento.parentElement
    return elemento
  }
  const moverScroll = (posicion: number) =>
    requestAnimationFrame(() => {
      const contenedor = contenedorConScroll()
      if (contenedor) contenedor.scrollTop = posicion
    })
  const verOrden = () => {
    posicionCatalogo.current = contenedorConScroll()?.scrollTop ?? 0
    setVistaMovil('orden')
    moverScroll(0)
  }
  const verCatalogo = () => {
    setVistaMovil('catalogo')
    moverScroll(posicionCatalogo.current)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    // Validaciones: los mismos límites de cada campo y las mismas reglas, con el aviso junto al campo
    const encontrados: Partial<Record<CampoOrden, string>> = {}
    for (const campo of CAMPOS_CON_LIMITES) {
      const entrada = document.getElementById(idCampo(campo))
      const aviso = entrada instanceof HTMLInputElement ? mensajeDeLimites(entrada) : null
      if (aviso) encontrados[campo] = aviso
    }
    if (cart.length === 0) {
      setErrores(encontrados)
      setErrorGeneral('El carrito está vacío')
      return
    }
    if (!selectedCliente) encontrados.cliente = 'Selecciona un cliente'

    const totalVenta = precioPersonalizado ? (Number(totalPersonalizado) || 0) : (Number(totalUSD) || 0)
    if (modalidadPago === 'Crédito' && Number(inicialMonto) > totalVenta) {
      encontrados.inicial ??= 'La inicial no puede superar el monto total de la venta'
    }

    const primero = CAMPOS_ORDEN.find(campo => encontrados[campo])
    if (primero) {
      setErrores(encontrados)
      setErrorGeneral(null)
      document.getElementById(idCampo(primero))?.focus()
      return
    }

    const nombreCliente = clienteElegido?.nombre
    setIsSubmitting(true)
    setErrores({})
    setErrorGeneral(null)

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
        observaciones: `Orden registrada desde Vendedor POS App. ${porcentajeDescuento > 0 ? `Descuento aplicado: ${porcentajeDescuento}% (Monto: $${montoDescuento.toFixed(2)})` : ''}`,
        total_bs: 0,
        tasa_cambio: 1, // Todo en dólares
        porcentaje_descuento: porcentajeDescuento || 0,
        monto_descuento: montoDescuento || 0
      }

      const { data: ordenData, error: ordenError } = await supabase
        .from('ordenes')
        .insert([ordenPayload])
        .select()
        .single()

      if (ordenError) throw new Error(`Fallo creando orden: ${ordenError.message}`)

      // 4. Insertar los items en 'orden_items'
      const ordenItems = cart.map(item => {
        const finalUsd = item.precio_unitario_editable !== undefined ? item.precio_unitario_editable : item.precio_usd;
        return {
          orden_id: ordenData.id,
          producto_id: item.id,
          cantidad: item.cantidad_carrito,
          precio_unitario_usd: finalUsd,
          precio_unitario_bs: finalUsd // Todo es en dólares directo, replicamos el valor si se requiriera en bd vieja
        }
      })

      const { error: itemsError } = await supabase.from('orden_items').insert(ordenItems)
      if (itemsError) throw new Error(`Fallo registrando items: ${itemsError.message}`)

      // 5. Descontar stock manualmente en la tabla de 'productos'
      const sinDescontar: string[] = []
      for (const item of cart) {
        const nuevoStock = item.stock_disponible - item.cantidad_carrito;
        const { error: stockError } = await supabase
          .from('productos')
          .update({ stock_disponible: nuevoStock })
          .eq('id', item.id);
          
        if (stockError) {
          console.warn(`No se pudo descontar stock del producto ${item.id}:`, stockError);
          sinDescontar.push(item.nombre)
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

      toast.exito('Orden registrada exitosamente', {
        descripcion: `${nombreCliente ?? 'Cliente'} · ${usd(totalVenta)}. Pendiente por aprobación de pago.`,
      })
      // Antes solo quedaba en la consola: la orden ya está registrada, pero el inventario no bajó
      if (sinDescontar.length > 0) {
        toast.aviso('No se pudo descontar el stock', {
          descripcion: `${sinDescontar.join(', ')}. Avisa a administración para ajustar el inventario.`,
        })
      }
      posicionCatalogo.current = 0
      verCatalogo()

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error general del sistema'
      setErrorGeneral(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  // ============================================================================
  // RENDER (UI/UX)
  // ============================================================================
  return (
    <div
      ref={raiz}
      className="flex min-h-full flex-col bg-slate-100 font-sans text-slate-800 lg:grid lg:h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_26rem]"
    >
      {/* ---------------- CATÁLOGO ---------------- */}
      <section
        aria-label="Catálogo de productos"
        inert={isSubmitting}
        className={`${vistaMovil === 'catalogo' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col lg:flex lg:min-h-0`}
      >
        <div className="px-3 pt-4 sm:px-4 lg:px-6 lg:pt-6">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
            <ShoppingCart className="h-6 w-6 text-indigo-600" aria-hidden />
            Punto de venta
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading ? 'Cargando catálogo…' : errorProductos ? 'Catálogo no disponible' : plural(productos.length, 'producto activo', 'productos activos')}
          </p>
        </div>

        {/* En móvil la búsqueda queda fija arriba. Sticky respeta el padding del main del panel (p-6, md:p-8):
            el desfase negativo la deja pegada al borde. Lo mismo en la barra y el pie de la orden */}
        <div className="sticky -top-6 z-20 bg-slate-100/95 px-3 py-3 backdrop-blur-sm sm:px-4 md:-top-8 lg:static lg:bg-transparent lg:px-6 lg:py-4 lg:backdrop-blur-none">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              aria-label="Buscar productos"
              placeholder="Buscar por nombre o SKU"
              className={`${claseEntrada} h-11 pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden`}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>

        {/* pt-0.5: sin él, el contorno de las tarjetas elegidas se corta arriba al desplazar */}
        <div className="flex-1 px-3 pb-4 pt-0.5 sm:px-4 lg:overflow-y-auto lg:px-6 lg:pb-6">
          {isLoading ? (
            <CatalogoEsqueleto />
          ) : errorProductos ? (
            <EstadoVacio icono={CircleX} tono="error" texto={errorProductos} accion={<Boton variante="secundario" onClick={reintentarProductos}>Reintentar</Boton>} />
          ) : productosFiltrados.length === 0 ? (
            <EstadoVacio
              icono={SearchX}
              texto={productos.length === 0 ? 'No hay productos activos en el inventario.' : `Ningún producto coincide con «${searchQuery.trim()}».`}
              accion={searchQuery ? <Boton variante="secundario" onClick={() => setSearchQuery('')}>Limpiar búsqueda</Boton> : undefined}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
              {productosFiltrados.map(prod => (
                <li key={prod.id} className="min-w-0">
                  <TarjetaProducto
                    producto={prod}
                    cantidad={cantidades.get(prod.id) ?? 0}
                    onCambiar={delta => handleUpdateCart(prod, delta)}
                    onFijar={cantidad => fijarCantidad(prod, cantidad)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Móvil: el total de la orden siempre a mano */}
        {cart.length > 0 && (
          <div className="sticky -bottom-6 z-20 px-3 pb-3 sm:px-4 md:-bottom-8 lg:hidden">
            <button
              type="button"
              onClick={verOrden}
              className="flex w-full items-center gap-3 rounded-2xl bg-indigo-600 px-4 py-3 text-left text-white shadow-lg shadow-indigo-900/25 transition-colors hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              <ShoppingCart className="h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Ver orden</span>
                <span className="block truncate text-xs text-indigo-100">{plural(cart.length, 'producto', 'productos')} · {plural(unidades, 'unidad', 'unidades')}</span>
              </span>
              <span className="text-base font-semibold tabular-nums">{usd(totalACobrar)}</span>
              <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
            </button>
          </div>
        )}
      </section>

      {/* ---------------- ORDEN ---------------- */}
      <section
        aria-label="Orden actual"
        aria-busy={isSubmitting || undefined}
        className={`${vistaMovil === 'orden' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col bg-white lg:flex lg:min-h-0 lg:border-l lg:border-slate-200`}
      >
        <header className="sticky -top-6 z-10 flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-3 md:-top-8 lg:static lg:py-4">
          <button type="button" onClick={verCatalogo} aria-label="Volver al catálogo" className="-ml-1.5 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 lg:hidden">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <h2 className="text-base font-semibold text-slate-900">Orden actual</h2>
          {cart.length > 0 && (
            <>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium tabular-nums text-indigo-700">{plural(unidades, 'unidad', 'unidades')}</span>
              <Boton variante="fantasma" tamano="sm" icono={Trash2} onClick={vaciarOrden} disabled={isSubmitting} className="ml-auto">Vaciar</Boton>
            </>
          )}
        </header>

        <div inert={isSubmitting} className="flex-1 space-y-6 px-4 py-5 lg:min-h-0 lg:overflow-y-auto">
          <Seccion
            titulo="Cliente"
            accion={
              <button type="button" onClick={() => setShowClientModal(true)} className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-indigo-600 hover:text-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
                <UserPlus className="h-3.5 w-3.5" aria-hidden />
                Nuevo cliente
              </button>
            }
          >
            <button
              id={idCampo('cliente')}
              type="button"
              onClick={() => setEligiendoCliente(true)}
              aria-label={clienteElegido ? `Cliente: ${clienteElegido.nombre}, ${clienteElegido.cedula_rif}. Cambiar` : 'Elegir cliente'}
              aria-describedby={errores.cliente ? `${idCampo('cliente')}-mensaje` : undefined}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
                clienteElegido
                  ? 'border-slate-200 bg-white hover:bg-slate-50'
                  : errores.cliente
                    ? 'border-dashed border-red-300 bg-red-50/60 hover:bg-red-50'
                    : 'border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100'
              }`}
            >
              {clienteElegido ? (
                <>
                  <Iniciales nombre={clienteElegido.nombre} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{clienteElegido.nombre}</span>
                    <span className="block truncate text-xs text-slate-500">{clienteElegido.cedula_rif}</span>
                  </span>
                  <span className="text-xs font-semibold text-indigo-600">Cambiar</span>
                </>
              ) : (
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
                    <UserRound className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-700">Elegir cliente</span>
                    <span className="block truncate text-xs text-slate-500">
                      {cargandoClientes ? 'Cargando clientes…' : errorClientes ? 'No se pudo cargar la lista' : plural(clientes.length, 'cliente registrado', 'clientes registrados')}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                </>
              )}
            </button>
            {errores.cliente && <MensajeError id={`${idCampo('cliente')}-mensaje`} texto={errores.cliente} />}
          </Seccion>

          <Seccion titulo="Productos">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                <ShoppingCart className="h-6 w-6 text-slate-300" aria-hidden />
                <p className="text-sm font-medium text-slate-600">La orden está vacía</p>
                <p className="text-xs text-slate-500">Agrega productos desde el catálogo.</p>
                <Boton variante="secundario" tamano="sm" onClick={verCatalogo} className="mt-2 lg:hidden">Ir al catálogo</Boton>
              </div>
            ) : (
              <ul className="space-y-2">
                {cart.map(item => (
                  <LineaCarrito
                    key={item.id}
                    item={item}
                    onCambiar={delta => handleUpdateCart(item, delta)}
                    onFijar={cantidad => fijarCantidad(item, cantidad)}
                    onQuitar={() => handleUpdateCart(item, -item.cantidad_carrito)}
                    onPrecio={precio => handleEditPrice(item.id, precio)}
                    onMoneda={moneda => handleEditCurrency(item.id, moneda)}
                  />
                ))}
              </ul>
            )}
          </Seccion>

          <form id={idFormulario} onSubmit={handleSubmit} noValidate className="space-y-6">
            <Seccion titulo="Pago">
              <div className="space-y-4">
                <Opciones etiqueta="Método de pago" opciones={METODOS_PAGO} valor={metodoPago} onCambiar={setMetodoPago} />
                <Opciones
                  etiqueta="Modalidad"
                  opciones={MODALIDADES}
                  valor={modalidadPago}
                  onCambiar={valor => {
                    setModalidadPago(valor)
                    limpiarError('inicial')
                    limpiarError('dias')
                  }}
                />
                {modalidadPago === 'Crédito' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Campo id={idCampo('inicial')} etiqueta="Inicial ($)" error={errores.inicial}>
                      <input
                        {...ariaCampo(idCampo('inicial'), { error: errores.inicial })}
                        type="number"
                        min="0"
                        placeholder="0"
                        value={inicialMonto || ''}
                        onChange={(e) => {
                          setInicialMonto(Number(e.target.value))
                          limpiarError('inicial')
                        }}
                        className={`${claseEntrada} h-11 tabular-nums`}
                      />
                    </Campo>
                    <Campo id={idCampo('dias')} etiqueta="Días de crédito" error={errores.dias}>
                      <input
                        {...ariaCampo(idCampo('dias'), { error: errores.dias })}
                        type="number"
                        min="1"
                        placeholder="0"
                        value={diasCredito || ''}
                        onChange={(e) => {
                          setDiasCredito(Number(e.target.value))
                          limpiarError('dias')
                        }}
                        className={`${claseEntrada} h-11 tabular-nums`}
                      />
                    </Campo>
                  </div>
                )}
              </div>
            </Seccion>

            <Seccion titulo="Entrega">
              <div className="space-y-4">
                <Opciones etiqueta="Condición" opciones={CONDICIONES} valor={condicionEntrega} onCambiar={setCondicionEntrega} />
                <Campo id={`${idFormulario}-direccion`} etiqueta="Dirección de envío / despacho">
                  <textarea
                    id={`${idFormulario}-direccion`}
                    rows={3}
                    value={direccionEnvio}
                    onChange={(e) => setDireccionEnvio(e.target.value)}
                    placeholder="Dirección donde se entregará la mercancía..."
                    className={`${claseEntrada} resize-none py-2.5`}
                  />
                </Campo>
              </div>
            </Seccion>

            <Seccion titulo="Ajustes">
              <div className="space-y-4">
                <Campo id={idCampo('descuento')} etiqueta="Descuento (%)" error={errores.descuento} ayuda={AYUDA_DESCUENTO}>
                  <input
                    {...ariaCampo(idCampo('descuento'), { error: errores.descuento, ayuda: AYUDA_DESCUENTO })}
                    type="number"
                    min="0"
                    max="20"
                    value={porcentajeDescuento}
                    onChange={(e) => {
                      setPorcentajeDescuento(Number(e.target.value))
                      limpiarError('descuento')
                    }}
                    className={`${claseEntrada} h-11 tabular-nums`}
                  />
                </Campo>

                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span>
                      <span className="block text-sm font-medium text-slate-800">Ajuste de precio final</span>
                      <span className="block text-xs text-slate-500">Cobra un total distinto al calculado (USD).</span>
                    </span>
                    <span className="relative inline-flex shrink-0">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={precioPersonalizado}
                        onChange={(e) => {
                          setPrecioPersonalizado(e.target.checked)
                          if (e.target.checked) setTotalPersonalizado(totalUSD)
                          limpiarError('totalPersonalizado')
                        }}
                        className="peer sr-only"
                      />
                      <span aria-hidden className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-indigo-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-600" />
                      <span aria-hidden className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
                    </span>
                  </label>
                  {precioPersonalizado && (
                    <div className="mt-3">
                      <Campo id={idCampo('totalPersonalizado')} etiqueta="Total a cobrar (USD)" error={errores.totalPersonalizado}>
                        <input
                          {...ariaCampo(idCampo('totalPersonalizado'), { error: errores.totalPersonalizado })}
                          type="number"
                          step="0.01"
                          value={totalPersonalizado}
                          onChange={(e) => {
                            setTotalPersonalizado(Number(e.target.value))
                            limpiarError('totalPersonalizado')
                          }}
                          className={`${claseEntrada} h-11 tabular-nums`}
                        />
                      </Campo>
                    </div>
                  )}
                </div>
              </div>
            </Seccion>
          </form>
        </div>

        {/* Totales y envío, siempre visibles al pie del panel */}
        <footer className="sticky -bottom-6 z-10 space-y-3 border-t border-slate-200 bg-white px-4 py-4 shadow-[0_-12px_24px_-18px_rgba(15,23,42,0.35)] md:-bottom-8 lg:static lg:shadow-none">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3 text-slate-600">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{usd(subtotalUSD)}</dd>
            </div>
            {porcentajeDescuento > 0 && (
              <div className="flex justify-between gap-3 text-slate-600">
                <dt>Descuento ({porcentajeDescuento} %)</dt>
                <dd className="tabular-nums">−{usd(montoDescuento)}</dd>
              </div>
            )}
            {precioPersonalizado && (
              <div className="flex justify-between gap-3 text-slate-500">
                <dt>Total calculado</dt>
                <dd className="tabular-nums line-through">{usd(totalUSD)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2">
              <dt className="font-medium text-slate-900">{precioPersonalizado ? 'Total ajustado' : 'Total'}</dt>
              <dd className="text-xl font-semibold tabular-nums tracking-tight text-slate-900">{usd(totalACobrar)}</dd>
            </div>
            {modalidadPago === 'Crédito' && (
              <p className="text-xs text-slate-500">
                A crédito: inicial {usd(Number(inicialMonto) || 0)}
                {Number(diasCredito) > 0 && ` · ${plural(Number(diasCredito), 'día', 'días')}`}
              </p>
            )}
          </dl>
          {errorGeneral && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
              <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
              <p>{errorGeneral}</p>
            </div>
          )}
          <Boton type="submit" form={idFormulario} tamano="lg" cargando={isSubmitting} disabled={cart.length === 0} className="w-full text-base">
            {isSubmitting ? 'Procesando orden…' : 'Generar orden'}
          </Boton>
        </footer>
      </section>

      <SelectorCliente
        abierto={eligiendoCliente}
        onCerrar={() => setEligiendoCliente(false)}
        clientes={clientes}
        cargando={cargandoClientes}
        error={errorClientes}
        onReintentar={reintentarClientes}
        elegido={selectedCliente}
        onElegir={cliente => {
          elegirCliente(cliente)
          setEligiendoCliente(false)
        }}
        onNuevo={() => {
          setEligiendoCliente(false)
          setShowClientModal(true)
        }}
      />

      {/* Modal Crear Cliente */}
      <CreateClientModal
        isOpen={showClientModal}
        onClose={() => setShowClientModal(false)}
        clientesExistentes={cargandoClientes || errorClientes ? undefined : clientes}
        onSuccess={(nuevoCliente) => {
          setClientes(prev => [...prev, nuevoCliente])
          elegirCliente(nuevoCliente)
          toast.exito('Cliente registrado', { descripcion: nuevoCliente.nombre })
        }}
      />
    </div>
  )
}

// ============================================================================
// PIEZAS DE PRESENTACIÓN
// ============================================================================

// Siempre icono + texto: el color nunca es el único indicio
const DISPONIBILIDAD: Record<EstadoStock, { icono: LucideIcon; clase: string }> = {
  disponible: { icono: CircleCheck, clase: 'text-emerald-700' },
  bajo: { icono: TriangleAlert, clase: 'text-amber-700' },
  agotado: { icono: PackageX, clase: 'text-red-700' },
}

function Disponibilidad({ stock }: { stock: number }) {
  const estado = estadoStock(stock)
  const { icono: Icono, clase } = DISPONIBILIDAD[estado]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium tabular-nums ${clase}`}>
      <Icono className="h-3.5 w-3.5" aria-hidden />
      {estado === 'agotado' ? 'Agotado' : (
        <>
          {numero(stock)} <span aria-hidden>disp.</span><span className="sr-only">disponibles</span>
        </>
      )}
    </span>
  )
}

function TarjetaProducto({ producto, cantidad, onCambiar, onFijar }: {
  producto: Producto
  cantidad: number
  onCambiar: (delta: number) => void
  onFijar: (cantidad: number) => void
}) {
  const agotado = estadoStock(producto.stock_disponible) === 'agotado'
  const precioBcv = precioSegunMoneda(producto, 'BCV')
  const enOrden = cantidad > 0
  return (
    <article className={`flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm transition-shadow hover:shadow-md ${enOrden ? 'ring-2 ring-indigo-500' : 'ring-1 ring-slate-200/80'}`}>
      <div className="relative h-28 shrink-0 overflow-hidden bg-slate-50">
        <ImagenProducto url={imagenPrincipal(producto)} nombre={producto.nombre} />
        {enOrden && (
          <span className="absolute left-2 top-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-sm">
            {numero(cantidad)} en la orden
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{producto.sku}</span>
          <Disponibilidad stock={producto.stock_disponible} />
        </div>
        <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-900" title={producto.nombre}>{producto.nombre}</h3>
        <div className="mt-auto pt-2">
          <p className="text-base font-semibold tabular-nums text-slate-900">{usd(producto.precio_usd)}</p>
          {precioBcv !== Number(producto.precio_usd) && <p className="text-xs tabular-nums text-slate-500">BCV {usd(precioBcv)}</p>}
        </div>
        <div className="mt-3">
          {enOrden ? (
            <ControlCantidad cantidad={cantidad} maximo={producto.stock_disponible} nombre={producto.nombre} onCambiar={onCambiar} onFijar={onFijar} />
          ) : (
            <Boton
              variante={agotado ? 'secundario' : 'primario'}
              icono={agotado ? undefined : Plus}
              disabled={agotado}
              onClick={() => onCambiar(1)}
              aria-label={agotado ? `${producto.nombre}: agotado` : `Agregar ${producto.nombre} a la orden`}
              className="w-full"
            >
              {agotado ? 'Agotado' : 'Agregar'}
            </Boton>
          )}
        </div>
      </div>
    </article>
  )
}

/** − cantidad +. La cantidad también se puede escribir: se aplica al salir del campo o con Enter */
function ControlCantidad({ cantidad, maximo, nombre, onCambiar, onFijar, compacto = false }: {
  cantidad: number
  maximo: number
  nombre: string
  onCambiar: (delta: number) => void
  onFijar: (cantidad: number) => void
  compacto?: boolean
}) {
  const [borrador, setBorrador] = useState<string | null>(null)
  const descartar = useRef(false)

  const aplicar = () => {
    const texto = borrador
    setBorrador(null)
    if (descartar.current) {
      descartar.current = false
      return
    }
    const valor = Number.parseInt(texto ?? '', 10)
    // Vacío o cero no borra la línea: para quitarla están el botón − y la ×
    if (Number.isFinite(valor) && valor > 0 && valor !== cantidad) onFijar(valor)
  }

  const claseBoton = `flex shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-slate-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none ${compacto ? 'h-8 w-8' : 'h-9 w-9'}`
  return (
    <div className={`flex items-center rounded-xl bg-slate-100 p-0.5 ring-1 ring-slate-200 ${compacto ? 'w-[6.75rem]' : 'w-full'}`}>
      <button type="button" onClick={() => onCambiar(-1)} aria-label={cantidad === 1 ? `Quitar ${nombre} de la orden` : `Quitar una unidad de ${nombre}`} className={claseBoton}>
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`Cantidad de ${nombre}`}
        value={borrador ?? String(cantidad)}
        onFocus={e => {
          setBorrador(String(cantidad))
          e.currentTarget.select()
        }}
        onChange={e => setBorrador(e.target.value.replace(/\D/g, ''))}
        onBlur={aplicar}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            descartar.current = true
            e.currentTarget.blur()
          }
        }}
        className="h-8 w-full min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums text-slate-900 outline-none"
      />
      <button type="button" onClick={() => onCambiar(1)} disabled={cantidad >= maximo} aria-label={`Agregar una unidad de ${nombre}`} className={claseBoton}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function LineaCarrito({ item, onCambiar, onFijar, onQuitar, onPrecio, onMoneda }: {
  item: CartItem
  onCambiar: (delta: number) => void
  onFijar: (cantidad: number) => void
  onQuitar: () => void
  onPrecio: (precio: number) => void
  onMoneda: (moneda: 'USD' | 'BCV') => void
}) {
  const precioLista = precioSegunMoneda(item, item.moneda_aplicada)
  const editado = item.precio_unitario_editable !== precioLista
  const sinDiferencial = item.moneda_aplicada === 'BCV' && precioLista === Number(item.precio_usd)
  const nota = editado
    ? `Precio editado · lista ${usd(precioLista)}`
    : sinDiferencial
      ? 'Sin precio BCV: se cobra el de lista'
      : item.moneda_aplicada === 'BCV' ? 'Precio BCV de lista' : 'Precio de lista'
  return (
    <li className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-100">
          <ImagenProducto url={imagenPrincipal(item)} nombre={item.nombre} compacta />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">{item.nombre}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{item.sku} · {numero(item.stock_disponible)} disp.</p>
        </div>
        <button type="button" onClick={onQuitar} aria-label={`Quitar ${item.nombre} de la orden`} title="Quitar de la orden" className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ControlCantidad compacto cantidad={item.cantidad_carrito} maximo={item.stock_disponible} nombre={item.nombre} onCambiar={onCambiar} onFijar={onFijar} />
        <div className="flex items-center gap-1.5">
          <div className="relative w-[5.25rem]">
            <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
            <input
              type="number"
              step="0.01"
              aria-label={`Precio unitario de ${item.nombre}`}
              value={item.precio_unitario_editable}
              onChange={(e) => onPrecio(Number(e.target.value))}
              className={`${claseEntrada} h-9 pl-6 pr-1.5 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            />
          </div>
          <SelectorMoneda valor={item.moneda_aplicada} nombre={item.nombre} onCambiar={onMoneda} />
        </div>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className={`text-xs ${editado ? 'font-medium text-indigo-600' : 'text-slate-500'}`}>{nota}</p>
        <p className="text-sm font-semibold tabular-nums text-slate-900">{usd(item.precio_unitario_editable * item.cantidad_carrito)}</p>
      </div>
    </li>
  )
}

/** Cómo paga el cliente esa línea: en BCV se sugiere el precio diferencial que fijó el owner */
function SelectorMoneda({ valor, nombre, onCambiar }: { valor: 'USD' | 'BCV'; nombre: string; onCambiar: (moneda: 'USD' | 'BCV') => void }) {
  return (
    <div role="group" aria-label={`Moneda de cobro de ${nombre}`} className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
      {(['USD', 'BCV'] as const).map(moneda => {
        const activa = valor === moneda
        return (
          <button
            key={moneda}
            type="button"
            aria-pressed={activa}
            title={moneda === 'USD' ? 'Dólar $ (pago en divisas)' : 'Dólar BCV (pago en bolívares)'}
            // Como en la lista de antes: volver a elegir la misma no reinicia el precio
            onClick={() => !activa && onCambiar(moneda)}
            className={`h-8 rounded-md px-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 ${activa ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {moneda}
          </button>
        )
      })}
    </div>
  )
}

function Opciones({ etiqueta, opciones, valor, onCambiar }: { etiqueta: string; opciones: Opcion[]; valor: string; onCambiar: (valor: string) => void }) {
  const nombre = useId()
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{etiqueta}</legend>
      <div className="grid grid-cols-2 gap-2">
        {opciones.map(opcion => {
          const elegida = opcion.valor === valor
          return (
            <label
              key={opcion.valor}
              className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm leading-tight ring-1 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo-600 ${elegida ? 'bg-indigo-50 font-medium text-indigo-900 ring-indigo-300' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
            >
              <input type="radio" name={nombre} value={opcion.valor} checked={elegida} onChange={() => onCambiar(opcion.valor)} className="sr-only" />
              <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${elegida ? 'bg-indigo-600 ring-indigo-600' : 'bg-white ring-slate-300'}`}>
                {elegida && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              {opcion.etiqueta}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function Seccion({ titulo, accion, children }: { titulo: string; accion?: React.ReactNode; children: React.ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
        {accion}
      </div>
      {children}
    </section>
  )
}

function MensajeError({ id, texto }: { id: string; texto: string }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-600">
      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      {texto}
    </p>
  )
}

function Iniciales({ nombre }: { nombre: string }) {
  const iniciales = nombre.trim().split(/\s+/).slice(0, 2).map(parte => parte[0]).join('').toUpperCase()
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
      {iniciales || '?'}
    </span>
  )
}

function EstadoVacio({ icono: Icono, texto, tono = 'neutro', accion }: { icono: LucideIcon; texto: string; tono?: 'neutro' | 'error'; accion?: React.ReactNode }) {
  return (
    <div role={tono === 'error' ? 'alert' : undefined} className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-slate-200/80">
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${tono === 'error' ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-400'}`}>
        <Icono className="h-6 w-6" aria-hidden />
      </span>
      <p className="max-w-sm text-sm text-slate-600">{texto}</p>
      {accion}
    </div>
  )
}

function CatalogoEsqueleto() {
  return (
    <ul aria-hidden className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80">
          <Bloque className="h-28 w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Bloque className="h-3 w-16" />
            <Bloque className="h-4 w-full" />
            <Bloque className="h-4 w-2/3" />
            <Bloque className="h-5 w-20" />
            <Bloque className="h-10 w-full rounded-xl" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function SelectorCliente({ abierto, onCerrar, onNuevo, ...lista }: {
  abierto: boolean
  onCerrar: () => void
  onNuevo: () => void
} & React.ComponentProps<typeof ListaClientes>) {
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      icono={UserRound}
      titulo="Elegir cliente"
      descripcion="Busca por nombre, cédula o RIF."
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="secundario" icono={UserPlus} onClick={onNuevo}>Nuevo cliente</Boton>
        </>
      }
    >
      <ListaClientes {...lista} />
    </Modal>
  )
}

/** Se monta al abrir el selector, así cada búsqueda empieza en limpio */
function ListaClientes({ clientes, cargando, error, onReintentar, elegido, onElegir }: {
  clientes: Cliente[]
  cargando: boolean
  error: string | null
  onReintentar: () => void
  elegido: string
  onElegir: (cliente: Cliente) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const consulta = useDeferredValue(busqueda)
  const coincidencias = useMemo(() => clientes.filter(cliente => coincideConBusqueda(cliente, consulta)), [clientes, consulta])
  const visibles = coincidencias.slice(0, MAX_CLIENTES_VISIBLES)

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          data-autofocus
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          onKeyDown={e => {
            // Enter elige el primer resultado de la búsqueda
            if (e.key === 'Enter' && busqueda.trim() && visibles[0]) {
              e.preventDefault()
              onElegir(visibles[0])
            }
          }}
          aria-label="Buscar cliente"
          placeholder="Nombre, cédula o RIF"
          className={`${claseEntrada} h-11 pl-10`}
        />
      </div>

      {cargando ? (
        <div aria-hidden className="space-y-1">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-1 py-1.5">
              <Bloque className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5"><Bloque className="h-4 w-2/3" /><Bloque className="h-3 w-1/3" /></div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-slate-600">{error}</p>
          <Boton variante="secundario" tamano="sm" onClick={onReintentar}>Reintentar</Boton>
        </div>
      ) : visibles.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          {clientes.length === 0 ? 'Aún no hay clientes registrados.' : 'Ningún cliente coincide con la búsqueda.'}
        </p>
      ) : (
        <ul aria-label="Clientes" className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
          {visibles.map(cliente => {
            const actual = cliente.id === elegido
            return (
              <li key={cliente.id}>
                <button
                  type="button"
                  onClick={() => onElegir(cliente)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 ${actual ? 'bg-indigo-50/70' : 'hover:bg-slate-50'}`}
                >
                  <Iniciales nombre={cliente.nombre} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{cliente.nombre}</span>
                    <span className="block truncate text-xs text-slate-500">{[cliente.cedula_rif, cliente.direccion].filter(Boolean).join(' · ')}</span>
                  </span>
                  {actual && (
                    <>
                      <Check className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
                      <span className="sr-only">(elegido)</span>
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {coincidencias.length > visibles.length && (
        <p className="text-xs text-slate-500">Se muestran {visibles.length} de {numero(coincidencias.length)}. Escribe para afinar la búsqueda.</p>
      )}
    </div>
  )
}
