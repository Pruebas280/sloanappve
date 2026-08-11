'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, XCircle, FileText, X, Clock } from 'lucide-react'

// ============================================================================
// TYPES E INTERFACES ESTRICTAS
// ============================================================================

interface OrdenAdmin {
  id: string
  estado: string
  total_usd: number
  total_bs: number
  creado_en: string
  fecha_creacion: string
  metodo_pago: string
  comprobante_pago_url: string | null
  clientes: { nombre: string; cedula_rif: string } | null
  usuarios: { nombre: string } | null // Vendedor
  detalles_orden: {
    cantidad: number
    producto_id: string
    productos: { nombre: string } | null
  }[]
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
interface AdminDashboardProps {
  hideTabs?: boolean
  defaultTab?: string // Mantenido por retrocompatibilidad, ignorado internamente
}

export default function AdminDashboard({ hideTabs = false }: AdminDashboardProps = {}) {
  const supabase = createClient()
  
  // Estados de UI
  const [ordenes, setOrdenes] = useState<OrdenAdmin[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [modalImage, setModalImage] = useState<string | null>(null)

  // ============================================================================
  // CARGA DE DATOS (ÓRDENES PENDIENTES)
  // ============================================================================
  const fetchOrdenesPendientes = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .select(`
          *,
          clientes ( nombre, cedula_rif ),
          usuarios!vendedor_id ( nombre ),
          detalles_orden ( *, productos ( nombre ) )
        `)
        .in('estado', ['pendiente', 'pendiente_pago', 'esperando_aprobacion'])
        .order('fecha_creacion', { ascending: false })
      
      if (error) throw error
      
      const orders = data as unknown as OrdenAdmin[]
      setOrdenes(orders)
    } catch (err: any) {
      console.error('Error cargando órdenes:', err)
      alert(`Ocurrió un problema cargando las órdenes: ${err.message || 'Error desconocido'}`)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchOrdenesPendientes()

    // Realtime subscription para recargar si hay nuevas órdenes pendientes
    const channel = supabase
      .channel('ordenes-admin-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => {
        fetchOrdenesPendientes()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchOrdenesPendientes, supabase])

  // ============================================================================
  // MANEJADORES DE ESTADO DE ÓRDENES
  // ============================================================================
  const cambiarEstadoOrden = async (orden: OrdenAdmin, nuevoEstado: 'aprobado' | 'rechazado') => {
    if (!orden || !orden.id) return

    setIsLoading(true)
    try {
      const { error } = await supabase
        .from('ordenes')
        .update({ estado: nuevoEstado })
        .eq('id', String(orden.id))
      
      if (error) throw error
      
      // Stock update is handled natively by the procesar_cambio_estado_orden() trigger in Supabase
      await fetchOrdenesPendientes()
      
      alert(`Orden ${String(orden.id).split('-')[0]} marcada como ${nuevoEstado}.`)
    } catch (err: any) {
      console.error("Error cambiando estado de la orden:", err.message || err);
      alert("Error al procesar la orden: " + (err.message || "Consulte la consola"));
    } finally {
      setIsLoading(false)
    }
  }

  // ============================================================================
  // RENDER UI
  // ============================================================================
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col h-full">
      
      {/* Header Corporativo */}
      <header className="bg-white border-b border-slate-200/80 p-6 shadow-sm shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Administración ERP</h1>
        <p className="text-slate-600 text-sm font-medium mt-1">Validación de Pagos y Transferencias</p>
      </header>

      {/* Tabs Restantes */}
      {!hideTabs && (
      <div className="flex border-b border-slate-200 bg-slate-50 shrink-0">
        <button className="flex-1 py-3 text-center font-medium text-slate-900 border-b-2 border-slate-900 bg-white cursor-default text-sm">
          Órdenes por Aprobar
        </button>
      </div>
      )}

      <main className="p-6 md:p-8 flex-1 overflow-y-auto">
        
        <div className="space-y-6 max-w-7xl mx-auto">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-slate-700">Pagos Pendientes de Revisión ({ordenes.length})</h2>
          </div>
          
          {isLoading && ordenes.length === 0 ? (
            <p className="text-slate-500 font-medium animate-pulse text-sm">Cargando órdenes en espera...</p>
          ) : ordenes.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-500 font-medium shadow-sm text-sm">
              No hay pagos pendientes de revisión actualmente.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {ordenes.map(orden => (
                <div key={orden.id} className="bg-white rounded-xl shadow-sm border border-slate-200/80 overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                  <div className="p-6 flex-1">
                    <div className="flex justify-between items-start mb-4">
                      <span className="flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200/60 px-2.5 py-1 rounded-full text-xs font-medium">
                        <Clock className="w-3.5 h-3.5" /> PENDIENTE REVISIÓN
                      </span>
                      <span className="text-xs font-medium text-slate-400">{new Date(orden.fecha_creacion || orden.creado_en || Date.now()).toLocaleString()}</span>
                    </div>
                    <h3 className="font-semibold text-lg text-slate-900 mb-1 tracking-tight">Orden #{orden.id.split('-')[0]}</h3>
                    <p className="text-sm text-slate-600 font-medium">Cliente: <span className="font-semibold text-slate-800">{orden.clientes?.nombre}</span></p>
                    <p className="text-sm text-slate-600 font-medium">Vendedor: {orden.usuarios?.nombre}</p>
                    
                    {/* Lista de Productos */}
                    <div className="mt-4 bg-slate-50/80 rounded-lg p-3 border border-slate-100">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Productos ({orden.detalles_orden?.length || 0})</p>
                      <ul className="text-sm font-medium text-slate-700 space-y-1">
                        {orden.detalles_orden?.map((item, idx) => (
                          <li key={idx}>- {item.cantidad}x {item.productos?.nombre || 'Producto'}</li>
                        ))}
                      </ul>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-end">
                      <span className="text-slate-600 text-sm font-medium">Total a Validar:</span>
                      <div className="text-right">
                        <p className="text-xl font-semibold text-slate-900 tracking-tight">${Number(orden.total_usd).toFixed(2)}</p>
                        <p className="text-xs font-medium text-slate-500">Bs. {Number(orden.total_bs).toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-5 bg-slate-50/80 flex flex-col gap-3 border-t border-slate-100">
                    {orden.comprobante_pago_url && (
                      <button 
                        onClick={() => setModalImage(orden.comprobante_pago_url!)}
                        className="flex items-center justify-center gap-2 w-full py-2 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-all shadow-sm text-sm"
                      >
                        <FileText className="w-4 h-4" /> Ver Comprobante
                      </button>
                    )}
                    
                    <div className="flex gap-2">
                      <button 
                        onClick={() => cambiarEstadoOrden(orden, 'aprobado')}
                        className="flex items-center justify-center gap-1.5 flex-1 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-all shadow-sm text-sm"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Aprobar Pago
                      </button>
                      <button 
                        onClick={() => cambiarEstadoOrden(orden, 'rechazado')}
                        className="flex items-center justify-center gap-1.5 flex-1 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg font-medium hover:bg-slate-50 transition-all shadow-sm text-sm"
                      >
                        <XCircle className="w-4 h-4" /> Rechazar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modal Visor de Comprobante */}
      {modalImage && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white p-2 rounded-xl max-w-2xl w-full flex flex-col relative shadow-sm border border-slate-200">
            <button 
              onClick={() => setModalImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-slate-900 text-white rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors shadow-sm"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-full h-[60vh] bg-slate-100/50 rounded-lg overflow-hidden flex items-center justify-center border border-slate-100">
              {modalImage.endsWith('.pdf') ? (
                 <iframe src={modalImage} className="w-full h-full" title="Comprobante PDF" />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                 <img src={modalImage} alt="Comprobante" className="max-w-full max-h-full object-contain" />
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
