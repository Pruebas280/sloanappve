'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CalendarRange, Check, CheckCircle2, Clock, LineChart, Package, PackageX, Percent, Phone,
  Receipt, RefreshCw, ShoppingBag, Table2, TrendingUp, Trophy, Users, Wallet, XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  getAnalyticsInventario,
  getAnalyticsOrdenes,
  getCarteraCredito,
  type ResultadoConsulta,
} from '@/lib/services/analytics'
import {
  calcularAgingCartera,
  calcularMetricasResumen,
  calcularResumenInventario,
  calcularTendencia,
  calcularTopProductos,
  calcularVentasPorVendedor,
  DIAS_AVISO_VENCIMIENTO,
  diasDelRango,
  esFechaValida,
  fechaNegocio,
  rangoPredefinido,
  UMBRAL_STOCK_BAJO,
  type AgingCartera,
  type DeudorPrincipal,
  type Granularidad,
  type MetricasResumen,
  type OrdenAnalitica,
  type PresetRango,
  type ProductoDestacado,
  type ProductoInventario,
  type PuntoTendencia,
  type RendimientoVendedor,
  type ResumenInventario,
  type TramoCartera,
} from '@/lib/domain/analyticsUtils'

// ============================================================================
// FORMATOS
// ============================================================================
const formatoUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const formatoUSDCompacto = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const formatoEjeEntero = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const formatoEjeDecimal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const formatoNumero = new Intl.NumberFormat('en-US')
const formatoBs = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Las fechas 'YYYY-MM-DD' se leen como medianoche UTC, por eso se formatean en UTC
const formatoDiaCorto = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const formatoDiaConAnio = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatoDiaLargo = new Intl.DateTimeFormat('es-VE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const formatoMes = new Intl.DateTimeFormat('es-VE', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatoHora = new Intl.DateTimeFormat('es-VE', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Caracas' })

const usd = (valor: number) => formatoUSD.format(valor)
/** En tarjetas: completo hasta un millón y compacto ($1.2M) a partir de ahí */
const usdTarjeta = (valor: number) => (Math.abs(valor) >= 1_000_000 ? formatoUSDCompacto : formatoUSD).format(valor)
const porcentaje = (razon: number) => `${(razon * 100).toFixed(razon > 0 && razon < 0.1 ? 1 : 0)}%`
const plural = (n: number, singular: string, varios: string) => `${formatoNumero.format(n)} ${n === 1 ? singular : varios}`

/** Etiqueta de un punto de la tendencia; la versión larga ("Jueves, 30 de octubre") va en tooltip y tabla */
function etiquetaPunto(clave: string, granularidad: Granularidad, larga = false) {
  const texto = granularidad === 'mes'
    ? formatoMes.format(Date.parse(`${clave}-01`))
    : (larga ? formatoDiaLargo : formatoDiaCorto).format(Date.parse(clave))
  return larga ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto
}

function describirRango({ desde, hasta }: Rango) {
  if (desde === hasta) return formatoDiaConAnio.format(Date.parse(desde))
  return `${formatoDiaCorto.format(Date.parse(desde))} – ${formatoDiaConAnio.format(Date.parse(hasta))} · ${plural(diasDelRango(desde, hasta), 'día', 'días')}`
}

