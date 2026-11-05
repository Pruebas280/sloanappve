'use client'

import React, { useState } from 'react'
import { ClipboardCheck, Wallet } from 'lucide-react'
import MonitoreoOrdenes from '@/components/admin/MonitoreoOrdenes'
import CuentasPorCobrar from '@/components/admin/CuentasPorCobrar'
import Pestanas from '@/components/ui/Pestanas'

type Vista = 'ordenes' | 'cobranza'

interface AdminDashboardProps {
  /** Oculta el selector de vista: en el panel del Owner, el menú lateral ya elige entre órdenes y cobranza */
  hideTabs?: boolean
  /** Vista inicial: 'ordenes' (monitoreo) o 'cobranza' (cuentas por cobrar) */
  defaultTab?: string
}

/** Administración: monitoreo de órdenes y cuentas por cobrar */
export default function AdminDashboard({ hideTabs = false, defaultTab = 'ordenes' }: AdminDashboardProps = {}) {
  const [vista, setVista] = useState<Vista>(defaultTab === 'cobranza' ? 'cobranza' : 'ordenes')

  return (
    <div className="min-h-full w-full bg-slate-100 font-sans text-slate-800">
      {!hideTabs && (
        <div className="mx-auto w-full max-w-7xl px-6 pt-6 md:px-8">
          <Pestanas
            etiqueta="Vista de administración"
            valor={vista}
            onCambiar={setVista}
            opciones={[
              { id: 'ordenes', etiqueta: 'Órdenes', icono: ClipboardCheck },
              { id: 'cobranza', etiqueta: 'Cuentas por cobrar', icono: Wallet },
            ]}
          />
        </div>
      )}
      {vista === 'cobranza' ? <CuentasPorCobrar /> : <MonitoreoOrdenes />}
    </div>
  )
}
