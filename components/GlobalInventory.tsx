'use client'

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { CircleCheck, CircleX, FileDown, LayoutGrid, List, LoaderCircle, Package, PackagePlus, PackageX, Pencil, Search, SearchX, Trash2, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { eliminarProducto, listarProductosActivos } from '@/lib/services/productos'
import { leerRolActual } from '@/lib/services/usuarios'
import { coincideProducto, estadoStock, imagenPrincipal, UMBRAL_STOCK_BAJO, type EstadoStock, type Producto } from '@/lib/domain/productos'
import { precioSegunMoneda } from '@/lib/domain/precios'
import { descargarInventarioPDF } from '@/lib/pdf/inventario'
import { numero, plural, usd } from '@/lib/formato'
import ProductoFormModal from '@/components/ProductoFormModal'
import ImagenProducto from '@/components/ui/ImagenProducto'
import Boton from '@/components/ui/Boton'
import Pestanas from '@/components/ui/Pestanas'
import { claseEntrada } from '@/components/ui/Campo'
import { Bloque } from '@/components/ui/Esqueleto'
import { useToast } from '@/components/ui/Toast'
import { useConfirmacion } from '@/components/ui/Confirmacion'

type Vista = 'tarjetas' | 'tabla'
type Filtro = 'todos' | EstadoStock

// Siempre icono + texto: el color nunca es el único indicio
const ESTADOS_STOCK: Record<EstadoStock, { etiqueta: string; icono: LucideIcon; clase: string }> = {
  disponible: { etiqueta: 'En stock', icono: CircleCheck, clase: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  bajo: { etiqueta: 'Stock bajo', icono: TriangleAlert, clase: 'bg-amber-50 text-amber-800 ring-amber-200' },
  agotado: { etiqueta: 'Agotado', icono: PackageX, clase: 'bg-red-50 text-red-700 ring-red-200' },
}

// Roles que pueden crear, editar y borrar productos (los mismos de siempre, incluidos nombres antiguos)
const ROLES_EDITORES = ['administracion', 'administrador', 'admin', 'owner']

// La vista elegida (tarjetas o tabla) se recuerda en este navegador
const CLAVE_VISTA = 'erp.inventario.vista'
function leerVistaGuardada(): Vista {
  try {
    return localStorage.getItem(CLAVE_VISTA) === 'tabla' ? 'tabla' : 'tarjetas'
  } catch {
    return 'tarjetas'
  }
}

export default function GlobalInventory({ hideHeader = false }: { hideHeader?: boolean }) {
  const [supabase] = useState(() => createClient())
  const toast = useToast()
  const confirmar = useConfirmacion()

  const [productos, setProductos] = useState<Producto[] | null>(null) // null = primera carga
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [recargas, setRecargas] = useState(0)
  const [rol, setRol] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const consulta = useDeferredValue(busqueda)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [vista, setVista] = useState<Vista>(leerVistaGuardada)
  const [formulario, setFormulario] = useState<{ abierto: boolean; producto: Producto | null }>({ abierto: false, producto: null })
  const [eliminando, setEliminando] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  useEffect(() => {
    leerRolActual(supabase).then(setRol)
  }, [supabase])

  // Carga y refresco en tiempo real cuando cambia cualquier producto
  useEffect(() => {
    let vigente = true
    const cargar = () => listarProductosActivos(supabase).then(resultado => {
      if (!vigente) return
      if (resultado.ok) {
        setProductos(resultado.datos)
        setErrorCarga(null)
      } else {
        setErrorCarga(resultado.error)
      }
    })
    cargar()
    const canal = supabase
      .channel('productos-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, cargar)
      .subscribe()
    return () => {
      vigente = false
      supabase.removeChannel(canal)
    }
  }, [supabase, recargas])

  const esEditor = ROLES_EDITORES.includes((rol ?? '').toLowerCase())

  const coincidencias = useMemo(() => (productos ?? []).filter(p => coincideProducto(p, consulta)), [productos, consulta])
  const cuentas = useMemo(() => {
    const porEstado: Record<EstadoStock, number> = { disponible: 0, bajo: 0, agotado: 0 }
    for (const p of coincidencias) porEstado[estadoStock(p.stock_disponible)]++
    return porEstado
  }, [coincidencias])
  const visibles = filtro === 'todos' ? coincidencias : coincidencias.filter(p => estadoStock(p.stock_disponible) === filtro)
  const unidades = useMemo(() => (productos ?? []).reduce((suma, p) => suma + Math.max(0, Number(p.stock_disponible) || 0), 0), [productos])

  const cambiarVista = (siguiente: Vista) => {
    setVista(siguiente)
    try {
      localStorage.setItem(CLAVE_VISTA, siguiente)
    } catch {
      // sin almacenamiento (p. ej. navegación privada): solo no se recuerda
    }
  }

  const abrirNuevo = () => setFormulario({ abierto: true, producto: null })
  const abrirEdicion = (producto: Producto) => setFormulario({ abierto: true, producto })

  const alGuardar = (mensaje: string) => {
    const producto = formulario.producto
    setFormulario(actual => ({ ...actual, abierto: false }))
    toast.exito(mensaje, producto ? { descripcion: producto.nombre } : undefined)
    setRecargas(n => n + 1)
  }

  const borrar = async (producto: Producto) => {
    const confirmado = await confirmar({
      titulo: `¿Eliminar "${producto.nombre}"?`,
      descripcion: 'Se borra del inventario global y no se puede deshacer.',
      confirmar: 'Eliminar producto',
      tono: 'peligro',
    })
    if (!confirmado) return
    setEliminando(producto.id)
    const resultado = await eliminarProducto(supabase, producto.id)
    setEliminando(null)
    if (!resultado.ok) {
      toast.error(`No se pudo eliminar "${producto.nombre}"`, { descripcion: resultado.error })
      return
    }
    setProductos(lista => (lista ?? []).filter(p => p.id !== producto.id))
    toast.exito('Producto eliminado', { descripcion: producto.nombre })
  }

  // Exporta lo que se está viendo (con la búsqueda y el filtro aplicados)
  const exportar = async () => {
    setExportando(true)
    try {
      await descargarInventarioPDF(visibles)
    } catch (error) {
      toast.error('No se pudo generar el PDF', { descripcion: error instanceof Error ? error.message : String(error) })
    } finally {
      setExportando(false)
    }
  }

  const acciones = { esEditor, eliminando, onEditar: abrirEdicion, onEliminar: borrar }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-6 font-sans md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className={`flex items-center gap-2.5 font-semibold tracking-tight text-slate-900 ${hideHeader ? 'text-2xl' : 'text-3xl'}`}>
            <Package className="h-6 w-6 text-indigo-600" aria-hidden />
            Inventario global
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {productos ? `${plural(productos.length, 'producto activo', 'productos activos')} · ${plural(unidades, 'unidad disponible', 'unidades disponibles')}` : 'Cargando el catálogo…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" icono={FileDown} cargando={exportando} disabled={!productos || visibles.length === 0} onClick={exportar}>
            Exportar PDF
          </Boton>
          {esEditor && <Boton icono={PackagePlus} onClick={abrirNuevo}>Añadir producto</Boton>}
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative xl:w-96">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            aria-label="Buscar productos"
            placeholder="Buscar por SKU o nombre"
            className={`${claseEntrada} h-10 pl-10 pr-9 [&::-webkit-search-cancel-button]:hidden`}
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <Pestanas
          etiqueta="Filtrar por disponibilidad"
          valor={filtro}
          onCambiar={setFiltro}
          opciones={[
            { id: 'todos', etiqueta: 'Todos', cuenta: productos ? coincidencias.length : undefined },
            { id: 'disponible', etiqueta: 'En stock', cuenta: productos ? cuentas.disponible : undefined },
            { id: 'bajo', etiqueta: `Stock bajo (≤ ${UMBRAL_STOCK_BAJO})`, cuenta: productos ? cuentas.bajo : undefined },
            { id: 'agotado', etiqueta: 'Agotados', cuenta: productos ? cuentas.agotado : undefined },
          ]}
        />
        <Pestanas
          className="xl:ml-auto"
          etiqueta="Forma de ver el catálogo"
          valor={vista}
          onCambiar={cambiarVista}
          opciones={[
            { id: 'tarjetas', etiqueta: 'Tarjetas', icono: LayoutGrid },
            { id: 'tabla', etiqueta: 'Tabla', icono: List },
          ]}
        />
      </div>

      <section className="mt-5" aria-live="polite" aria-busy={productos === null}>
        {!productos && errorCarga ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
            <CircleX className="h-8 w-8 text-red-500" aria-hidden />
            <p className="max-w-md text-sm text-slate-600">{errorCarga}</p>
            <Boton variante="secundario" onClick={() => setRecargas(n => n + 1)}>Reintentar</Boton>
          </div>
        ) : !productos ? (
          vista === 'tarjetas' ? <TarjetasEsqueleto /> : <TablaEsqueleto />
        ) : visibles.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              {productos.length === 0 ? <Package className="h-6 w-6" aria-hidden /> : <SearchX className="h-6 w-6" aria-hidden />}
            </span>
            <p className="font-medium text-slate-900">{productos.length === 0 ? 'El catálogo está vacío' : 'Ningún producto coincide'}</p>
            <p className="text-sm text-slate-500">
              {productos.length === 0 ? 'Añade productos uno a uno o importa un Excel.' : 'Prueba con otro SKU o nombre, o quita el filtro.'}
            </p>
            {productos.length === 0 && esEditor && <Boton icono={PackagePlus} onClick={abrirNuevo}>Añadir producto</Boton>}
          </div>
        ) : vista === 'tarjetas' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibles.map(producto => <TarjetaProducto key={producto.id} producto={producto} {...acciones} />)}
          </div>
        ) : (
          <TablaProductos productos={visibles} {...acciones} />
        )}
      </section>

      <ProductoFormModal
        abierto={formulario.abierto}
        producto={formulario.producto}
        onCerrar={() => setFormulario(actual => ({ ...actual, abierto: false }))}
        onGuardado={alGuardar}
      />
    </div>
  )
}