// ============================================================================
// COLORES DE ESTADO
// Siempre van con su etiqueta: el color nunca es el único indicio. Verde, ámbar y rojo se
// validaron como vecinos para daltonismo (protanopia y deuteranopia) sobre fondo blanco.
// ============================================================================
const TRAMOS: Record<TramoCartera, { etiqueta: string; descripcion: string; icono: LucideIcon; relleno: string; tinta: string; chip: string }> = {
  alDia: {
    etiqueta: 'Al día',
    descripcion: `Vencen en más de ${DIAS_AVISO_VENCIMIENTO} días`,
    icono: CheckCircle2,
    relleno: 'bg-emerald-600',
    tinta: 'text-emerald-600',
    chip: 'bg-emerald-50 ring-emerald-200',
  },
  porVencer: {
    etiqueta: 'Por vencer',
    descripcion: `Vencen en ${DIAS_AVISO_VENCIMIENTO} días o menos`,
    icono: Clock,
    relleno: 'bg-amber-500',
    tinta: 'text-amber-600',
    chip: 'bg-amber-50 ring-amber-200',
  },
  vencido: {
    etiqueta: 'Vencido',
    descripcion: 'Ya pasó el plazo de crédito',
    icono: AlertTriangle,
    relleno: 'bg-red-600',
    tinta: 'text-red-600',
    chip: 'bg-red-50 ring-red-200',
  },
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
type Rango = { desde: string; hasta: string }
type Seleccion = Rango & { preset: PresetRango | null }

interface CargaPeriodo {
  clave: string
  rango: Rango
  obtenidoEn: number
  resultado: ResultadoConsulta<OrdenAnalitica[]>
}

interface CargaSituacion {
  clave: number
  obtenidoEn: number
  cartera: ResultadoConsulta<OrdenAnalitica[]>
  inventario: ResultadoConsulta<ProductoInventario[]>
}

const PRESETS: { id: PresetRango; etiqueta: string }[] = [
  { id: 'hoy', etiqueta: 'Hoy' },
  { id: '7d', etiqueta: '7 días' },
  { id: '30d', etiqueta: '30 días' },
  { id: '90d', etiqueta: '90 días' },
  { id: 'mes', etiqueta: 'Este mes' },
  { id: 'anio', etiqueta: 'Este año' },
]

/** Al escribir una fecha a mano cada tecla cambia el valor: se espera a que el usuario termine */
const ESPERA_FECHA_MANUAL_MS = 500

// Mientras se teclea el año aparecen valores como 0002-10-30; solo se consulta con una fecha creíble
const esFechaConsultable = (fecha: string) => esFechaValida(fecha) && fecha >= '2000-01-01'

export default function ExecutiveDashboard() {
  const [supabase] = useState(() => createClient())
  const [seleccion, setSeleccion] = useState<Seleccion>(() => ({ preset: '30d', ...rangoPredefinido('30d', fechaNegocio(Date.now())) }))
  const [borrador, setBorrador] = useState<Rango>({ desde: seleccion.desde, hasta: seleccion.hasta })
  const [recargas, setRecargas] = useState(0)
  const [periodo, setPeriodo] = useState<CargaPeriodo | null>(null)
  const [situacion, setSituacion] = useState<CargaSituacion | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { desde, hasta } = seleccion
  const clavePeriodo = `${desde}|${hasta}|${recargas}`

  // Órdenes del rango elegido. Si el rango cambia antes de que termine la lectura, se cancela
  useEffect(() => {
    const control = new AbortController()
    getAnalyticsOrdenes(supabase, desde, hasta, { signal: control.signal }).then(resultado => {
      if (!control.signal.aborted) setPeriodo({ clave: clavePeriodo, rango: { desde, hasta }, obtenidoEn: Date.now(), resultado })
    })
    return () => control.abort()
  }, [supabase, desde, hasta, clavePeriodo])

  // Cartera e inventario son la situación de hoy: no dependen del rango
  useEffect(() => {
    const control = new AbortController()
    Promise.all([
      getCarteraCredito(supabase, { signal: control.signal }),
      getAnalyticsInventario(supabase, { signal: control.signal }),
    ]).then(([cartera, inventario]) => {
      if (!control.signal.aborted) setSituacion({ clave: recargas, obtenidoEn: Date.now(), cartera, inventario })
    })
    return () => control.abort()
  }, [supabase, recargas])

  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current)
  }, [])

  const elegirPreset = (preset: PresetRango) => {
    if (temporizador.current) clearTimeout(temporizador.current)
    const rango = rangoPredefinido(preset, fechaNegocio(Date.now()))
    setBorrador(rango)
    setSeleccion({ preset, ...rango })
  }

  const cambiarFecha = (campo: keyof Rango, valor: string) => {
    const siguiente = { ...borrador, [campo]: valor }
    setBorrador(siguiente)
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      if (!esFechaConsultable(siguiente.desde) || !esFechaConsultable(siguiente.hasta)) return
      const rango = siguiente.desde <= siguiente.hasta ? siguiente : { desde: siguiente.hasta, hasta: siguiente.desde }
      setBorrador(rango)
      setSeleccion({ preset: null, ...rango })
    }, ESPERA_FECHA_MANUAL_MS)
  }

  const actualizar = () => setRecargas(n => n + 1)

  const cargandoPeriodo = periodo?.clave !== clavePeriodo
  const cargandoSituacion = situacion?.clave !== recargas
  const errorPeriodo = periodo && !periodo.resultado.ok ? periodo.resultado.error : null
  const actualizadoEn = Math.max(periodo?.obtenidoEn ?? 0, situacion?.obtenidoEn ?? 0)

  const analitica = useMemo(() => {
    if (!periodo || !periodo.resultado.ok) return null
    const ordenes = periodo.resultado.datos
    return {
      resumen: calcularMetricasResumen(ordenes),
      tendencia: calcularTendencia(ordenes, periodo.rango.desde, periodo.rango.hasta),
      productos: calcularTopProductos(ordenes, 5),
      vendedores: calcularVentasPorVendedor(ordenes),
    }
  }, [periodo])

  const actual = useMemo(() => {
    if (!situacion) return null
    const { cartera, inventario, obtenidoEn } = situacion
    return {
      aging: cartera.ok ? calcularAgingCartera(cartera.datos, obtenidoEn) : null,
      errorCartera: cartera.ok ? null : cartera.error,
      inventario: inventario.ok ? calcularResumenInventario(inventario.datos) : null,
      errorInventario: inventario.ok ? null : inventario.error,
    }
  }, [situacion])

  // Al recargar se conserva lo anterior atenuado: sin parpadeos ni saltos de diseño
  const atenuar = (cargando: boolean) => `transition-opacity duration-300 ${cargando ? 'opacity-60' : ''}`

  return (
    <section aria-label="Dashboard ejecutivo" className="space-y-6">
      <div>
        <header className="relative overflow-hidden rounded-3xl bg-slate-900 px-5 pb-24 pt-6 text-white shadow-xl shadow-slate-900/10 md:px-8 md:pt-8">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full bg-indigo-600/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">Dashboard ejecutivo</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Rendimiento comercial</h2>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400">
              <CalendarRange className="h-4 w-4" aria-hidden />
              <span>{describirRango(seleccion)}</span>
              {actualizadoEn > 0 && <span>· Actualizado a las {formatoHora.format(actualizadoEn)}</span>}
            </p>
            <FiltroRango
              preset={seleccion.preset}
              borrador={borrador}
              cargando={cargandoPeriodo || cargandoSituacion}
              onPreset={elegirPreset}
              onFecha={cambiarFecha}
              onActualizar={actualizar}
            />
          </div>
        </header>

        <div className="relative -mt-16 px-3 md:px-5">
          {errorPeriodo ? (
            <AvisoError mensaje={errorPeriodo} onReintentar={actualizar} />
          ) : analitica ? (
            <div aria-busy={cargandoPeriodo} className={atenuar(cargandoPeriodo)}>
              <FilaKpi resumen={analitica.resumen} />
            </div>
          ) : (
            <FilaKpiEsqueleto />
          )}
        </div>
      </div>

      {!errorPeriodo && (analitica ? (
        <div aria-busy={cargandoPeriodo} className={`space-y-6 ${atenuar(cargandoPeriodo)}`}>
          <div className="grid gap-6 lg:grid-cols-3">
            <SeccionTendencia className="lg:col-span-2" tendencia={analitica.tendencia} />
            <ResumenEstados resumen={analitica.resumen} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <TopProductos productos={analitica.productos} />
            <RankingVendedores vendedores={analitica.vendedores} />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <TarjetaEsqueleto className="lg:col-span-2" alto="h-64" />
            <TarjetaEsqueleto alto="h-64" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <TarjetaEsqueleto alto="h-56" />
            <TarjetaEsqueleto alto="h-56" />
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Situación actual</h3>
        <span aria-hidden className="h-px min-w-8 flex-1 bg-slate-200" />
        <p className="text-xs text-slate-500">No depende del rango de fechas</p>
      </div>

      {actual ? (
        <div aria-busy={cargandoSituacion} className={`grid gap-6 lg:grid-cols-3 ${atenuar(cargandoSituacion)}`}>
          <SemaforoCartera className="lg:col-span-2" aging={actual.aging} error={actual.errorCartera} onReintentar={actualizar} />
          <PanelInventario inventario={actual.inventario} error={actual.errorInventario} onReintentar={actualizar} />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <TarjetaEsqueleto className="lg:col-span-2" alto="h-72" />
          <TarjetaEsqueleto alto="h-72" />
        </div>
      )}
    </section>
  )
}

// ============================================================================
// FILTRO DE FECHAS
// ============================================================================
function FiltroRango({ preset, borrador, cargando, onPreset, onFecha, onActualizar }: {
  preset: PresetRango | null
  borrador: Rango
  cargando: boolean
  onPreset: (preset: PresetRango) => void
  onFecha: (campo: keyof Rango, valor: string) => void
  onActualizar: () => void
}) {
  return (
    <div className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-3">
      <div role="group" aria-label="Rangos rápidos" className="flex flex-wrap gap-1.5">
        {PRESETS.map(opcion => {
          const activo = preset === opcion.id
          return (
            <button
              key={opcion.id}
              type="button"
              aria-pressed={activo}
              onClick={() => onPreset(opcion.id)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors ${activo ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white'}`}
            >
              {activo && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
              {opcion.etiqueta}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <CampoFecha etiqueta="Desde" valor={borrador.desde} onCambio={valor => onFecha('desde', valor)} />
        <CampoFecha etiqueta="Hasta" valor={borrador.hasta} onCambio={valor => onFecha('hasta', valor)} />
        <button
          type="button"
          onClick={onActualizar}
          disabled={cargando}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition-colors hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-80"
        >
          <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} aria-hidden />
          {cargando ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>
    </div>
  )
}

function CampoFecha({ etiqueta, valor, onCambio }: { etiqueta: string; valor: string; onCambio: (valor: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {etiqueta}
      <input
        type="date"
        value={valor}
        onChange={e => onCambio(e.target.value)}
        className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium normal-case tracking-normal text-white outline-none transition-colors [color-scheme:dark] hover:border-white/20 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
      />
    </label>
  )
}

// ============================================================================
// KPIs
// ============================================================================
function FilaKpi({ resumen }: { resumen: MetricasResumen }) {
  const detalleVentas = `${plural(resumen.ordenesValidas, 'venta válida', 'ventas válidas')}${resumen.ventasBs > 0 ? ` · Bs. ${formatoBs.format(resumen.ventasBs)}` : ''}`
  return (
    <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
      <TarjetaKpi
        destacada
        className="sm:col-span-3 xl:col-span-2"
        icono={Wallet}
        etiqueta="Ventas netas"
        valor={usdTarjeta(resumen.ventasUSD)}
        detalle={detalleVentas}
      />
      <TarjetaKpi icono={Receipt} etiqueta="Ticket promedio" valor={usd(resumen.ticketPromedioUSD)} detalle="Por venta válida" />
      <TarjetaKpi
        icono={ShoppingBag}
        etiqueta="Total órdenes"
        valor={formatoNumero.format(resumen.ordenesRegistradas)}
        detalle={`${formatoNumero.format(resumen.ordenesValidas)} válidas · ${formatoNumero.format(resumen.ordenesPendientes)} pendientes`}
      />
      <TarjetaKpi
        icono={Percent}
        etiqueta="Tasa de rechazos"
        valor={porcentaje(resumen.tasaRechazo)}
        detalle={`${plural(resumen.rechazadas, 'rechazada', 'rechazadas')} · ${usd(resumen.montoRechazadoUSD)}`}
      />
    </div>
  )
}

function TarjetaKpi({ icono: Icono, etiqueta, valor, detalle, destacada = false, className = '' }: {
  icono: LucideIcon
  etiqueta: string
  valor: string
  detalle: string
  destacada?: boolean
  className?: string
}) {
  return (
    <div className={`min-w-0 rounded-2xl bg-white p-5 shadow-lg shadow-slate-900/5 ring-1 ring-slate-200/80 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{etiqueta}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${destacada ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100'}`}>
          <Icono className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className={`mt-3 font-semibold tracking-tight text-slate-900 ${destacada ? 'text-4xl md:text-5xl' : 'text-2xl'}`}>{valor}</p>
      <p className="mt-2 text-xs text-slate-500">{detalle}</p>
    </div>
  )
}

// ============================================================================
// TENDENCIA
// ============================================================================
const ALTO_GRAFICO = 260
const MARGEN = { arriba: 12, derecha: 8, abajo: 28, izquierda: 60 }

function SeccionTendencia({ tendencia, className = '' }: {
  tendencia: { granularidad: Granularidad; puntos: PuntoTendencia[] }
  className?: string
}) {
  const [verTabla, setVerTabla] = useState(false)
  const { granularidad, puntos } = tendencia
  const hayVentas = puntos.some(p => p.ventasUSD > 0)
  const conGrafico = hayVentas && puntos.length > 1

  return (
    <Tarjeta
      className={className}
      icono={TrendingUp}
      titulo="Tendencia de ventas"
      descripcion={`Ventas válidas por ${granularidad === 'dia' ? 'día' : 'mes'}, en USD`}
      accion={conGrafico && (
        <button
          type="button"
          onClick={() => setVerTabla(v => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
        >
          {verTabla ? <LineChart className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
          {verTabla ? 'Ver gráfico' : 'Ver tabla'}
        </button>
      )}
    >
      {!hayVentas ? (
        <EstadoVacio icono={TrendingUp} mensaje="No hubo ventas válidas en este período." />
      ) : puntos.length === 1 ? (
        <PuntoUnico punto={puntos[0]} granularidad={granularidad} />
      ) : verTabla ? (
        <TablaTendencia puntos={puntos} granularidad={granularidad} />
      ) : (
        <GraficoTendencia puntos={puntos} granularidad={granularidad} />
      )}
    </Tarjeta>
  )
}

function GraficoTendencia({ puntos, granularidad }: { puntos: PuntoTendencia[]; granularidad: Granularidad }) {
  const contenedor = useRef<HTMLDivElement>(null)
  const ancho = useAnchoDe(contenedor)
  const [activo, setActivo] = useState<number | null>(null)

  const escala = escalaLimpia(Math.max(...puntos.map(p => p.ventasUSD)))
  const anchoPlot = Math.max(0, ancho - MARGEN.izquierda - MARGEN.derecha)
  const altoPlot = ALTO_GRAFICO - MARGEN.arriba - MARGEN.abajo
  const ultimo = puntos.length - 1
  const x = (i: number) => MARGEN.izquierda + (i * anchoPlot) / ultimo
  const y = (valor: number) => MARGEN.arriba + altoPlot * (1 - valor / escala.tope)
  const base = y(0)
  const trazo = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.ventasUSD).toFixed(1)}`).join(' ')
  const relleno = `${trazo} L${x(ultimo).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`
  // Una fecha cada ~80px para que las etiquetas no se encimen
  const cadaCuanto = Math.max(1, Math.ceil(puntos.length / Math.max(1, Math.floor(anchoPlot / 80))))
  const punto = activo === null ? null : puntos[activo]

  const elegirPorPosicion = (clientX: number, caja: DOMRect) => {
    const relativo = (clientX - caja.left) / caja.width
    setActivo(Math.min(ultimo, Math.max(0, Math.round(relativo * ultimo))))
  }

  const moverConTeclado = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = e
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
    e.preventDefault()
    setActivo(actual => {
      if (key === 'Home') return 0
      if (key === 'End') return ultimo
      const desde = actual ?? ultimo
      return Math.min(ultimo, Math.max(0, desde + (key === 'ArrowRight' ? 1 : -1)))
    })
  }

  const lectura = punto ? `${etiquetaPunto(punto.clave, granularidad, true)}: ${usd(punto.ventasUSD)}, ${plural(punto.ordenesValidas, 'venta válida', 'ventas válidas')}` : ''

  return (
    <figure className="m-0">
      <div
        ref={contenedor}
        tabIndex={0}
        onKeyDown={moverConTeclado}
        onFocus={() => setActivo(a => a ?? ultimo)}
        onBlur={() => setActivo(null)}
        aria-label={`Ventas válidas por ${granularidad === 'dia' ? 'día' : 'mes'}. Usa las flechas para recorrer el gráfico.`}
        className="relative rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-4"
        style={{ height: ALTO_GRAFICO }}
      >
        {ancho > 0 && (
          <svg width={ancho} height={ALTO_GRAFICO} className="overflow-visible" aria-hidden>
            {escala.marcas.map(marca => (
              <g key={marca}>
                <line
                  x1={MARGEN.izquierda}
                  x2={ancho - MARGEN.derecha}
                  y1={Math.round(y(marca)) + 0.5}
                  y2={Math.round(y(marca)) + 0.5}
                  className={marca === 0 ? 'stroke-slate-300' : 'stroke-slate-200'}
                  strokeWidth={1}
                />
                <text x={MARGEN.izquierda - 10} y={y(marca)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
                  {formatoEje(marca, escala)}
                </text>
              </g>
            ))}
            {puntos.map((p, i) => i % cadaCuanto === 0 && (
              <text key={p.clave} x={x(i)} y={ALTO_GRAFICO - 6} textAnchor={i === 0 ? 'start' : 'middle'} className="fill-slate-500 text-[11px]">
                {etiquetaPunto(p.clave, granularidad)}
              </text>
            ))}
            <path d={relleno} className="fill-indigo-600/10" />
            <path d={trazo} fill="none" className="stroke-indigo-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {punto && activo !== null && (
              <g>
                <line x1={Math.round(x(activo)) + 0.5} x2={Math.round(x(activo)) + 0.5} y1={MARGEN.arriba} y2={base} className="stroke-slate-400" strokeWidth={1} />
                <circle cx={x(activo)} cy={y(punto.ventasUSD)} r={4.5} className="fill-indigo-600 stroke-white" strokeWidth={2} />
              </g>
            )}
            <rect
              x={MARGEN.izquierda}
              y={MARGEN.arriba}
              width={anchoPlot}
              height={altoPlot}
              fill="transparent"
              onPointerMove={e => elegirPorPosicion(e.clientX, e.currentTarget.getBoundingClientRect())}
              onPointerLeave={() => setActivo(null)}
            />
          </svg>
        )}
        {punto && activo !== null && ancho > 0 && (
          <Burbuja
            izquierda={x(activo)}
            arriba={y(punto.ventasUSD)}
            anchoTotal={ancho}
            valor={usd(punto.ventasUSD)}
            detalle={`${etiquetaPunto(punto.clave, granularidad, true)} · ${plural(punto.ordenesValidas, 'venta', 'ventas')}`}
          />
        )}
      </div>
      <figcaption className="sr-only" aria-live="polite">{lectura}</figcaption>
    </figure>
  )
}

function Burbuja({ izquierda, arriba, anchoTotal, valor, detalle }: {
  izquierda: number
  arriba: number
  anchoTotal: number
  valor: string
  detalle: string
}) {
  // Cerca de los bordes la burbuja se alinea hacia adentro; muy arriba, se muestra debajo del punto
  const horizontal = izquierda < 110 ? 'translate-x-0' : izquierda > anchoTotal - 110 ? '-translate-x-full' : '-translate-x-1/2'
  const debajo = arriba < 70
  return (
    <div
      role="tooltip"
      className={`pointer-events-none absolute z-10 rounded-xl bg-slate-900 px-3 py-2 shadow-lg ${horizontal} ${debajo ? '' : '-translate-y-full'}`}
      style={{ left: izquierda, top: debajo ? arriba + 14 : arriba - 14 }}
    >
      <p className="text-sm font-semibold text-white">{valor}</p>
      <p className="whitespace-nowrap text-xs text-slate-300">{detalle}</p>
    </div>
  )
}

function TablaTendencia({ puntos, granularidad }: { puntos: PuntoTendencia[]; granularidad: Granularidad }) {
  return (
    <div className="overflow-y-auto rounded-xl ring-1 ring-slate-200" style={{ maxHeight: ALTO_GRAFICO }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left">{granularidad === 'dia' ? 'Día' : 'Mes'}</th>
            <th scope="col" className="px-4 py-2.5 text-right">Ventas válidas</th>
            <th scope="col" className="px-4 py-2.5 text-right">Monto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {puntos.map(p => (
            <tr key={p.clave}>
              <td className="px-4 py-2 text-slate-700">{etiquetaPunto(p.clave, granularidad, true)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatoNumero.format(p.ordenesValidas)}</td>
              <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">{usd(p.ventasUSD)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Un solo día no es una tendencia: se muestra la cifra */
function PuntoUnico({ punto, granularidad }: { punto: PuntoTendencia; granularidad: Granularidad }) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ height: ALTO_GRAFICO }}>
      <p className="text-sm text-slate-500">{etiquetaPunto(punto.clave, granularidad, true)}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{usd(punto.ventasUSD)}</p>
      <p className="mt-1 text-sm text-slate-500">{plural(punto.ordenesValidas, 'venta válida', 'ventas válidas')}</p>
      <p className="mt-4 max-w-xs text-xs text-slate-400">Elige un rango de varios días para ver la tendencia.</p>
    </div>
  )
}

/** Marcas redondas del eje Y (0, 500, 1.000…) con el tope justo por encima del máximo */
function escalaLimpia(maximo: number, marcasDeseadas = 4) {
  if (maximo <= 0) return { tope: 1, paso: 1, marcas: [0, 1] }
  const bruto = maximo / marcasDeseadas
  const magnitud = 10 ** Math.floor(Math.log10(bruto))
  const paso = [1, 2, 2.5, 5, 10].map(f => f * magnitud).find(p => p >= bruto) ?? 10 * magnitud
  const tope = Math.ceil(maximo / paso - 1e-9) * paso
  return { tope, paso, marcas: Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso) }
}

/** Un solo estilo por eje: compacto ($10K) si el eje llega a 10.000; completo por debajo */
function formatoEje(valor: number, { tope, paso }: { tope: number; paso: number }) {
  if (tope >= 10_000) return formatoUSDCompacto.format(valor)
  return (paso < 1 ? formatoEjeDecimal : formatoEjeEntero).format(valor)
}

function useAnchoDe(ref: React.RefObject<HTMLElement | null>) {
  const [ancho, setAncho] = useState(0)
  useEffect(() => {
    const elemento = ref.current
    if (!elemento) return
    const observador = new ResizeObserver(([entrada]) => setAncho(Math.floor(entrada.contentRect.width)))
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [ref])
  return ancho
}

// ============================================================================
// RESUMEN DE ESTADOS
// ============================================================================
interface ParteBarra {
  clave: string
  etiqueta: string
  valor: number
  /** Texto del tooltip, p. ej. "120 órdenes · 85%" */
  lectura: string
  relleno: string
}

function ResumenEstados({ resumen }: { resumen: MetricasResumen }) {
  const total = resumen.ordenesRegistradas
  const filas = [
    {
      clave: 'validas',
      etiqueta: 'Válidas',
      valor: resumen.ordenesValidas,
      relleno: 'bg-emerald-600',
      detalle: `${formatoNumero.format(resumen.ordenesCerradas)} ya entregadas o pagadas`,
      fija: true,
    },
    { clave: 'pendientes', etiqueta: 'Pendientes', valor: resumen.ordenesPendientes, relleno: 'bg-slate-400', detalle: 'Aún sin aprobar', fija: false },
    {
      clave: 'rechazadas',
      etiqueta: 'Rechazadas',
      valor: resumen.rechazadas,
      relleno: 'bg-red-600',
      detalle: `${formatoNumero.format(resumen.rechazadasAdministracion)} por administración · ${formatoNumero.format(resumen.rechazadasEntrega)} en entrega`,
      fija: true,
    },
    { clave: 'canceladas', etiqueta: 'Canceladas', valor: resumen.canceladas, relleno: 'bg-slate-300', detalle: '', fija: false },
    { clave: 'otros', etiqueta: 'Otros estados', valor: resumen.otrosEstados, relleno: 'bg-slate-200', detalle: 'Valores antiguos no reconocidos', fija: false },
  ].filter(fila => fila.fija || fila.valor > 0)

  return (
    <Tarjeta icono={CheckCircle2} titulo="Resumen de estados" descripcion={`Cómo terminaron las ${plural(total, 'orden registrada', 'órdenes registradas')}`}>
      {total === 0 ? (
        <EstadoVacio icono={ShoppingBag} mensaje="No se registraron órdenes en este período." />
      ) : (
        <>
          <BarraSegmentada
            descripcion="Órdenes del período por estado"
            partes={filas.map(fila => ({
              clave: fila.clave,
              etiqueta: fila.etiqueta,
              valor: fila.valor,
              relleno: fila.relleno,
              lectura: `${plural(fila.valor, 'orden', 'órdenes')} · ${porcentaje(fila.valor / total)}`,
            }))}
          />
          <ul className="mt-4 divide-y divide-slate-100">
            {filas.map(fila => (
              <li key={fila.clave} className="flex items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${fila.relleno}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{fila.etiqueta}</p>
                    {fila.detalle && <p className="text-xs text-slate-500">{fila.detalle}</p>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{formatoNumero.format(fila.valor)}</p>
                  <p className="text-xs tabular-nums text-slate-500">{porcentaje(fila.valor / total)}</p>
                </div>
              </li>
            ))}
          </ul>
          {resumen.montoRechazadoUSD > 0 && (
            <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-slate-200">
              Las rechazadas sumaban <span className="font-semibold text-slate-900">{usd(resumen.montoRechazadoUSD)}</span> que no se concretaron.
            </p>
          )}
        </>
      )}
    </Tarjeta>
  )
}

/** Un total partido en tramos: barra fina con hueco de 2px entre tramos; las cifras van en la lista de al lado */
function BarraSegmentada({ partes, descripcion }: { partes: ParteBarra[]; descripcion: string }) {
  const [activa, setActiva] = useState<string | null>(null)
  const visibles = partes.filter(p => p.valor > 0)
  const total = visibles.reduce((suma, p) => suma + p.valor, 0)
  if (total === 0) return null

  const conCentro = visibles.map((parte, i) => {
    const anteriores = visibles.slice(0, i).reduce((suma, p) => suma + p.valor, 0)
    return { ...parte, centro: (anteriores + parte.valor / 2) / total }
  })
  const parteActiva = conCentro.find(p => p.clave === activa)
  const alinear = !parteActiva ? '' : parteActiva.centro < 0.2 ? 'translate-x-0' : parteActiva.centro > 0.8 ? '-translate-x-full' : '-translate-x-1/2'

  return (
    <div className="relative">
      <div role="group" aria-label={descripcion} className="flex h-6 items-center gap-0.5">
        {conCentro.map((parte, i) => (
          <button
            key={parte.clave}
            type="button"
            aria-label={`${parte.etiqueta}: ${parte.lectura}`}
            onPointerEnter={() => setActiva(parte.clave)}
            onPointerLeave={() => setActiva(null)}
            onFocus={() => setActiva(parte.clave)}
            onBlur={() => setActiva(null)}
            className="flex h-full min-w-1.5 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            style={{ flex: `${parte.valor} 1 0%` }}
          >
            <span
              className={`h-2 w-full transition-opacity ${parte.relleno} ${i === 0 ? 'rounded-l-full' : ''} ${i === conCentro.length - 1 ? 'rounded-r-full' : ''} ${activa && activa !== parte.clave ? 'opacity-40' : ''}`}
            />
          </button>
        ))}
      </div>
      {parteActiva && (
        <div
          role="tooltip"
          className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs shadow-lg ${alinear}`}
          style={{ left: `${parteActiva.centro * 100}%` }}
        >
          <span className="font-semibold text-white">{parteActiva.lectura}</span>
          <span className="text-slate-300"> · {parteActiva.etiqueta}</span>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// PRODUCTOS Y VENDEDORES
// ============================================================================
function TopProductos({ productos }: { productos: ProductoDestacado[] }) {
  const maximo = productos[0]?.ventasUSD ?? 0
  return (
    <Tarjeta icono={Trophy} titulo="Top 5 productos estrella" descripcion="Por facturación en ventas válidas (con descuentos aplicados)">
      {productos.length === 0 ? (
        <EstadoVacio icono={Package} mensaje="No se vendieron productos en este período." />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th scope="col" className="hidden px-1 pb-2.5 text-left sm:table-cell">SKU</th>
                <th scope="col" className="px-1 pb-2.5 text-left">Producto</th>
                <th scope="col" className="px-1 pb-2.5 text-right">Unidades</th>
                <th scope="col" className="px-1 pb-2.5 text-right">USD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productos.map(producto => (
                <tr key={producto.clave}>
                  <td className="hidden whitespace-nowrap px-1 py-3 align-top font-mono text-xs text-slate-500 sm:table-cell">{producto.sku ?? '—'}</td>
                  <td className="px-1 py-3 align-top">
                    <p className="line-clamp-2 font-medium text-slate-800">{producto.nombre}</p>
                    {/* En pantallas angostas el SKU va bajo el nombre para que la columna USD quepa sin desplazar */}
                    <p className="font-mono text-xs text-slate-500 sm:hidden">{producto.sku ?? '—'}</p>
                    <div aria-hidden className="mt-2 h-1 rounded-full bg-indigo-600" style={{ width: `${maximo > 0 ? Math.max(2, (producto.ventasUSD / maximo) * 100) : 0}%` }} />
                  </td>
                  <td className="whitespace-nowrap px-1 py-3 text-right align-top tabular-nums text-slate-700">{formatoNumero.format(producto.unidades)}</td>
                  <td className="whitespace-nowrap px-1 py-3 text-right align-top">
                    <p className="font-semibold tabular-nums text-slate-900">{usd(producto.ventasUSD)}</p>
                    <p className="text-xs tabular-nums text-slate-500">{porcentaje(producto.participacion)} del total</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  )
}

const VENDEDORES_VISIBLES = 8

function RankingVendedores({ vendedores }: { vendedores: RendimientoVendedor[] }) {
  const visibles = vendedores.slice(0, VENDEDORES_VISIBLES)
  const maximo = visibles[0]?.ventasUSD ?? 0
  return (
    <Tarjeta icono={Users} titulo="Ranking de vendedores" descripcion="Ventas válidas por ejecutivo en el período">
      {visibles.length === 0 ? (
        <EstadoVacio icono={Users} mensaje="Ningún vendedor registró ventas en este período." />
      ) : (
        <>
          <ol className="space-y-4">
            {visibles.map((vendedor, i) => (
              <li key={vendedor.clave}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${i === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                      {i + 1}
                    </span>
                    <p className="truncate text-sm font-medium text-slate-800">{vendedor.nombre}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{usd(vendedor.ventasUSD)}</p>
                </div>
                <div className="mt-2 pl-[34px]">
                  <div aria-hidden className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${maximo > 0 ? Math.max(1, (vendedor.ventasUSD / maximo) * 100) : 0}%` }} />
                  <p className="mt-1.5 text-xs text-slate-500">
                    {plural(vendedor.ordenesValidas, 'venta', 'ventas')} · ticket {usd(vendedor.ticketPromedioUSD)} · {porcentaje(vendedor.participacion)} del total
                    {vendedor.rechazadas > 0 && <> · {plural(vendedor.rechazadas, 'rechazada', 'rechazadas')}</>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {vendedores.length > VENDEDORES_VISIBLES && (
            <p className="mt-4 text-xs text-slate-500">Y {plural(vendedores.length - VENDEDORES_VISIBLES, 'vendedor más', 'vendedores más')} con menos ventas.</p>
          )}
        </>
      )}
    </Tarjeta>
  )
}

// ============================================================================
// SITUACIÓN ACTUAL: CARTERA E INVENTARIO
// ============================================================================
function SemaforoCartera({ aging, error, onReintentar, className = '' }: {
  aging: AgingCartera | null
  error: string | null
  onReintentar: () => void
  className?: string
}) {
  return (
    <Tarjeta className={className} icono={Wallet} titulo="Semáforo de cuentas por cobrar" descripcion="Créditos con saldo pendiente, de cualquier fecha">
      {error || !aging ? (
        <AvisoError mensaje={error ?? 'No se pudo calcular la cartera.'} onReintentar={onReintentar} />
      ) : aging.creditosAbiertos === 0 ? (
        <EstadoVacio icono={CheckCircle2} mensaje="No hay créditos con saldo pendiente." />
      ) : (
        <>
          {aging.tramos.vencido.creditos > 0 && (
            <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800 ring-1 ring-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
              <p>
                <span className="font-semibold">{usd(aging.tramos.vencido.saldoUSD)} vencidos</span> en {plural(aging.tramos.vencido.creditos, 'crédito', 'créditos')}. Prioriza la cobranza de los clientes en rojo.
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {(['alDia', 'porVencer', 'vencido'] as const).map(tramo => {
              const estilo = TRAMOS[tramo]
              const Icono = estilo.icono
              return (
                <div key={tramo} className="relative overflow-hidden rounded-xl bg-slate-50/70 p-4 ring-1 ring-slate-200">
                  <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${estilo.relleno}`} />
                  <div className="flex items-center gap-2">
                    <Icono className={`h-4 w-4 ${estilo.tinta}`} aria-hidden />
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{estilo.etiqueta}</p>
                  </div>
                  <p className="mt-2 text-xl font-semibold tracking-tight text-slate-900">{usdTarjeta(aging.tramos[tramo].saldoUSD)}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{plural(aging.tramos[tramo].creditos, 'crédito', 'créditos')} · {estilo.descripcion.toLowerCase()}</p>
                </div>
              )
            })}
          </div>
          <div className="mt-4">
            <BarraSegmentada
              descripcion="Saldo pendiente por tramo de vencimiento"
              partes={(['alDia', 'porVencer', 'vencido'] as const).map(tramo => ({
                clave: tramo,
                etiqueta: TRAMOS[tramo].etiqueta,
                valor: aging.tramos[tramo].saldoUSD,
                relleno: TRAMOS[tramo].relleno,
                lectura: `${usd(aging.tramos[tramo].saldoUSD)} · ${porcentaje(aging.tramos[tramo].saldoUSD / aging.saldoTotalUSD)}`,
              }))}
            />
            <p className="mt-1 text-xs text-slate-500">
              Saldo total por cobrar: <span className="font-semibold text-slate-900">{usd(aging.saldoTotalUSD)}</span> en {plural(aging.creditosAbiertos, 'crédito', 'créditos')}
            </p>
          </div>

          <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Mayores deudores</h4>
          <ul className="mt-1 divide-y divide-slate-100">
            {aging.mayoresDeudores.map(deudor => (
              <li key={deudor.clave} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{deudor.nombre}</p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                    <span>{deudor.cedulaRif || 'Sin RIF'}</span>
                    <span aria-hidden>·</span>
                    {deudor.telefono ? (
                      <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden />{deudor.telefono}</span>
                    ) : (
                      <span>Sin teléfono</span>
                    )}
                    <span aria-hidden>·</span>
                    <span>{plural(deudor.creditos, 'crédito', 'créditos')}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <ChipTramo deudor={deudor} />
                  <p className="min-w-[96px] text-right text-sm font-semibold tabular-nums text-slate-900">{usd(deudor.saldoUSD)}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Tarjeta>
  )
}

function ChipTramo({ deudor }: { deudor: DeudorPrincipal }) {
  const estilo = TRAMOS[deudor.tramo]
  const Icono = estilo.icono
  const dias = deudor.diasRestantes
  const texto = deudor.tramo === 'vencido'
    ? `Vencido hace ${plural(-dias, 'día', 'días')}`
    : dias === 0 ? 'Vence hoy' : `Vence en ${plural(dias, 'día', 'días')}`
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ${estilo.chip}`}>
      <Icono className={`h-3.5 w-3.5 ${estilo.tinta}`} aria-hidden />
      {texto}
    </span>
  )
}

function PanelInventario({ inventario, error, onReintentar }: {
  inventario: ResumenInventario | null
  error: string | null
  onReintentar: () => void
}) {
  return (
    <Tarjeta icono={Package} titulo="Inventario" descripcion="Productos activos, valorizados a precio de venta">
      {error || !inventario ? (
        <AvisoError mensaje={error ?? 'No se pudo calcular el inventario.'} onReintentar={onReintentar} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <DatoInventario etiqueta="Valor del stock" valor={usdTarjeta(inventario.valorizacionUSD)} detalle={plural(inventario.productosActivos, 'producto activo', 'productos activos')} />
            <DatoInventario
              etiqueta="Unidades disponibles"
              valor={formatoNumero.format(inventario.unidadesDisponibles)}
              detalle={inventario.unidadesReservadas > 0 ? `${formatoNumero.format(inventario.unidadesReservadas)} reservadas` : 'Ninguna reservada'}
            />
            <DatoInventario etiqueta="Sin stock" valor={formatoNumero.format(inventario.sinStock)} icono={PackageX} tinta="text-red-600" />
            <DatoInventario etiqueta={`Stock bajo (≤ ${UMBRAL_STOCK_BAJO})`} valor={formatoNumero.format(inventario.stockBajo)} icono={AlertTriangle} tinta="text-amber-600" />
          </dl>
          {inventario.alertas.length > 0 && (
            <>
              <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Reponer pronto</h4>
              <ul className="mt-1 divide-y divide-slate-100">
                {inventario.alertas.map(producto => (
                  <li key={producto.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{producto.nombre}</p>
                      <p className="font-mono text-xs text-slate-500">{producto.sku ?? '—'}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                      {producto.stock <= 0
                        ? <><PackageX className="h-3.5 w-3.5 text-red-600" aria-hidden />Agotado</>
                        : <><AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />{plural(producto.stock, 'unidad', 'unidades')}</>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Tarjeta>
  )
}

function DatoInventario({ etiqueta, valor, detalle, icono: Icono, tinta = '' }: {
  etiqueta: string
  valor: string
  detalle?: string
  icono?: LucideIcon
  tinta?: string
}) {
  return (
    <div className="rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-200">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {Icono && <Icono className={`h-3.5 w-3.5 ${tinta}`} aria-hidden />}
        {etiqueta}
      </dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{valor}</dd>
      {detalle && <dd className="text-xs text-slate-500">{detalle}</dd>}
    </div>
  )
}

// ============================================================================
// PIEZAS COMUNES
// ============================================================================
function Tarjeta({ icono: Icono, titulo, descripcion, accion, className = '', children }: {
  icono: LucideIcon
  titulo: string
  descripcion?: string
  accion?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    // min-w-0: dentro de un grid, una tabla ancha debe desplazarse dentro de la tarjeta, no ensancharla
    <article className={`min-w-0 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 md:p-6 ${className}`}>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
            <Icono className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
            {descripcion && <p className="mt-0.5 text-xs text-slate-500">{descripcion}</p>}
          </div>
        </div>
        {accion}
      </header>
      {children}
    </article>
  )
}

function EstadoVacio({ icono: Icono, mensaje }: { icono: LucideIcon; mensaje: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-50/70 px-6 py-12 text-center ring-1 ring-slate-100">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
        <Icono className="h-5 w-5" aria-hidden />
      </span>
      <p className="max-w-xs text-sm text-slate-500">{mensaje}</p>
    </div>
  )
}

function AvisoError({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 text-sm shadow-lg shadow-slate-900/5 ring-1 ring-red-200">
      <div className="flex min-w-0 items-start gap-2.5">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
        <p className="text-slate-700">{mensaje}</p>
      </div>
      <button type="button" onClick={onReintentar} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800">
        Reintentar
      </button>
    </div>
  )
}

function Bloque({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />
}

function FilaKpiEsqueleto() {
  return (
    <div aria-hidden className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
      {['sm:col-span-3 xl:col-span-2', '', '', ''].map((span, i) => (
        <div key={i} className={`rounded-2xl bg-white p-5 shadow-lg shadow-slate-900/5 ring-1 ring-slate-200/80 ${span}`}>
          <div className="flex items-center justify-between">
            <Bloque className="h-4 w-24" />
            <Bloque className="h-9 w-9 rounded-xl" />
          </div>
          <Bloque className={`mt-4 ${i === 0 ? 'h-11 w-56' : 'h-7 w-28'}`} />
          <Bloque className="mt-3 h-3 w-36" />
        </div>
      ))}
    </div>
  )
}

function TarjetaEsqueleto({ alto, className = '' }: { alto: string; className?: string }) {
  return (
    <div aria-hidden className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 md:p-6 ${className}`}>
      <div className="mb-5 flex items-center gap-3">
        <Bloque className="h-9 w-9 rounded-xl" />
        <div className="space-y-2">
          <Bloque className="h-3.5 w-40" />
          <Bloque className="h-3 w-56" />
        </div>
      </div>
      <Bloque className={`w-full rounded-xl ${alto}`} />
    </div>
  )
}
