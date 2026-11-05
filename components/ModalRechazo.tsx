'use client'

import React, { useId, useState } from 'react'
import { CircleX, XCircle, type LucideIcon } from 'lucide-react'
import type { EstadoRechazo } from '@/lib/domain/ordenes'
import type { ResultadoOperacion } from '@/lib/services/ordenes'
import Modal from '@/components/ui/Modal'
import Boton from '@/components/ui/Boton'
import Campo, { ariaCampo, claseEntrada } from '@/components/ui/Campo'

interface ModalMotivoProps {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  /** Identifica la orden en el encabezado, p. ej. "Orden #1A2B3C · Ferretería El Tornillo" */
  referencia: string
  icono: LucideIcon
  tono: 'neutro' | 'peligro'
  /** Qué pasa al confirmar, en una o dos frases */
  explicacion: React.ReactNode
  etiquetaCampo: string
  etiquetaConfirmar: string
  /** Motivos frecuentes: escribirlos igual ayuda a agruparlos después en la analítica */
  sugerencias: string[]
  /** Confirma con el motivo. Si falla, el error se muestra en el modal */
  onConfirmar: (motivo: string) => Promise<ResultadoOperacion>
}

/** Modal que exige un motivo antes de confirmar un cambio de estado (rechazos, reingresos) */
export function ModalMotivo({ abierto, onCerrar, titulo, referencia, icono, tono, etiquetaConfirmar, ...formulario }: ModalMotivoProps) {
  const [guardando, setGuardando] = useState(false)
  const idFormulario = useId()

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardando}
      icono={icono}
      tono={tono}
      titulo={titulo}
      descripcion={referencia}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" form={idFormulario} variante={tono === 'peligro' ? 'peligro' : 'primario'} cargando={guardando}>
            {etiquetaConfirmar}
          </Boton>
        </>
      }
    >
      <FormularioMotivo idFormulario={idFormulario} onGuardando={setGuardando} {...formulario} />
    </Modal>
  )
}

const SUGERENCIAS_RECHAZO: Record<EstadoRechazo, string[]> = {
  rechazado: ['Pago no confirmado', 'El cliente desistió de la compra', 'Error en los precios o cantidades', 'Orden duplicada'],
  rechazado_en_entrega: ['El cliente no recibió la mercancía', 'Mercancía dañada', 'Dirección de entrega incorrecta', 'El cliente no tenía el pago'],
}

/** Rechazo de administración ('rechazado') o del almacén al despachar ('rechazado_en_entrega') */
export default function ModalRechazo({ tipo, ...props }: {
  abierto: boolean
  onCerrar: () => void
  tipo: EstadoRechazo
  referencia: string
  onConfirmar: (motivo: string) => Promise<ResultadoOperacion>
}) {
  const enEntrega = tipo === 'rechazado_en_entrega'
  return (
    <ModalMotivo
      {...props}
      icono={XCircle}
      tono="peligro"
      titulo={enEntrega ? 'Rechazar en la entrega' : 'Rechazar orden'}
      etiquetaConfirmar={enEntrega ? 'Rechazar en entrega' : 'Rechazar orden'}
      etiquetaCampo="Motivo del rechazo"
      sugerencias={SUGERENCIAS_RECHAZO[tipo]}
      explicacion={
        <>
          La orden no se borra: queda como <span className="font-semibold text-slate-900">{enEntrega ? 'Rechazada en entrega' : 'Rechazada'}</span> con
          este motivo, y su mercancía vuelve automáticamente al stock disponible.
        </>
      }
    />
  )
}

function FormularioMotivo({ idFormulario, explicacion, etiquetaCampo, sugerencias, onConfirmar, onGuardando }: {
  idFormulario: string
  explicacion: React.ReactNode
  etiquetaCampo: string
  sugerencias: string[]
  onConfirmar: (motivo: string) => Promise<ResultadoOperacion>
  onGuardando: (guardando: boolean) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [errorCampo, setErrorCampo] = useState<string | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const idCampo = `${idFormulario}-motivo`

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!motivo.trim()) {
      setErrorCampo('Escribe el motivo: queda registrado en la orden.')
      document.getElementById(idCampo)?.focus()
      return
    }
    setErrorGeneral(null)
    onGuardando(true)
    const resultado = await onConfirmar(motivo.trim())
    onGuardando(false)
    if (!resultado.ok) setErrorGeneral(resultado.error)
  }

  return (
    <form id={idFormulario} onSubmit={enviar} noValidate className="space-y-4">
      <p className="rounded-xl bg-slate-50 p-3.5 text-sm text-slate-600 ring-1 ring-slate-200">{explicacion}</p>

      {errorGeneral && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm text-red-800 ring-1 ring-red-200">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <p>{errorGeneral}</p>
        </div>
      )}

      <Campo id={idCampo} etiqueta={etiquetaCampo} requerido error={errorCampo}>
        <textarea
          {...ariaCampo(idCampo, { error: errorCampo })}
          rows={3}
          value={motivo}
          onChange={e => {
            setMotivo(e.target.value)
            if (errorCampo) setErrorCampo(null)
          }}
          placeholder="Explica brevemente el motivo"
          data-autofocus
          className={`${claseEntrada} resize-none py-2.5`}
        />
      </Campo>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">Motivos frecuentes</p>
        <div className="flex flex-wrap gap-2">
          {sugerencias.map(sugerencia => (
            <button
              key={sugerencia}
              type="button"
              onClick={() => {
                setMotivo(sugerencia)
                setErrorCampo(null)
              }}
              aria-pressed={motivo === sugerencia}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${motivo === sugerencia ? 'bg-indigo-50 text-indigo-700 ring-indigo-200' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
            >
              {sugerencia}
            </button>
          ))}
        </div>
      </div>
    </form>
  )
}