interface AccionesProducto {
  esEditor: boolean
  eliminando: string | null
  onEditar: (producto: Producto) => void
  onEliminar: (producto: Producto) => void
}

function TarjetaProducto({ producto, esEditor, eliminando, onEditar, onEliminar }: { producto: Producto } & AccionesProducto) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80 transition-shadow hover:shadow-md">
      {/* overflow-hidden: una foto cuadrada no debe estirar la caja 3:2 */}
      <div className="relative aspect-[3/2] overflow-hidden bg-slate-50">
        <ImagenProducto url={imagenPrincipal(producto)} nombre={producto.nombre} />
        <div className="absolute left-3 top-3">
          <InsigniaStock stock={producto.stock_disponible} />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="font-mono text-xs text-slate-500">{producto.sku}</p>
        <h3 className="mt-1 line-clamp-2 font-medium leading-snug text-slate-900">{producto.nombre}</h3>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Precio USD</p>
            <p className="text-xl font-semibold tracking-tight text-slate-900">{usd(producto.precio_usd)}</p>
          </div>
          <PrecioBcv producto={producto} />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-200/70 text-center ring-1 ring-slate-200/70">
          <div className="bg-slate-50 px-2 py-2">
            <dt className="text-[11px] text-slate-500">Disponible</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{numero(Number(producto.stock_disponible) || 0)}</dd>
          </div>
          <div className="bg-slate-50 px-2 py-2">
            <dt className="text-[11px] text-slate-500">Reservado</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{numero(Number(producto.stock_reservado) || 0)}</dd>
          </div>
        </dl>

        {esEditor && (
          <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
            <Boton variante="secundario" tamano="sm" icono={Pencil} onClick={() => onEditar(producto)} className="flex-1">Editar</Boton>
            <BotonEliminar producto={producto} eliminando={eliminando} onEliminar={onEliminar} />
          </div>
        )}
      </div>
    </article>
  )
}

