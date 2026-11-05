'use client'

import React, { useDeferredValue, useEffect, useId, useMemo, useState } from 'react'
import { Bike, CircleX, Inbox, MapPin, PackageCheck, Phone, Search, SearchX, Truck, Undo2, UserRound, X, XCircle, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { devolverACola, listarDespachos, marcarEntregada, rechazarEnDespacho, type OrdenDespacho, type ResultadoOperacion } from '@/lib/services/ordenes'
import { textoBuscable } from '@/lib/domain/clientes'
import { DESPACHO_RECHAZADO } from '@/lib/domain/ordenes'
import { fechaHora, numeroOrden, plural } from '@/lib/formato'
import ModalRechazo, { ModalMotivo } from '@/components/ModalRechazo'
import Modal from '@/components/ui/Modal'
import Boton from '@/components/ui/Boton'
import Campo, { claseEntrada } from '@/components/ui/Campo'
import Pestanas from '@/components/ui/Pestanas'
import InsigniaEstado from '@/components/ui/InsigniaEstado'
import { Bloque } from '@/components/ui/Esqueleto'
import { useToast } from '@/components/ui/Toast'

// Las mismas opciones de despacho de siempre
const METODOS_DESPACHO: { valor: string; icono: LucideIcon }[] = [
  { valor: 'Retiro por Cliente', icono: UserRound },
  { valor: 'Camioneta', icono: Truck },
  { valor: 'Motorizado', icono: Bike },
]

type Pestana = 'aprobado' | 'entregado' | 'rechazado_en_entrega'

const SIN_ORDENES: Record<Pestana, string> = {
  aprobado: 'No hay órdenes por despachar',
  entregado: 'Aún no hay entregas registradas',
  rechazado_en_entrega: 'No hay órdenes rechazadas en entrega',
}
type Accion = { tipo: 'entregar' | 'rechazar' | 'devolver'; orden: OrdenDespacho } | null

const referencia = (orden: OrdenDespacho) => `Orden #${numeroOrden(orden.id)} · ${orden.clientes?.nombre ?? 'Cliente sin nombre'}`

function coincide(orden: OrdenDespacho, consulta: string) {
  const texto = textoBuscable(consulta).trim()
  return !texto || [numeroOrden(orden.id), orden.clientes?.nombre, orden.clientes?.cedula_rif].some(c => textoBuscable(c).includes(texto))
}

export default function AlmacenDashboard() {
  const [supabase] = useState(() => createClient())
  const toast = useToast()
  const [ordenes, setOrdenes] = useState<OrdenDespacho[] | null>(null) // null = primera carga
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [recargas, setRecargas] = useState(0)
  const [pestana, setPestana] = useState<Pestana>('aprobado')
  const [busqueda, setBusqueda] = useState('')
  const consulta = useDeferredValue(busqueda)
  const [accion, setAccion] = useState<Accion>(null)

  // Carga y refresco en tiempo real cuando cambia cualquier orden
  useEffect(() => {
    let vigente = true
    const cargar = () => listarDespachos(supabase).then(resultado => {
      if (!vigente) return
      if (resultado.ok) {
        setOrdenes(resultado.datos)
        setErrorCarga(null)
      } else {
        setErrorCarga(resultado.error)
      }
    })
    cargar()
    const canal = supabase.channel('despachos').on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, cargar).subscribe()
    return () => {
      vigente = false
      supabase.removeChannel(canal)
    }
  }, [supabase, recargas])

  const cuentas = useMemo(() => ({
    aprobado: (ordenes ?? []).filter(o => o.estado === 'aprobado').length,
    entregado: (ordenes ?? []).filter(o => o.estado === 'entregado').length,
    rechazado_en_entrega: (ordenes ?? []).filter(o => o.estado === 'rechazado_en_entrega').length,
  }), [ordenes])
  const visibles = (ordenes ?? []).filter(o => o.estado === pestana && coincide(o, consulta))

  // Cada acción devuelve su resultado al modal: si falla, el error se ve ahí y el modal sigue abierto
  const ejecutar = async (
    hacer: (orden: OrdenDespacho) => Promise<ResultadoOperacion>,
    alTerminar: (orden: OrdenDespacho) => void
  ): Promise<ResultadoOperacion> => {
    const orden = accion?.orden
    if (!orden) return { ok: false, error: 'No hay una orden seleccionada.' }
    const resultado = await hacer(orden)
    if (resultado.ok) {
      setAccion(null)
      alTerminar(orden)
    }
    return resultado
  }

  const cambiarEstadoLocal = (id: string, estado: string) =>
    setOrdenes(lista => (lista ?? []).map(o => (o.id === id ? { ...o, estado } : o)))

  const entregar = (despacho: { metodo_despacho: string; observaciones_despacho: string }) =>
    ejecutar(orden => marcarEntregada(supabase, orden.id, despacho), orden => {
      cambiarEstadoLocal(orden.id, 'entregado')
      toast.exito(`Orden #${numeroOrden(orden.id)} entregada`, { descripcion: despacho.metodo_despacho })
    })

  // Se guarda en estado_despacho + motivo sin tocar `estado` (los triggers de stock de la base fallan
  // al cambiarlo) y la mercancía vuelve al inventario desde la app. La orden no se borra
  const rechazar = (motivo: string) => {
    let avisoStock: string | null = null
    return ejecutar(
      async orden => {
        const resultado = await rechazarEnDespacho(supabase, orden.id, motivo)
        if (resultado.ok) avisoStock = resultado.avisoStock
        return resultado
      },
      orden => {
        setOrdenes(lista => (lista ?? []).map(o => (o.id === orden.id ? { ...o, estado: 'rechazado_en_entrega', estado_despacho: DESPACHO_RECHAZADO, motivo_rechazo: motivo } : o)))
        const titulo = `Orden #${numeroOrden(orden.id)} rechazada en entrega`
        if (avisoStock) toast.aviso(titulo, { descripcion: `${avisoStock} La orden quedó en "Rechazadas".`, duracion: 12000 })
        else toast.exito(titulo, { descripcion: `Motivo: ${motivo}. La mercancía volvió al inventario y la orden quedó en "Rechazadas".` })
      }
    )
  }

  const devolver = (motivo: string) =>
    ejecutar(orden => devolverACola(supabase, orden.id, motivo), orden => {
      cambiarEstadoLocal(orden.id, 'aprobado')
      toast.info(`Orden #${numeroOrden(orden.id)} devuelta a la cola`, { descripcion: 'Vuelve a "Por despachar".' })
    })

  const cerrar = () => setAccion(null)

  return (
    <div className="mx-auto w-full max-w-7xl p-6 font-sans md:p-8">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
          <Truck className="h-6 w-6 text-indigo-600" aria-hidden />
          Logística y despacho
        </h2>
        <p className="text-sm text-slate-500">Prepara las órdenes aprobadas y registra cada entrega o rechazo.</p>
      </header>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Pestanas
          etiqueta="Estado de los despachos"
          valor={pestana}
          onCambiar={setPestana}
          opciones={[
            { id: 'aprobado', etiqueta: 'Por despachar', cuenta: ordenes ? cuentas.aprobado : undefined },
            { id: 'entregado', etiqueta: 'Entregadas', cuenta: ordenes ? cuentas.entregado : undefined },
            { id: 'rechazado_en_entrega', etiqueta: 'Rechazadas', cuenta: ordenes ? cuentas.rechazado_en_entrega : undefined },
          ]}
        />
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            aria-label="Buscar despachos"
            placeholder="Orden, cliente o RIF"
            className={`${claseEntrada} h-10 pl-10 pr-9 [&::-webkit-search-cancel-button]:hidden`}
          />
          {busqueda && (
            <button type="button" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-4 w-4" aria-hidden />
            </button>
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
          <div aria-hidden className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/80">
                <Bloque className="h-4 w-40" />
                <Bloque className="mt-4 h-24 w-full rounded-xl" />
                <Bloque className="mt-4 h-4 w-full" />
                <Bloque className="mt-2 h-4 w-2/3" />
                <Bloque className="mt-5 h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>
        ) : visibles.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              {consulta ? <SearchX className="h-6 w-6" aria-hidden /> : <Inbox className="h-6 w-6" aria-hidden />}
            </span>
            <p className="font-medium text-slate-900">
              {consulta ? `Sin resultados para "${consulta}"` : SIN_ORDENES[pestana]}
            </p>
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {visibles.map(orden => (
              <TarjetaDespacho key={orden.id} orden={orden} onAccion={tipo => setAccion({ tipo, orden })} />
            ))}
          </div>
        )}
      </section>

      <ModalEntrega orden={accion?.tipo === 'entregar' ? accion.orden : null} onCerrar={cerrar} onConfirmar={entregar} />
      <ModalRechazo
        abierto={accion?.tipo === 'rechazar'}
        onCerrar={cerrar}
        tipo="rechazado_en_entrega"
        referencia={accion ? referencia(accion.orden) : ''}
        onConfirmar={rechazar}
      />
      <ModalMotivo
        abierto={accion?.tipo === 'devolver'}
        onCerrar={cerrar}
        icono={Undo2}
        tono="neutro"
        titulo="Devolver a la cola de despacho"
        referencia={accion ? referencia(accion.orden) : ''}
        explicacion='La orden vuelve a "Por despachar" para entregarse de nuevo. El stock no cambia.'
        etiquetaCampo="Motivo del reingreso"
        etiquetaConfirmar="Devolver a la cola"
        sugerencias={['Error al entregar', 'El cliente pidió posponer', 'Dirección equivocada', 'Faltó mercancía en el despacho']}
        onConfirmar={devolver}
      />
    </div>
  )
}

