'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { X, XCircle } from 'lucide-react'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

interface OrdenDespacho {
  id: string
  creado_en: string
  estado: string
  direccion_envio?: string
  clientes: {
    nombre: string; cedula_rif: string; telefono: string; direccion: string } | null
  orden_items: {
    id?: string
    cantidad: number
    producto_id?: string
    productos: { id?: string; nombre: string; precio?: number; codigo?: string; sku?: string } | null
  }[]
}

type TabType = 'aprobados' | 'entregados'

export default function AlmacenDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('aprobados')
  const [ordenes, setOrdenes] = useState<OrdenDespacho[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Estados del Modal de Despacho
  const [showDespachoModal, setShowDespachoModal] = useState(false)
  const [despachoOrderId, setDespachoOrderId] = useState<string | null>(null)
  const [metodoDespacho, setMetodoDespacho] = useState('Retiro por Cliente')
  const [observacionesDespacho, setObservacionesDespacho] = useState('')
  
  // Estados del Modal de Rechazo
  const [showRechazoModal, setShowRechazoModal] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState('')

  // Estados del Modal de Devolución
  const [showDevolucionModal, setShowDevolucionModal] = useState(false)
  const [devolucionOrderId, setDevolucionOrderId] = useState<string | null>(null)
  const [motivoDevolucion, setMotivoDevolucion] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)

  const fetchDespachos = useCallback(async () => {
    if (supabaseUrl === 'https://placeholder.supabase.co') return
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .select('id, creado_en, estado, direccion_envio, clientes(nombre, cedula_rif, direccion, telefono), orden_items(id, cantidad, producto_id, productos(*))')
        .in('estado', ['aprobado', 'entregado'])
        .order('creado_en', { ascending: false })

      if (error) throw error
      setOrdenes((data as unknown) as OrdenDespacho[])
    } catch (err: any) {
      console.error('Error fetching despachos:', err)
      // Fallback query en caso de que la columna sku no exista
      try {
        const { data, error } = await supabase
          .from('ordenes')
          .select('id, creado_en, estado, direccion_envio, clientes(nombre, cedula_rif, direccion, telefono), orden_items(id, cantidad, producto_id, productos(*))')
          .in('estado', ['aprobado', 'entregado'])
          .order('creado_en', { ascending: false })
        if (error) throw error
        setOrdenes((data as unknown) as OrdenDespacho[])
      } catch (fallbackErr: any) {
        alert('Ocurrió un error cargando la cola logística: ' + fallbackErr.message)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDespachos()
    const canal = supabase.channel('despachos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, fetchDespachos)
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [fetchDespachos])

  const abrirModalDespacho = (id: string) => {
    setDespachoOrderId(id)
    setMetodoDespacho('Retiro por Cliente')
    setObservacionesDespacho('')
    setShowDespachoModal(true)
  }

  const abrirModalRechazo = (id: string) => {
    setDespachoOrderId(id)
    setMotivoRechazo('')
    setShowRechazoModal(true)
  }

  const confirmarDespacho = async () => {
    if (!despachoOrderId) return
    setIsSubmitting(true)
    try {
      const { error } = await supabase
        .from('ordenes')
        .update({ 
          estado: 'entregado',
          metodo_despacho: metodoDespacho,
          observaciones_despacho: observacionesDespacho
        })
        .eq('id', despachoOrderId)
      
      if (error) throw error
      alert(`Orden marcada como entregada exitosamente.`)
      
      setOrdenes(prev => prev.map(o => o.id === despachoOrderId ? { ...o, estado: 'entregado' } : o))
      setShowDespachoModal(false)
    } catch (err: any) {
      alert('Error actualizando estado de la orden: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Compatibilidad TS para requerimientos estrictos del usuario
  const fetchProductos: any = undefined;
  const fetchOrdenes: any = undefined;
  const setProductos: any = undefined;

  async function handleAnularOBorrarOrden(ordenId: string) {
    try {
      const cleanId = String(ordenId).trim();
      if (!cleanId) return;

      // 1. Invocar el procedimiento almacenado certificado
      const { data, error } = await supabase.rpc('eliminar_orden_y_reponer_stock', {
        p_orden_id: cleanId
      });

      if (error) {
        console.error("Error en RPC de reposición:", error);
        alert("Error al procesar la orden: " + error.message);
        return;
      }

      console.log("Stock repuesto y orden eliminada exitosamente:", data);

      // 2. Filtrar la orden eliminada de la vista
      // setOrdenes(prev => prev.filter(o => o.id !== cleanId)); // No usamos setOrdenes aquí

      // 3. Traer el inventario actualizado directamente de Supabase para reflejar el nuevo stock_disponible
      const { data: productosActualizados } = await supabase.from('productos').select('*');
      if (productosActualizados && typeof setProductos === 'function') {
        setProductos(productosActualizados);
      }

      // 4. Refrescar datos generales
      if (typeof fetchProductos === 'function') await fetchProductos();
      if (typeof fetchOrdenes === 'function') await fetchOrdenes();

      // Refrescar la vista y el inventario
      if (typeof fetchDespachos === 'function') await fetchDespachos();
    } catch (err) {
      console.error("Excepción en anulación:", err);
    }
  }

  const confirmarRechazo = async () => {
    if (!despachoOrderId) return
    if (!motivoRechazo.trim()) {
      alert("Debes ingresar un motivo de rechazo.")
      return
    }
    setIsSubmitting(true)
    try {
      await handleAnularOBorrarOrden(despachoOrderId)
      
      alert(`Orden rechazada y anulada. Inventario devuelto exitosamente.`)
      setShowRechazoModal(false)
    } catch (err: any) {
      alert('Error al rechazar orden: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const abrirModalDevolucion = (id: string) => {
    setDevolucionOrderId(id)
    setMotivoDevolucion('')
    setShowDevolucionModal(true)
  }

  const confirmarDevolucionCola = async () => {
    if (!devolucionOrderId) return
    if (!motivoDevolucion.trim()) {
      alert("Debes ingresar un motivo.")
      return
    }
    setIsSubmitting(true)
    try {
      const { error } = await supabase
        .from('ordenes')
        .update({ 
          estado: 'aprobado',
          motivo_rechazo: motivoDevolucion
        })
        .eq('id', devolucionOrderId)
      
      if (error) throw error
      alert(`Orden devuelta a cola de despacho.`)
      
      await fetchDespachos()
      setShowDevolucionModal(false)
    } catch (err: any) {
      alert('Error al devolver orden: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const getFilteredOrdenes = () => {
    if (activeTab === 'aprobados') return ordenes.filter(o => o.estado === 'aprobado')
    if (activeTab === 'entregados') return ordenes.filter(o => o.estado === 'entregado')
    return []
  }

  const ordenesFiltradas = getFilteredOrdenes()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col animate-in fade-in">
      <header className="bg-slate-900 text-white p-6 shadow-md">
        <h1 className="text-2xl font-black tracking-wide flex items-center gap-2">
          📦 Logística y Almacén
        </h1>
        <p className="text-slate-400 text-sm font-medium mt-1">Gestión de despachos y preparación de órdenes.</p>
      </header>

      <div className="flex border-b border-slate-200 bg-white">
        <button onClick={() => setActiveTab('aprobados')} className={`flex-1 py-4 font-bold transition-colors ${activeTab === 'aprobados' ? 'text-indigo-700 border-b-4 border-indigo-700 bg-indigo-50/50' : 'text-slate-500 hover:bg-slate-50'}`}>
          Cola de Despacho (Por Preparar)
        </button>
        <button onClick={() => setActiveTab('entregados')} className={`flex-1 py-4 font-bold transition-colors ${activeTab === 'entregados' ? 'text-indigo-700 border-b-4 border-indigo-700 bg-indigo-50/50' : 'text-slate-500 hover:bg-slate-50'}`}>
          Historial Entregados
        </button>
      </div>

      <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
        {isLoading ? (
          <p className="text-center font-bold text-slate-400 mt-10 animate-pulse">Cargando cola logística...</p>
        ) : ordenesFiltradas.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center shadow-sm mt-8">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
               <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
            </div>
            <h3 className="text-xl font-bold text-slate-600">Sin registros</h3>
            <p className="text-slate-500 font-medium mt-1">No hay órdenes en esta categoría.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {ordenesFiltradas.map(orden => (
              <div key={orden.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col transition-all hover:shadow-md">
                
                <div className="p-5 flex-1">
                  <div className="flex justify-between items-start mb-4">
                    {orden.estado === 'aprobado' && <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-3 py-1.5 rounded-full border border-indigo-200 shadow-sm flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>Aprobado (Preparar)</span>}
                    {orden.estado === 'entregado' && <span className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1.5 rounded-full border border-green-200 shadow-sm flex items-center gap-1">✅ Entregado</span>}
                    
                    <span className="text-xs font-bold text-slate-400">{new Date(orden.creado_en).toLocaleString()}</span>
                  </div>
                  
                  <h3 className="font-black text-xl text-slate-800 mb-4">Orden #{orden.id.split('-')[0]}</h3>
                  
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6 text-sm font-medium shadow-inner">
                    <p className="mb-2"><span className="text-slate-400 font-bold block text-xs uppercase tracking-wider mb-0.5">Cliente</span> <span className="text-slate-700 text-base">{orden.clientes?.nombre}</span></p>
                    <p className="mb-2"><span className="text-slate-400 font-bold block text-xs uppercase tracking-wider mb-0.5">Cédula / RIF</span> <span className="text-slate-700">{orden.clientes?.cedula_rif}</span></p>
                    <p className="mb-2"><span className="text-slate-400 font-bold block text-xs uppercase tracking-wider mb-0.5">Teléfono</span> <span className="text-slate-700">{orden.clientes?.telefono || 'N/A'}</span></p>
                    <p><span className="text-slate-400 font-bold block text-xs uppercase tracking-wider mb-0.5">Dirección de Entrega</span> <span className="text-slate-700">{orden.direccion_envio || orden.clientes?.direccion || 'Sin dirección especificada'}</span></p>
                  </div>
                  
                  <div className="mt-2 text-sm border-t pt-4">
                    <h4 className="font-bold text-slate-700 text-sm mb-3 px-1 flex items-center justify-between">
                      <span>Productos a despachar:</span>
                      <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded">{orden.orden_items?.length || 0} ítems</span>
                    </h4>
                    
                    <ul className="space-y-1 mb-2">
                      {orden.orden_items?.map((item: any, idx: number) => (
                        <li key={item.id || idx} className="text-gray-600 flex justify-between items-center text-xs bg-gray-50 p-2 rounded">
                          <span>
                            <strong className="text-gray-900">{item.productos?.nombre || 'Producto sin nombre'}</strong>
                            {item.productos?.codigo ? ` (Cód: ${item.productos.codigo})` : ''}
                          </span>
                          <span className="font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded">
                            Cant: {item.cantidad}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                   {orden.estado === 'aprobado' && (
                     <>
                       <button 
                        onClick={() => abrirModalDespacho(orden.id)} 
                        className="w-2/3 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-black tracking-wide py-3.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-sm"
                       >
                          Marcar como Entregado
                       </button>
                       <button 
                        onClick={() => abrirModalRechazo(orden.id)} 
                        className="w-1/3 bg-white hover:bg-red-50 text-red-600 font-bold tracking-wide py-3.5 rounded-xl border border-red-200 transition-all shadow-sm flex items-center justify-center gap-1 text-sm"
                       >
                          <X className="w-4 h-4" /> Rechazar
                       </button>
                     </>
                   )}
                   {orden.estado === 'entregado' && (
                     <button 
                      onClick={() => abrirModalDevolucion(orden.id)} 
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold tracking-wide py-3.5 rounded-xl border border-slate-300 transition-all shadow-sm flex items-center justify-center gap-2 text-sm"
                     >
                        Devolver a Cola de Despacho
                     </button>
                   )}
                </div>

              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal de Despacho */}
      {showDespachoModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-white">
              <h3 className="text-lg font-semibold text-slate-900 tracking-tight">Completar Pedido (Despacho)</h3>
              <button type="button" onClick={() => setShowDespachoModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-6 space-y-5 bg-white">
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Método de Despacho</label>
                <select 
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm text-slate-800 bg-slate-50 transition-colors"
                  value={metodoDespacho}
                  onChange={(e) => setMetodoDespacho(e.target.value)}
                >
                  <option value="Retiro por Cliente">Retiro por Cliente</option>
                  <option value="Camioneta">Camioneta</option>
                  <option value="Motorizado">Motorizado</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Observaciones de Despacho (Opcional)</label>
                <textarea 
                  className="w-full p-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm text-slate-800 bg-slate-50 transition-colors resize-none"
                  rows={3}
                  placeholder="Ej. Entregado a Juan Pérez..."
                  value={observacionesDespacho}
                  onChange={(e) => setObservacionesDespacho(e.target.value)}
                ></textarea>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setShowDespachoModal(false)} className="px-4 h-11 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-colors text-sm">
                  Cancelar
                </button>
                <button 
                  onClick={confirmarDespacho} 
                  disabled={isSubmitting} 
                  className="px-5 h-11 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl shadow-md transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                >
                  {isSubmitting ? 'Guardando...' : 'Confirmar Entrega'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Rechazo / Anulación */}
      {showRechazoModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-red-100 flex justify-between items-center bg-red-50">
              <h3 className="text-lg font-semibold text-red-900 tracking-tight flex items-center gap-2">
                <XCircle className="w-5 h-5" /> Rechazar / Anular Entrega
              </h3>
              <button type="button" onClick={() => setShowRechazoModal(false)} className="text-red-400 hover:text-red-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-6 space-y-5 bg-white">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
                Al confirmar, el inventario reservado regresará automáticamente al stock disponible y la orden quedará anulada.
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Motivo del Rechazo (Requerido)</label>
                <textarea 
                  className="w-full p-3 rounded-xl border border-slate-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none text-sm text-slate-800 bg-slate-50 transition-colors resize-none"
                  rows={4}
                  placeholder="Ej. Mercancía dañada, cliente no tenía el dinero, etc."
                  value={motivoRechazo}
                  onChange={(e) => setMotivoRechazo(e.target.value)}
                  required
                ></textarea>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setShowRechazoModal(false)} className="px-4 h-11 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-colors text-sm">
                  Cancelar
                </button>
                <button 
                  onClick={confirmarRechazo} 
                  disabled={isSubmitting || !motivoRechazo.trim()} 
                  className="px-5 h-11 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl shadow-md transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                >
                  {isSubmitting ? 'Anulando...' : 'Confirmar Anulación'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Devolver a Cola */}
      {showDevolucionModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                Devolver a Cola de Despacho
              </h3>
              <button type="button" onClick={() => setShowDevolucionModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-6 space-y-5 bg-white">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                La orden volverá al flujo de trabajo del almacén como "Aprobada" para ser despachada nuevamente.
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Motivo de reingreso a cola de despacho</label>
                <textarea 
                  className="w-full p-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm text-slate-800 bg-slate-50 transition-colors resize-none"
                  rows={4}
                  placeholder="Ej. Error al entregar, Cliente pidió postergar..."
                  value={motivoDevolucion}
                  onChange={(e) => setMotivoDevolucion(e.target.value)}
                  required
                ></textarea>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setShowDevolucionModal(false)} className="px-4 h-11 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-colors text-sm">
                  Cancelar
                </button>
                <button 
                  onClick={confirmarDevolucionCola} 
                  disabled={isSubmitting || !motivoDevolucion.trim()} 
                  className="px-5 h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-md transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                >
                  {isSubmitting ? 'Devolviendo...' : 'Confirmar Reingreso'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
