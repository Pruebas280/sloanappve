'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

// ============================================================================
// TYPES E INTERFACES ESTRICTAS
// ============================================================================

interface OrdenAdmin {
  id: string
  estado: string
  total_usd: number
  total_bs: number
  creado_en: string
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
  // CARGA DE DATOS (ÓRDENES)
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
        .ilike('estado', 'pendiente')
        .order('creado_en', { ascending: false })
      
      if (error) throw error
      // Casteo seguro de tipo
      setOrdenes((data as unknown) as OrdenAdmin[])
    } catch (err: any) {
      console.error('Error cargando órdenes:', err)
      alert(`Ocurrió un problema cargando las órdenes: ${err.message || 'Error desconocido'}`)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchOrdenesPendientes()
  }, [fetchOrdenesPendientes])

  // ============================================================================
  // MANEJADORES DE ESTADO DE ÓRDENES
  // ============================================================================
  const cambiarEstadoOrden = async (orden: OrdenAdmin, nuevoEstado: 'aprobado' | 'rechazado') => {
    if (!orden || !orden.id) {
      alert("Error: ID de la orden no válido.");
      return;
    }

    setIsLoading(true)
    try {
      const { error } = await supabase
        .from('ordenes')
        .update({ estado: nuevoEstado })
        .eq('id', String(orden.id))
      
      if (error) throw error
      
      // Devolver stock si es rechazada
      if (nuevoEstado === 'rechazado' && orden.detalles_orden && orden.detalles_orden.length > 0) {
        for (const detalle of orden.detalles_orden) {
          if (!detalle.producto_id) continue;
          
          try {
            const { data: prodData, error: fetchErr } = await supabase
              .from('productos')
              .select('stock_disponible')
              .eq('id', String(detalle.producto_id))
              .single();
              
            if (fetchErr) {
              console.warn(`No se pudo obtener stock del producto ${detalle.producto_id}:`, fetchErr);
              continue;
            }
            
            if (prodData) {
               await supabase
                 .from('productos')
                 .update({ stock_disponible: Number(prodData.stock_disponible) + Number(detalle.cantidad) })
                 .eq('id', String(detalle.producto_id));
            }
          } catch (e) {
            console.warn(`Error al devolver stock del producto ${detalle.producto_id}:`, e);
          }
        }
      }
      
      setOrdenes(prev => prev.filter(o => o.id !== orden.id))
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
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      
      {/* Header Corporativo */}
      <header className="bg-blue-900 text-white p-6 shadow-md">
        <h1 className="text-2xl font-black tracking-wide">Administración ERP</h1>
        <p className="text-blue-200 text-sm font-medium">Control y Validación de Pagos</p>
      </header>

      {/* Tabs Restantes (Deshabilitado temporalmente ya que solo hay 1) */}
      {!hideTabs && (
      <div className="flex border-b border-slate-200 bg-white">
        <button className="flex-1 py-4 text-center font-bold text-blue-700 border-b-4 border-blue-700 bg-blue-50/50 cursor-default">
          Validación de Pagos
        </button>
      </div>
      )}

      <main className="p-6 md:p-8 max-w-7xl mx-auto">
        
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-slate-700">Órdenes Pendientes de Revisión</h2>
          
          {isLoading ? (
            <p className="text-slate-500 font-medium animate-pulse">Cargando órdenes...</p>
          ) : ordenes.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 font-medium">
              No hay pagos pendientes de revisión.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {ordenes.map(orden => (
                <div key={orden.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                  <div className="p-5 flex-1">
                    <div className="flex justify-between items-start mb-4">
                      <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded">Pendiente</span>
                      <span className="text-xs font-bold text-slate-400">{new Date(orden.creado_en).toLocaleString()}</span>
                    </div>
                    <h3 className="font-black text-lg text-slate-800 mb-1">Orden #{orden.id.split('-')[0]}</h3>
                    <p className="text-sm text-slate-600 font-medium">Cliente: {orden.clientes?.nombre} ({orden.clientes?.cedula_rif})</p>
                    <p className="text-sm text-slate-600 font-medium">Método Pago: <span className="font-bold">{orden.metodo_pago}</span></p>
                    
                    <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-end">
                      <span className="text-slate-500 text-sm font-bold">Total:</span>
                      <div className="text-right">
                        <p className="text-xl font-black text-blue-700">${orden.total_usd.toFixed(2)}</p>
                        <p className="text-xs font-bold text-slate-400">Bs. {orden.total_bs.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-slate-50 flex flex-col gap-2">
                    {orden.comprobante_pago_url && (
                      <button 
                        onClick={() => setModalImage(orden.comprobante_pago_url)}
                        className="w-full py-3 bg-white border-2 border-slate-200 rounded-lg text-slate-700 font-bold hover:bg-slate-100 transition-colors"
                      >
                        Ver Comprobante
                      </button>
                    )}
                    <div className="flex gap-2">
                      <button 
                        onClick={() => cambiarEstadoOrden(orden, 'aprobado')}
                        className="flex-1 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition-colors"
                      >
                        Aprobar Pago
                      </button>
                      <button 
                        onClick={() => cambiarEstadoOrden(orden, 'rechazado')}
                        className="flex-1 py-3 bg-red-100 text-red-700 rounded-lg font-bold hover:bg-red-200 transition-colors"
                      >
                        Rechazar Pago
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
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white p-2 rounded-2xl max-w-2xl w-full flex flex-col relative shadow-2xl">
            <button 
              onClick={() => setModalImage(null)}
              className="absolute -top-4 -right-4 w-10 h-10 bg-red-500 text-white rounded-full font-bold shadow-lg hover:bg-red-600 flex items-center justify-center"
            >
              X
            </button>
            <div className="w-full h-[60vh] bg-slate-100 rounded-xl overflow-hidden flex items-center justify-center">
              {/* Fallback visual para iframes o img */}
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
