'use client'

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BadgeCheck, CheckCircle2, ChevronDown, CircleX, Clock, FileDown, MapPin, Phone, Search, SearchX, Wallet, X, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listarCuentasPorCobrar, marcarOrdenPagada, type OrdenAdmin } from '@/lib/services/ordenes'
import { DIAS_AVISO_VENCIMIENTO, estadoCredito, type TramoCartera } from '@/lib/domain/analyticsUtils'
import { textoBuscable } from '@/lib/domain/clientes'
import { descargarNotaEntrega } from '@/lib/pdf/notaEntrega'
import { fechaCorta, numeroOrden, plural, usd } from '@/lib/formato'
import Boton from '@/components/ui/Boton'
import { claseEntrada } from '@/components/ui/Campo'
import { Bloque } from '@/components/ui/Esqueleto'
import { useToast } from '@/components/ui/Toast'
import { useConfirmacion } from '@/components/ui/Confirmacion'

// Semáforo: siempre icono + texto. Verde, ámbar y rojo se validaron como vecinos para daltonismo
const TRAMOS: Record<TramoCartera, { etiqueta: string; descripcion: string; icono: LucideIcon; barra: string; tinta: string; chip: string }> = {
  vencido: { etiqueta: 'Vencido', descripcion: 'Ya pasó el plazo', icono: AlertTriangle, barra: 'bg-red-600', tinta: 'text-red-600', chip: 'bg-red-50 ring-red-200' },
  porVencer: { etiqueta: 'Por vencer', descripcion: `Vence en ${DIAS_AVISO_VENCIMIENTO} días o menos`, icono: Clock, barra: 'bg-amber-500', tinta: 'text-amber-600', chip: 'bg-amber-50 ring-amber-200' },
  alDia: { etiqueta: 'Al día', descripcion: `Vence en más de ${DIAS_AVISO_VENCIMIENTO} días`, icono: CheckCircle2, barra: 'bg-emerald-600', tinta: 'text-emerald-600', chip: 'bg-emerald-50 ring-emerald-200' },
}
const ORDEN_TRAMOS: TramoCartera[] = ['vencido', 'porVencer', 'alDia']

interface Credito {
  orden: OrdenAdmin
  vencimiento: number
  diasRestantes: number
  tramo: TramoCartera
  saldoUSD: number
}

function coincideCredito({ orden }: Credito, consulta: string) {
  const texto = textoBuscable(consulta).trim()
  if (!texto) return true
  return [numeroOrden(orden.id), orden.clientes?.nombre, orden.clientes?.cedula_rif, orden.clientes?.telefono]
    .some(campo => textoBuscable(campo).includes(texto))
}