function TarjetaDespacho({ orden, onAccion }: { orden: OrdenDespacho; onAccion: (tipo: 'entregar' | 'rechazar' | 'devolver') => void }) {
  const items = orden.orden_items ?? []
  const unidades = items.reduce((suma, item) => suma + Number(item.cantidad || 0), 0)
  const telefono = orden.clientes?.telefono
  const porDespachar = orden.estado === 'aprobado'
  const rechazada = orden.estado === 'rechazado_en_entrega'

  return (
    <article className="flex flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-slate-900">#{numeroOrden(orden.id)}</span>
              <InsigniaEstado estado={orden.estado} />
            </div>
            <p className="mt-1 text-xs text-slate-500">{fechaHora(orden.fecha_creacion)}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{plural(unidades, 'unidad', 'unidades')}</span>
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200/70">
          <p className="font-medium text-slate-900">{orden.clientes?.nombre ?? 'Cliente sin nombre'}</p>
          <p className="font-mono text-xs text-slate-500">{orden.clientes?.cedula_rif ?? 'Sin RIF'}</p>
          {telefono && (
            <a href={`tel:${String(telefono).replace(/[^\d+]/g, '')}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">
              <Phone className="h-3 w-3" aria-hidden />
              {telefono}
            </a>
          )}
          <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-700">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            {orden.direccion_envio || orden.clientes?.direccion || 'Sin dirección especificada'}
          </p>
        </div>

        {rechazada && orden.motivo_rechazo && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <span><span className="font-medium">Motivo del rechazo:</span> {orden.motivo_rechazo}</span>
          </p>
        )}

        <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">{rechazada ? 'Productos de la orden' : 'Productos a despachar'}</h4>
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map((item, i) => (
            <li key={item.id ?? i} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-800">{item.productos?.nombre || 'Producto sin nombre'}</p>
                <p className="font-mono text-[11px] text-slate-500">{item.productos?.sku || item.productos?.codigo || 'Sin SKU'}</p>
              </div>
              <span className="shrink-0 rounded-md bg-indigo-50 px-2 py-0.5 text-sm font-semibold tabular-nums text-indigo-700">× {item.cantidad}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Una orden rechazada ya no tiene acciones de despacho */}
      {!rechazada && (
        <footer className="mt-auto flex flex-wrap gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          {porDespachar ? (
            <>
              <Boton variante="peligroSuave" tamano="sm" icono={XCircle} onClick={() => onAccion('rechazar')}>Rechazar en entrega</Boton>
              <Boton tamano="sm" icono={PackageCheck} onClick={() => onAccion('entregar')} className="ml-auto">Marcar entregada</Boton>
            </>
          ) : (
            <Boton variante="secundario" tamano="sm" icono={Undo2} onClick={() => onAccion('devolver')} className="ml-auto">Devolver a la cola</Boton>
          )}
        </footer>
      )}
    </article>
  )
}

function ModalEntrega({ orden, onCerrar, onConfirmar }: {
  orden: OrdenDespacho | null
  onCerrar: () => void
  onConfirmar: (despacho: { metodo_despacho: string; observaciones_despacho: string }) => Promise<ResultadoOperacion>
}) {
  const [guardando, setGuardando] = useState(false)
  const idFormulario = useId()
  return (
    <Modal
      abierto={orden !== null}
      onCerrar={onCerrar}
      bloqueado={guardando}
      icono={Truck}
      titulo="Confirmar entrega"
      descripcion={orden ? referencia(orden) : ''}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" form={idFormulario} icono={PackageCheck} cargando={guardando}>Confirmar entrega</Boton>
        </>
      }
    >
      <FormularioEntrega idFormulario={idFormulario} onConfirmar={onConfirmar} onGuardando={setGuardando} />
    </Modal>
  )
}

function FormularioEntrega({ idFormulario, onConfirmar, onGuardando }: {
  idFormulario: string
  onConfirmar: (despacho: { metodo_despacho: string; observaciones_despacho: string }) => Promise<ResultadoOperacion>
  onGuardando: (guardando: boolean) => void
}) {
  const [metodo, setMetodo] = useState(METODOS_DESPACHO[0].valor)
  const [observaciones, setObservaciones] = useState('')
  const [error, setError] = useState<string | null>(null)

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    onGuardando(true)
    const resultado = await onConfirmar({ metodo_despacho: metodo, observaciones_despacho: observaciones })
    onGuardando(false)
    if (!resultado.ok) setError(resultado.error)
  }

  return (
    <form id={idFormulario} onSubmit={enviar} className="space-y-4">
      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm text-red-800 ring-1 ring-red-200">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <p>{error}</p>
        </div>
      )}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Método de despacho</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {METODOS_DESPACHO.map(({ valor, icono: Icono }) => (
            <label
              key={valor}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium ring-1 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-600 ${metodo === valor ? 'bg-indigo-50 text-indigo-800 ring-indigo-300' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
            >
              <input type="radio" name={`${idFormulario}-metodo`} value={valor} checked={metodo === valor} onChange={() => setMetodo(valor)} className="sr-only" data-autofocus={metodo === valor ? true : undefined} />
              <Icono className="h-4 w-4 shrink-0" aria-hidden />
              {valor}
            </label>
          ))}
        </div>
      </fieldset>
      <Campo id={`${idFormulario}-observaciones`} etiqueta="Observaciones (opcional)">
        <textarea
          id={`${idFormulario}-observaciones`}
          rows={3}
          value={observaciones}
          onChange={e => setObservaciones(e.target.value)}
          placeholder="Ej. Entregado a Juan Pérez, recepción del edificio"
          className={`${claseEntrada} resize-none py-2.5`}
        />
      </Campo>
    </form>
  )
}
