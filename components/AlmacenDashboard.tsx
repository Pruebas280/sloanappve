'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

interface OrdenDespacho {
  id: string
  creado_en: string
  estado: string
  clientes: { nombre: string; cedula_rif: string; telefono: string; direccion: string } | null
  detalles_orden: {
    cantidad: number
    productos: { nombre: string; codigo?: string; sku?: string } | null
  }[]
}

type TabType = 'aprobados' | 'entregados'

export default function AlmacenDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('aprobados')
  const [ordenes, setOrdenes] = useState<OrdenDespacho[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchDespachos = useCallback(async () => {
    if (supabaseUrl === 'https://placeholder.supabase.co') return
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .select('id, creado_en, estado, clientes(nombre, cedula_rif, direccion, telefono), detalles_orden(cantidad, productos(nombre, sku))')
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
          .select('id, creado_en, estado, clientes(nombre, cedula_rif, direccion, telefono), detalles_orden(cantidad, productos(nombre))')
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

  const marcarComoEntregado = async (id: string) => {
    try {
      const { error } = await supabase
        .from('ordenes')
        .update({ estado: 'entregado' })
        .eq('id', id)
      
      if (error) throw error
      alert(`Orden marcada como entregada exitosamente.`)
      // Refrescar estado local para reflejar inmediato
      setOrdenes(prev => prev.map(o => o.id === id ? { ...o, estado: 'entregado' } : o))
    } catch (err: any) {
      alert('Error actualizando estado de la orden: ' + err.message)
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
        <button onClick={() => setActiveTab('aprobados')} className={`flex-1 py-4 font-bold transition-colors ${activeTab === 'aprobados' ? 'text-blue-700 border-b-4 border-blue-700 bg-blue-50/50' : 'text-slate-500 hover:bg-slate-50'}`}>
          Cola de Despacho (Por Preparar)
        </button>
        <button onClick={() => setActiveTab('entregados')} className={`flex-1 py-4 font-bold transition-colors ${activeTab === 'entregados' ? 'text-blue-700 border-b-4 border-blue-700 bg-blue-50/50' : 'text-slate-500 hover:bg-slate-50'}`}>
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
                    {orden.estado === 'aprobado' && <span className="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1.5 rounded-full border border-blue-200 shadow-sm flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>Aprobado (Preparar)</span>}
                    {orden.estado === 'entregado' && <span className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1.5 rounded-full border border-green-200 shadow-sm flex items-center gap-1">✅ Entregado</span>}
                    
                    <span className="text-xs font-bold text-slate-400">{new Date(orden.creado_en).toLocaleString()}</span>
                  </div>
                  
                  <h3 className="font-black text-xl text-slate-800 mb-4">Orden #{orden.id.split('-')[0]}</h3>
                  
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6 text-sm font-medium shadow-inner">
                    <p className="mb-2"><span className="text-slate-400 font-bold block text-xs uppercase tracking-wider mb-0.5">Cliente</span> <span className="text-slate-700 text-base">{orden.clientes?.nombre}</span></p>
                    <p className="mb-2"><span className="text-slate-400 font-bold block text-xs uppercase tracking-wider mb-0.5">Cédula / RIF</span> <span className="text-slate-700">{orden.clientes?.cedula_rif}</span></p>
                    <p className="mb-2"><span className="text-slate-400 font-bold block text-xs uppercase tracking-wider mb-0.5">Teléfono</span> <span className="text-slate-700">{orden.clientes?.telefono || 'N/A'}</span></p>
                    <p><span className="text-slate-400 font-bold block text-xs uppercase tracking-wider mb-0.5">Dirección de Entrega</span> <span className="text-slate-700">{orden.clientes?.direccion || 'N/A'}</span></p>
                  </div>
                  
                  <h4 className="font-bold text-slate-700 text-sm mb-3 px-1 flex items-center justify-between">
                    <span>Productos a Preparar:</span>
                    <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded">{orden.detalles_orden?.length || 0} ítems</span>
                  </h4>
                  
                  <ul className="space-y-2 mb-2">
                    {orden.detalles_orden?.map((item, idx) => (
                      <li key={idx} className="flex justify-between items-center text-sm font-medium bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                        <span className="text-slate-700 flex-1">{item.productos?.nombre}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Cant:</span>
                          <span className="font-black bg-blue-100 text-blue-800 px-3 py-1 rounded-lg shadow-sm text-base">{item.cantidad}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                   {orden.estado === 'aprobado' && (
                     <button 
                      onClick={() => marcarComoEntregado(orden.id)} 
                      className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-black tracking-wide py-3.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                     >
                        Marcar como Entregado
                     </button>
                   )}
                   {orden.estado === 'entregado' && (
                     <div className="w-full bg-slate-200 text-slate-500 font-bold py-3.5 rounded-xl text-center flex items-center justify-center gap-2 cursor-not-allowed">
                       Despacho Finalizado
                     </div>
                   )}
                </div>

              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