export default function CuentasPorCobrar() {
  const [supabase] = useState(() => createClient())
  const toast = useToast()
  const confirmar = useConfirmacion()

  // El "ahora" del semáforo es el momento de la carga, para que todos los créditos se midan igual
  const [carga, setCarga] = useState<{ ordenes: OrdenAdmin[]; obtenidoEn: number } | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [recargas, setRecargas] = useState(0)
  const [filtro, setFiltro] = useState<TramoCartera | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const consulta = useDeferredValue(busqueda)
  const [descargando, setDescargando] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    const cargar = () => listarCuentasPorCobrar(supabase).then(resultado => {
      if (!vigente) return
      if (resultado.ok) {
        setCarga({ ordenes: resultado.datos, obtenidoEn: Date.now() })
        setErrorCarga(null)
      } else {
        setErrorCarga(resultado.error)
      }
    })
    cargar()
    const canal = supabase
      .channel('ordenes-admin-cobranza')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, cargar)
      .subscribe()
    return () => {
      vigente = false
      supabase.removeChannel(canal)
    }
  }, [supabase, recargas])

  // Lo más urgente primero
  const creditos = useMemo<Credito[]>(() => {
    if (!carga) return []
    return carga.ordenes
      .map(orden => ({ orden, ...estadoCredito(orden, carga.obtenidoEn) }))
      .sort((a, b) => a.diasRestantes - b.diasRestantes)
  }, [carga])

  const resumen = useMemo(() => {
    const porTramo = Object.fromEntries(ORDEN_TRAMOS.map(t => [t, { creditos: 0, saldoUSD: 0 }])) as Record<TramoCartera, { creditos: number; saldoUSD: number }>
    for (const credito of creditos) {
      porTramo[credito.tramo].creditos++
      porTramo[credito.tramo].saldoUSD += credito.saldoUSD
    }
    return porTramo
  }, [creditos])
  const saldoTotal = ORDEN_TRAMOS.reduce((suma, t) => suma + resumen[t].saldoUSD, 0)
  const coincidencias = creditos.filter(c => (!filtro || c.tramo === filtro) && coincideCredito(c, consulta))

  const marcarPagada = async ({ orden, saldoUSD }: Credito) => {
    const cliente = orden.clientes?.nombre ?? 'el cliente'
    const confirmado = await confirmar({
      titulo: `¿Registrar el pago de ${cliente}?`,
      descripcion: `La orden #${numeroOrden(orden.id)} (saldo de ${usd(saldoUSD)}) pasará a Pagada y saldrá de las cuentas por cobrar.`,
      confirmar: 'Marcar como pagada',
    })
    if (!confirmado) return
    // Como antes: sale de la lista al instante y, si el cambio falla, se recarga
    setCarga(actual => actual && { ...actual, ordenes: actual.ordenes.filter(o => o.id !== orden.id) })
    const resultado = await marcarOrdenPagada(supabase, orden.id)
    if (!resultado.ok) {
      setRecargas(n => n + 1)
      toast.error('No se pudo marcar como pagada', { descripcion: resultado.error })
      return
    }
    toast.exito(`Orden #${numeroOrden(orden.id)} pagada`, { descripcion: `${cliente} · ${usd(saldoUSD)}` })
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

  return (
    <div className="mx-auto w-full max-w-7xl p-6 md:p-8">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
          <Wallet className="h-6 w-6 text-indigo-600" aria-hidden />
          Cuentas por cobrar
        </h2>
        <p className="text-sm text-slate-500">Créditos con saldo pendiente, del más urgente al más holgado.</p>
      </header>

      {!carga && errorCarga ? (
        <div role="alert" className="mt-6 flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
          <CircleX className="h-8 w-8 text-red-500" aria-hidden />
          <p className="max-w-md text-sm text-slate-600">{errorCarga}</p>
          <Boton variante="secundario" onClick={() => setRecargas(n => n + 1)}>Reintentar</Boton>
        </div>
      ) : !carga ? (
        <Esqueleto />
      ) : creditos.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <BadgeCheck className="h-6 w-6" aria-hidden />
          </span>
          <p className="font-medium text-slate-900">No hay créditos pendientes de cobro</p>
          <p className="text-sm text-slate-500">Las ventas a crédito aparecerán aquí hasta que se marquen como pagadas.</p>
        </div>
      ) : (
        <>
          {resumen.vencido.creditos > 0 && (
            <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
              <p>
                <span className="font-semibold">{usd(resumen.vencido.saldoUSD)} vencidos</span> en {plural(resumen.vencido.creditos, 'crédito', 'créditos')}.
                Prioriza la cobranza de los marcados en rojo.
              </p>
            </div>
          )}

          {/* Cada tramo filtra la lista; pulsarlo de nuevo vuelve a mostrar todo */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3" role="group" aria-label="Filtrar por estado del crédito">
            {ORDEN_TRAMOS.map(tramo => {
              const estilo = TRAMOS[tramo]
              const Icono = estilo.icono
              const activo = filtro === tramo
              return (
                <button
                  key={tramo}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setFiltro(activo ? null : tramo)}
                  className={`relative overflow-hidden rounded-2xl bg-white p-4 pl-5 text-left shadow-sm ring-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${activo ? 'ring-2 ring-indigo-500' : 'ring-slate-200/80 hover:ring-slate-300'}`}
                >
                  <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${estilo.barra}`} />
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <Icono className={`h-4 w-4 ${estilo.tinta}`} aria-hidden />
                    {estilo.etiqueta}
                  </span>
                  <span className="mt-2 block text-xl font-semibold tracking-tight text-slate-900">{usd(resumen[tramo].saldoUSD)}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{plural(resumen[tramo].creditos, 'crédito', 'créditos')} · {estilo.descripcion.toLowerCase()}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Saldo total por cobrar: <span className="font-semibold text-slate-900">{usd(saldoTotal)}</span>
              {filtro && (
                <>
                  {' · '}mostrando <span className="font-medium">{TRAMOS[filtro].etiqueta.toLowerCase()}</span>{' '}
                  <button type="button" onClick={() => setFiltro(null)} className="font-medium text-indigo-600 hover:text-indigo-500">ver todos</button>
                </>
              )}
            </p>
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                aria-label="Buscar créditos"
                placeholder="Cliente, RIF, teléfono u orden"
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
          </div>

          {coincidencias.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-slate-200">
              <SearchX className="h-7 w-7 text-slate-400" aria-hidden />
              <p className="text-sm text-slate-600">Ningún crédito coincide con la búsqueda o el filtro.</p>
            </div>
          ) : (
            <div className="mt-4 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {coincidencias.map(credito => (
                <TarjetaCredito
                  key={credito.orden.id}
                  credito={credito}
                  descargando={descargando === credito.orden.id}
                  onPagada={() => marcarPagada(credito)}
                  onNota={() => descargarNota(credito.orden)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TarjetaCredito({ credito, descargando, onPagada, onNota }: {
  credito: Credito
  descargando: boolean
  onPagada: () => void
  onNota: () => void
}) {
  const { orden, tramo, diasRestantes, vencimiento, saldoUSD } = credito
  const estilo = TRAMOS[tramo]
  const Icono = estilo.icono
  const items = orden.orden_items ?? []
  const telefono = orden.clientes?.telefono ? String(orden.clientes.telefono) : null
  const plazo = tramo === 'vencido'
    ? `Vencido hace ${plural(-diasRestantes, 'día', 'días')}`
    : diasRestantes === 0 ? 'Vence hoy' : `Vence en ${plural(diasRestantes, 'día', 'días')}`

  return (
    <article className="relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${estilo.barra}`} />
      <div className="flex-1 p-5 pl-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{orden.clientes?.nombre ?? 'Cliente sin nombre'}</p>
            <p className="font-mono text-xs text-slate-500">{orden.clientes?.cedula_rif ?? 'Sin RIF'}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ${estilo.chip}`}>
            <Icono className={`h-3.5 w-3.5 ${estilo.tinta}`} aria-hidden />
            {plazo}
          </span>
        </div>

        <p className="mt-4 text-xs text-slate-500">Saldo por cobrar</p>
        <p className="text-2xl font-semibold tracking-tight text-slate-900">{usd(saldoUSD)}</p>
        <p className="text-xs text-slate-500">
          de {usd(orden.total_usd)}{Number(orden.inicial_monto) > 0 && ` · inicial ${usd(orden.inicial_monto)}`}
        </p>

        <dl className="mt-4 space-y-1.5 text-xs text-slate-600">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Orden</dt>
            <dd className="font-mono font-medium text-slate-800">#{numeroOrden(orden.id)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Vencimiento</dt>
            <dd className="font-medium text-slate-800">{fechaCorta(vencimiento)} · {orden.dias_credito ?? 0} días de crédito</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Teléfono</dt>
            <dd>
              {telefono ? (
                <a href={`tel:${telefono.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500">
                  <Phone className="h-3 w-3" aria-hidden />
                  {telefono}
                </a>
              ) : (
                <span className="text-slate-400">No registrado</span>
              )}
            </dd>
          </div>
          {(orden.direccion_envio || orden.clientes?.direccion) && (
            <div className="flex items-start gap-1.5 pt-1 text-slate-500">
              <MapPin className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{orden.direccion_envio || orden.clientes?.direccion}</span>
            </div>
          )}
        </dl>

        <details className="group mt-4 rounded-xl ring-1 ring-slate-200">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
            Desglose · {plural(items.length, 'producto', 'productos')}
            <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100 text-xs">
            {items.map((item, i) => (
              <li key={`${item.producto_id}-${i}`} className="flex justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-slate-700">
                  <span className="font-semibold">{item.cantidad}×</span> {item.productos?.nombre || 'Producto'}
                </span>
                <span className="shrink-0 tabular-nums text-slate-900">{usd(item.cantidad * Number(item.precio_unitario_usd || 0))}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <footer className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 pl-6">
        <Boton variante="fantasma" tamano="sm" icono={FileDown} cargando={descargando} onClick={onNota}>Nota</Boton>
        <Boton tamano="sm" icono={BadgeCheck} onClick={onPagada} className="ml-auto">Marcar como pagada</Boton>
      </footer>
    </article>
  )
}

function Esqueleto() {
  return (
    <div aria-hidden className="mt-6 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80">
            <Bloque className="h-3 w-20" />
            <Bloque className="mt-3 h-6 w-28" />
            <Bloque className="mt-2 h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/80">
            <Bloque className="h-4 w-40" />
            <Bloque className="mt-4 h-7 w-32" />
            <Bloque className="mt-4 h-3 w-full" />
            <Bloque className="mt-2 h-3 w-full" />
            <Bloque className="mt-4 h-9 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}
