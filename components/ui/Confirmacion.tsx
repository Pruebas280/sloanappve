'use client'

import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CircleHelp, TriangleAlert } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Boton from '@/components/ui/Boton'

export interface OpcionesConfirmacion {
  titulo: string
  descripcion?: string
  /** Texto del botón que confirma (por defecto "Confirmar") */
  confirmar?: string
  cancelar?: string
  tono?: 'neutro' | 'peligro'
}

type Confirmar = (opciones: OpcionesConfirmacion) => Promise<boolean>

const ContextoConfirmacion = createContext<Confirmar | null>(null)

/** Reemplazo de window.confirm: `if (!(await confirmar({ titulo: '¿Eliminar…?', tono: 'peligro' }))) return` */
export function ConfirmacionProvider({ children }: { children: React.ReactNode }) {
  const [pedido, setPedido] = useState<OpcionesConfirmacion | null>(null)
  const resolver = useRef<((respuesta: boolean) => void) | null>(null)

  const confirmar = useCallback<Confirmar>(opciones => new Promise<boolean>(resolve => {
    resolver.current?.(false) // si quedaba otra pregunta abierta, cuenta como cancelada
    resolver.current = resolve
    setPedido(opciones)
  }), [])

  const responder = (respuesta: boolean) => {
    resolver.current?.(respuesta)
    resolver.current = null
    setPedido(null)
  }

  const peligro = pedido?.tono === 'peligro'
  return (
    <ContextoConfirmacion.Provider value={confirmar}>
      {children}
      <Modal
        abierto={pedido !== null}
        onCerrar={() => responder(false)}
        titulo={pedido?.titulo ?? ''}
        descripcion={pedido?.descripcion}
        icono={peligro ? TriangleAlert : CircleHelp}
        tono={peligro ? 'peligro' : 'neutro'}
        ancho="sm"
        pie={
          <>
            {/* El foco arranca en Cancelar: confirmar una acción peligrosa exige un gesto explícito */}
            <Boton variante="secundario" onClick={() => responder(false)} data-autofocus>
              {pedido?.cancelar ?? 'Cancelar'}
            </Boton>
            <Boton variante={peligro ? 'peligro' : 'primario'} onClick={() => responder(true)}>
              {pedido?.confirmar ?? 'Confirmar'}
            </Boton>
          </>
        }
      />
    </ContextoConfirmacion.Provider>
  )
}

export function useConfirmacion(): Confirmar {
  const confirmar = useContext(ContextoConfirmacion)
  if (!confirmar) throw new Error('useConfirmacion debe usarse dentro de <ConfirmacionProvider>')
  return confirmar
}