function TablaProductos({ productos, esEditor, eliminando, onEditar, onEliminar }: { productos: Producto[] } & AccionesProducto) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3">Producto</th>
            <th scope="col" className="px-5 py-3 text-right">Precio USD</th>
            <th scope="col" className="px-5 py-3 text-right">Precio BCV</th>
            <th scope="col" className="px-5 py-3">Disponible</th>
            <th scope="col" className="px-5 py-3 text-right">Reservado</th>
            {esEditor && <th scope="col" className="px-5 py-3"><span className="sr-only">Acciones</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {productos.map(producto => (
            <tr key={producto.id} className="transition-colors hover:bg-slate-50/70">
              <td className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
                    <ImagenProducto url={imagenPrincipal(producto)} nombre={producto.nombre} compacta />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{producto.nombre}</p>
                    <p className="font-mono text-xs text-slate-500">{producto.sku}</p>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-slate-900">{usd(producto.precio_usd)}</td>
              <td className="whitespace-nowrap px-5 py-3 text-right"><PrecioBcv producto={producto} compacto /></td>
              <td className="whitespace-nowrap px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="w-10 font-semibold tabular-nums text-slate-900">{numero(Number(producto.stock_disponible) || 0)}</span>
                  <InsigniaStock stock={producto.stock_disponible} />
                </div>
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-slate-600">{numero(Number(producto.stock_reservado) || 0)}</td>
              {esEditor && (
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => onEditar(producto)}
                      aria-label={`Editar ${producto.nombre}`}
                      title="Editar"
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <BotonEliminar producto={producto} eliminando={eliminando} onEliminar={onEliminar} soloIcono />
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Precio con pago en Bs. a tasa BCV: el diferencial del owner o, si no hay, el mismo precio USD */
function PrecioBcv({ producto, compacto = false }: { producto: Producto; compacto?: boolean }) {
  const precioBcv = precioSegunMoneda(producto, 'BCV')
  const diferencial = Number(producto.precio_bs) > 0 && precioBcv !== Number(producto.precio_usd)
  const variacion = Number(producto.precio_usd) > 0 ? (precioBcv - Number(producto.precio_usd)) / Number(producto.precio_usd) : 0
  return (
    <div className="text-right">
      {!compacto && <p className="text-xs text-slate-500">Precio BCV</p>}
      <p className={`font-semibold tabular-nums ${diferencial ? 'text-slate-900' : 'text-slate-500'} ${compacto ? '' : 'text-sm'}`}>{usd(precioBcv)}</p>
      <p className={`text-[11px] ${diferencial ? 'font-medium text-indigo-600' : 'text-slate-400'}`}>
        {diferencial ? `${variacion > 0 ? '+' : ''}${(variacion * 100).toFixed(variacion !== 0 && Math.abs(variacion) < 0.1 ? 1 : 0)}% diferencial` : 'Sin diferencial'}
      </p>
    </div>
  )
}

function InsigniaStock({ stock }: { stock: number | null }) {
  const estilo = ESTADOS_STOCK[estadoStock(stock)]
  const Icono = estilo.icono
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${estilo.clase}`}>
      <Icono className="h-3.5 w-3.5" aria-hidden />
      {estilo.etiqueta}
    </span>
  )
}

function BotonEliminar({ producto, eliminando, onEliminar, soloIcono = false }: {
  producto: Producto
  eliminando: string | null
  onEliminar: (producto: Producto) => void
  soloIcono?: boolean
}) {
  const propio = eliminando === producto.id
  const Icono = propio ? LoaderCircle : Trash2
  return (
    <button
      type="button"
      onClick={() => onEliminar(producto)}
      disabled={eliminando !== null}
      aria-label={`Eliminar ${producto.nombre}`}
      title="Eliminar"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 ${soloIcono ? 'p-2' : 'h-8 px-2.5 ring-1 ring-inset ring-slate-200'}`}
    >
      <Icono className={`h-4 w-4 ${propio ? 'animate-spin' : ''}`} aria-hidden />
    </button>
  )
}

function TarjetasEsqueleto() {
  return (
    <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80">
          <Bloque className="aspect-[3/2] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Bloque className="h-3 w-20" />
            <Bloque className="h-4 w-full" />
            <Bloque className="h-6 w-24" />
            <Bloque className="h-12 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

function TablaEsqueleto() {
  return (
    <div aria-hidden className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200/80">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3">
          <Bloque className="h-11 w-11" />
          <Bloque className="h-4 w-64" />
          <Bloque className="ml-auto h-4 w-20" />
          <Bloque className="h-4 w-20" />
          <Bloque className="h-5 w-24" />
        </div>
      ))}
    </div>
  )
}
