'use client'

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, CircleX, ClipboardCheck, FileDown, Inbox, PackageOpen, Search, SearchX, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { aprobarOrden, listarOrdenesMonitoreo, rechazarOrden, type OrdenAdmin } from '@/lib/services/ordenes'
import { ADMINISTRACION_RECHAZADO, estaAnulada, estaCerrada, normalizarEstado } from '@/lib/domain/ordenes'
import { textoBuscable } from '@/lib/domain/clientes'
import { descargarNotaEntrega } from '@/lib/pdf/notaEntrega'
import { descargarReporteCompletadas } from '@/lib/pdf/reporteCompletadas'
import { fechaHora, numero, numeroOrden, plural, usd } from '@/lib/formato'
import ModalRechazo from '@/components/ModalRechazo'
import Boton from '@/components/ui/Boton'
import Pestanas from '@/components/ui/Pestanas'
import InsigniaEstado from '@/components/ui/InsigniaEstado'
import { claseEntrada } from '@/components/ui/Campo'
import { Bloque } from '@/components/ui/Esqueleto'
import { useToast } from '@/components/ui/Toast'

type Pestana = 'pendientes' | 'completadas' | 'rechazadas'

const SIN_ORDENES: Record<Pestana, { titulo: string; texto: string }> = {
  pendientes: { titulo: 'No hay órdenes pendientes', texto: 'Las ventas nuevas del POS aparecerán aquí.' },
  completadas: { titulo: 'Aún no hay órdenes completadas', texto: 'Las órdenes entregadas o pagadas aparecerán aquí.' },
  rechazadas: { titulo: 'No hay órdenes rechazadas', texto: 'Las rechazadas en administración o en la entrega aparecerán aquí, con su motivo.' },
}

/** Con cientos de órdenes completadas se pintan por tandas */
const TANDA = 30

function coincideOrden(orden: OrdenAdmin, consulta: string) {
  const texto = textoBuscable(consulta).trim()
  if (!texto) return true
  return [numeroOrden(orden.id), orden.clientes?.nombre, orden.clientes?.cedula_rif, orden.usuarios?.nombre]
    .some(campo => textoBuscable(campo).includes(texto))
}

