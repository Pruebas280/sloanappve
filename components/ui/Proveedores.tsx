'use client'

import React from 'react'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmacionProvider } from '@/components/ui/Confirmacion'

/** Contextos de interfaz para toda la app (notificaciones y confirmaciones). Se monta en el layout raíz */
export default function Proveedores({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmacionProvider>{children}</ConfirmacionProvider>
    </ToastProvider>
  )
}
