'use client'

import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { crearCliente } from '@/lib/services/clientes'
import type { Cliente, DatosCliente } from '@/lib/domain/clientes'
import ClienteFormModal from '@/components/ClienteFormModal'

interface CreateClientModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (newClient: Cliente) => void
  /** Clientes que el POS ya tiene cargados, para avisar de documentos repetidos sin volver a pedirlos */
  clientesExistentes?: readonly Cliente[]
}

// El payload de siempre del POS: los campos opcionales vacíos no se envían
function payloadCompacto({ cedula_rif, nombre, telefono, email, direccion }: DatosCliente) {
  const payload: Record<string, string> = { cedula_rif, nombre }
  if (telefono) payload.telefono = telefono
  if (email) payload.email = email
  if (direccion) payload.direccion = direccion
  return payload
}

/** Alta rápida de clientes desde el POS (misma interfaz de props que antes) */
export default function CreateClientModal({ isOpen, onClose, onSuccess, clientesExistentes }: CreateClientModalProps) {
  const [supabase] = useState(() => createClient())

  return (
    <ClienteFormModal
      abierto={isOpen}
      onCerrar={onClose}
      clientesExistentes={clientesExistentes}
      onEnviar={datos => crearCliente(supabase, payloadCompacto(datos))}
      onGuardado={cliente => {
        onSuccess(cliente)
        onClose()
      }}
    />
  )
}
