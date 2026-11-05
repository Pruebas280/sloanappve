'use client'

import React, { useEffect, useId, useRef } from 'react'
import { X, type LucideIcon } from 'lucide-react'

const ANCHOS = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const

interface ModalProps {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  descripcion?: string
  icono?: LucideIcon
  tono?: 'neutro' | 'peligro'
  ancho?: keyof typeof ANCHOS
  /** Mientras se guarda, ni Esc, ni el fondo, ni la X cierran el modal */
  bloqueado?: boolean
  /** Botones del pie. Un botón de envío de un formulario del cuerpo usa el atributo `form` */
  pie?: React.ReactNode
  children?: React.ReactNode
}

/**
 * Modal sobre <dialog> nativo: atrapa el foco, cierra con Esc y deja inerte el resto de la página.
 * El contenido solo se monta mientras está abierto, así cada apertura empieza en limpio.
 * Para enfocar un elemento al abrir, márcalo con `data-autofocus`.
 */
export default function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  icono: Icono,
  tono = 'neutro',
  ancho = 'md',
  bloqueado = false,
  pie,
  children,
}: ModalProps) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const pulsoEnFondo = useRef(false)
  const idTitulo = useId()
  const idDescripcion = useId()

  useEffect(() => {
    const elemento = dialogo.current
    if (!elemento) return
    if (abierto && !elemento.open) {
      elemento.showModal()
      elemento.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!abierto && elemento.open) {
      elemento.close()
    }
  }, [abierto])

  const intentarCerrar = () => {
    if (!bloqueado) onCerrar()
  }

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDescripcion : undefined}
      // Esc: decide el componente padre, así el estado de React y el diálogo no se desincronizan
      onCancel={e => {
        e.preventDefault()
        intentarCerrar()
      }}
      // Si el navegador lo cerró por su cuenta, se avisa al padre
      onClose={() => {
        if (abierto) onCerrar()
      }}
      // Clic en el fondo: solo si empezó y terminó fuera del panel (no al soltar una selección de texto)
      onMouseDown={e => {
        pulsoEnFondo.current = e.target === e.currentTarget
      }}
      onClick={e => {
        if (pulsoEnFondo.current && e.target === e.currentTarget) intentarCerrar()
      }}
      className={`m-auto w-[calc(100%-2rem)] ${ANCHOS[ancho]} max-h-none overflow-visible bg-transparent p-0 text-slate-800 backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm`}
    >
      {abierto && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition duration-200 starting:scale-95 starting:opacity-0 motion-reduce:transition-none">
          <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
            {Icono && (
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${tono === 'peligro' ? 'bg-red-50 text-red-600 ring-red-100' : 'bg-indigo-50 text-indigo-600 ring-indigo-100'}`}>
                <Icono className="h-4 w-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 id={idTitulo} className="text-base font-semibold text-slate-900">{titulo}</h2>
              {descripcion && <p id={idDescripcion} className="mt-0.5 text-sm text-slate-500">{descripcion}</p>}
            </div>
            <button
              type="button"
              onClick={intentarCerrar}
              disabled={bloqueado}
              aria-label="Cerrar"
              className="-mr-1.5 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>
          {children && <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>}
          {pie && (
            <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              {pie}
            </footer>
          )}
        </div>
      )}
    </dialog>
  )
}