export default function MonitoreoOrdenes() {
  const [supabase] = useState(() => createClient())
  const toast = useToast()

  const [ordenes, setOrdenes] = useState<OrdenAdmin[] | null>(null) // null = primera carga
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [recargas, setRecargas] = useState(0)
  const [pestana, setPestana] = useState<Pestana>('pendientes')
  const [busqueda, setBusqueda] = useState('')
  const consulta = useDeferredValue(busqueda)
  const [limite, setLimite] = useState(TANDA)
  const [rechazo, setRechazo] = useState<{ abierto: boolean; orden: OrdenAdmin | null }>({ abierto: false, orden: null })
  const [aprobando, setAprobando] = useState<string | null>(null)
  const [descargando, setDescargando] = useState<string | null>(null)

  // Carga inicial y refresco en tiempo real cuando cambia cualquier orden
  useEffect(() => {
    let vigente = true
    const cargar = () => listarOrdenesMonitoreo(supabase).then(resultado => {
      if (!vigente) return
      if (resultado.ok) {
        setOrdenes(resultado.datos)
        setErrorCarga(null)
      } else {
        setErrorCarga(resultado.error)
      }
    })
    cargar()
    const canal = supabase
      .channel('ordenes-admin-monitoreo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, cargar)
      .subscribe()
    return () => {
      vigente = false
      supabase.removeChannel(canal)
    }
  }, [supabase, recargas])

  // Pendientes: todo lo que no está cerrado ni anulado. Completadas: entregadas o pagadas.
  // Rechazadas: anuladas, incluidas las que se rechazaron con marca (el servicio ya resolvió su estado)
  const grupos = useMemo(() => {
    const lista = ordenes ?? []
    return {
      pendientes: lista.filter(o => !estaCerrada(o.estado) && !estaAnulada(o.estado)),
      completadas: lista.filter(o => estaCerrada(o.estado)),
      rechazadas: lista.filter(o => estaAnulada(o.estado)),
    }
  }, [ordenes])
  const coincidencias = useMemo(() => grupos[pestana].filter(o => coincideOrden(o, consulta)), [grupos, pestana, consulta])
  const visibles = coincidencias.slice(0, limite)

  const cambiarPestana = (siguiente: Pestana) => {
    setPestana(siguiente)
    setLimite(TANDA)
  }

  const aprobar = async (orden: OrdenAdmin) => {
    setAprobando(orden.id)
    const resultado = await aprobarOrden(supabase, orden.id)
    setAprobando(null)
    if (!resultado.ok) {
      toast.error('No se pudo aprobar la orden', { descripcion: resultado.error })
      return
    }
    toast.exito(`Orden #${numeroOrden(orden.id)} aprobada`)
    setRecargas(n => n + 1)
  }

  const confirmarRechazo = async (motivo: string) => {
    const orden = rechazo.orden
    if (!orden) return { ok: false as const, error: 'No hay una orden seleccionada.' }
    // Marca la orden sin tocar `estado` (los triggers de stock de la base fallan al cambiarlo) y la
    // mercancía vuelve al inventario desde la app. La orden no se borra
    const resultado = await rechazarOrden(supabase, orden.id, 'rechazado', motivo)
    if (resultado.ok) {
      setOrdenes(lista => (lista ?? []).map(o => (o.id === orden.id ? { ...o, estado: 'rechazado', estado_despacho: ADMINISTRACION_RECHAZADO, motivo_rechazo: motivo } : o)))
      setRechazo(actual => ({ ...actual, abierto: false }))
      const titulo = `Orden #${numeroOrden(orden.id)} rechazada`
      if (resultado.avisoStock) toast.aviso(titulo, { descripcion: `${resultado.avisoStock} La orden quedó en "Rechazadas".`, duracion: 12000 })
      else toast.exito(titulo, { descripcion: `Motivo: ${motivo}. La mercancía volvió al inventario y la orden quedó en "Rechazadas".` })
    }
    return resultado
  }

  const descargarNota = async (orden: OrdenAdmin) => {
    setDescargando(orden.id)
    try {
      await descargarNotaEntrega(orden)
    } catch (error) {
      toast.error('No se pudo generar la nota de entrega', { descripcion: error instanceof Error ? error.message : String(error) })
    } finally {
      setDescargando(null)
    }
  }

  const descargarReporte = async () => {
    setDescargando('reporte')
    try {
      await descargarReporteCompletadas(grupos.completadas)
    } catch (error) {
      toast.error('No se pudo generar el reporte', { descripcion: error instanceof Error ? error.message : String(error) })
    } finally {
      setDescargando(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-6 md:p-8">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
          <ClipboardCheck className="h-6 w-6 text-indigo-600" aria-hidden />
          Monitoreo de órdenes
        </h2>
        <p className="text-sm text-slate-500">Aprueba o rechaza las órdenes en curso y descarga sus notas de entrega.</p>
      </header>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Pestanas
          etiqueta="Grupo de órdenes"
          valor={pestana}
          onCambiar={cambiarPestana}
          opciones={[
            { id: 'pendientes', etiqueta: 'Pendientes', cuenta: ordenes ? grupos.pendientes.length : undefined },
            { id: 'completadas', etiqueta: 'Completadas', cuenta: ordenes ? grupos.completadas.length : undefined },
            { id: 'rechazadas', etiqueta: 'Rechazadas', cuenta: ordenes ? grupos.rechazadas.length : undefined },
          ]}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={busqueda}
              onChange={e => {
                setBusqueda(e.target.value)
                setLimite(TANDA)
              }}
              aria-label="Buscar órdenes"
              placeholder="Orden, cliente, RIF o vendedor"
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
          {pestana === 'completadas' && (
            <Boton
              variante="secundario"
              icono={FileDown}
              cargando={descargando === 'reporte'}
              disabled={grupos.completadas.length === 0}
              onClick={descargarReporte}
            >
              Exportar reporte PDF
            </Boton>
          )}
        </div>
      </div>

      <section className="mt-5" aria-live="polite" aria-busy={ordenes === null}>
        {!ordenes && errorCarga ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
            <CircleX className="h-8 w-8 text-red-500" aria-hidden />
            <p className="max-w-md text-sm text-slate-600">{errorCarga}</p>
            <Boton variante="secundario" onClick={() => setRecargas(n => n + 1)}>Reintentar</Boton>
          </div>
        ) : !ordenes ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => <TarjetaEsqueleto key={i} />)}
          </div>
        ) : coincidencias.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              {consulta ? <SearchX className="h-6 w-6" aria-hidden /> : <Inbox className="h-6 w-6" aria-hidden />}
            </span>
            <p className="font-medium text-slate-900">
              {consulta ? `Sin resultados para "${consulta}"` : SIN_ORDENES[pestana].titulo}
            </p>
            <p className="text-sm text-slate-500">
              {consulta ? 'Prueba con el número de orden o el nombre del cliente.' : SIN_ORDENES[pestana].texto}
            </p>
          </div>
        ) : (
          <>
            {/* items-start: abrir el detalle de una tarjeta no estira a su vecina */}
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {visibles.map(orden => (
                <TarjetaOrden
                  key={orden.id}
                  orden={orden}
                  enCurso={pestana === 'pendientes'}
                  aprobando={aprobando === orden.id}
                  descargando={descargando === orden.id}
                  onAprobar={() => aprobar(orden)}
                  onRechazar={() => setRechazo({ abierto: true, orden })}
                  onNota={() => descargarNota(orden)}
                />
              ))}
            </div>
            {coincidencias.length > visibles.length && (
              <div className="mt-5 text-center">
                <Boton variante="secundario" onClick={() => setLimite(n => n + TANDA)}>
                  Mostrar {Math.min(TANDA, coincidencias.length - visibles.length)} más de {numero(coincidencias.length)}
                </Boton>
              </div>
            )}
          </>
        )}
      </section>

      <ModalRechazo
        abierto={rechazo.abierto}
        onCerrar={() => setRechazo(actual => ({ ...actual, abierto: false }))}
        tipo="rechazado"
        referencia={rechazo.orden ? `Orden #${numeroOrden(rechazo.orden.id)} · ${rechazo.orden.clientes?.nombre ?? 'Cliente sin nombre'} · ${usd(rechazo.orden.total_usd)}` : ''}
        onConfirmar={confirmarRechazo}
      />
    </div>
  )
}

function TarjetaOrden({ orden, enCurso, aprobando, descargando, onAprobar, onRechazar, onNota }: {
  orden: OrdenAdmin
  enCurso: boolean
  aprobando: boolean
  descargando: boolean
  onAprobar: () => void
  onRechazar: () => void
  onNota: () => void
}) {
  const items = orden.orden_items ?? []
  const unidades = items.reduce((suma, item) => suma + Number(item.cantidad || 0), 0)
  const credito = orden.modalidad_pago === 'Crédito'
  // El POS crea las órdenes ya aprobadas: "Aprobar" solo tiene efecto en las que siguen pendientes
  const porAprobar = enCurso && normalizarEstado(orden.estado) !== 'aprobado'
  const rechazada = estaAnulada(orden.estado)

  return (
    <article className="flex flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
      <div className="flex items-start justify-between gap-4 p-5 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-900">#{numeroOrden(orden.id)}</span>
            <InsigniaEstado estado={orden.estado} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {fechaHora(orden.fecha_creacion || orden.creado_en || '')} · {orden.usuarios?.nombre ?? 'Sin vendedor'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-xl font-semibold tracking-tight text-slate-900">{usd(orden.total_usd)}</p>
          {Number(orden.total_bs) > 0 && <p className="text-xs text-slate-500">Bs. {Number(orden.total_bs).toFixed(2)}</p>}
        </div>
      </div>

      <div className="px-5 pb-5">
        <p className="font-medium text-slate-900">{orden.clientes?.nombre ?? 'Cliente sin nombre'}</p>
        <p className="font-mono text-xs text-slate-500">{orden.clientes?.cedula_rif ?? 'Sin RIF'}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Etiqueta>{orden.metodo_pago}</Etiqueta>
          <Etiqueta resaltada={credito}>{credito ? `Crédito · ${orden.dias_credito ?? 0} días` : 'Contado'}</Etiqueta>
          {orden.condicion_entrega && <Etiqueta>{orden.condicion_entrega}</Etiqueta>}
          {Number(orden.porcentaje_descuento) > 0 && <Etiqueta>Descuento {orden.porcentaje_descuento}%</Etiqueta>}
        </div>

        {rechazada && orden.motivo_rechazo && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <span><span className="font-medium">Motivo del rechazo:</span> {orden.motivo_rechazo}</span>
          </p>
        )}

        <details className="group mt-4 rounded-xl ring-1 ring-slate-200">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <PackageOpen className="h-4 w-4 text-slate-400" aria-hidden />
              {plural(items.length, 'producto', 'productos')} · {plural(unidades, 'unidad', 'unidades')}
            </span>
            <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {items.map((item, i) => {
              const imagen = item.productos?.imagenes?.[0]
              return (
                <li key={`${item.producto_id}-${i}`} className="flex items-center gap-3 px-3.5 py-2.5">
                  {imagen ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imagen} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg bg-slate-50 object-contain ring-1 ring-slate-200" />
                  ) : (
                    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-400">N/A</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{item.productos?.nombre || 'Producto desconocido'}</p>
                    <p className="font-mono text-[11px] text-slate-500">{item.productos?.sku || 'Sin SKU'}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p className="font-medium tabular-nums text-slate-900">{usd(item.cantidad * Number(item.precio_unitario_usd || 0))}</p>
                    <p className="text-xs tabular-nums text-slate-500">{item.cantidad} × {usd(item.precio_unitario_usd)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </details>
      </div>

      {/* Una orden rechazada ya no tiene acciones ni nota de entrega */}
      {!rechazada && (
        <footer className="mt-auto flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <Boton variante="fantasma" tamano="sm" icono={FileDown} cargando={descargando} onClick={onNota}>
            Nota de entrega
          </Boton>
          {enCurso && (
            <div className="ml-auto flex gap-2">
              <Boton variante="peligroSuave" tamano="sm" icono={XCircle} onClick={onRechazar}>
                Rechazar
              </Boton>
              {porAprobar && (
                <Boton tamano="sm" icono={CheckCircle2} cargando={aprobando} onClick={onAprobar}>
                  Aprobar
                </Boton>
              )}
            </div>
          )}
        </footer>
      )}
    </article>
  )
}

function Etiqueta({ children, resaltada = false }: { children: React.ReactNode; resaltada?: boolean }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${resaltada ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
      {children}
    </span>
  )
}

function TarjetaEsqueleto() {
  return (
    <div aria-hidden className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
      <div className="flex justify-between">
        <div className="space-y-2">
          <Bloque className="h-4 w-40" />
          <Bloque className="h-3 w-56" />
        </div>
        <Bloque className="h-7 w-24" />
      </div>
      <Bloque className="mt-5 h-4 w-48" />
      <div className="mt-3 flex gap-2">
        <Bloque className="h-5 w-20" />
        <Bloque className="h-5 w-24" />
      </div>
      <Bloque className="mt-4 h-10 w-full rounded-xl" />
      <div className="mt-4 flex justify-end gap-2">
        <Bloque className="h-8 w-24" />
        <Bloque className="h-8 w-24" />
      </div>
    </div>
  )
}
