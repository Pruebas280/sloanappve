'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'

import AdminDashboard from '@/components/AdminDashboard'
import AlmacenDashboard from '@/components/AlmacenDashboard'
import VendedorPOS from '@/components/VendedorPOS'
import CreateClientModal from '@/components/CreateClientModal'
import GlobalInventory from '@/components/GlobalInventory'

// ============================================================================
// CONFIGURACIÓN DE SUPABASE Y TYPES
// ============================================================================
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

// Interfaces
interface Metricas {
  pendientesRevision: number
  aprobadosYEntregados: number
}

interface OrdenReporte {
  id: string
  estado: string
  total_usd: number
  total_bs: number
  fecha_creacion: string
  clientes: { nombre: string } | null
  usuarios: { nombre: string } | null
  orden_items: {
    cantidad: number
    productos: { nombre: string } | null
  }[]
}

type OwnerTab = 'metricas' | 'inventario_global' | 'pagos' | 'logistica' | 'pos' | 'clientes'

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function OwnerDashboard() {
  const [activeTab, setActiveTab] = useState<OwnerTab>('metricas')
  const [clientes, setClientes] = useState<any[]>([])
  const [showClientModal, setShowClientModal] = useState(false)

  // Estado para métricas
  const [metricas, setMetricas] = useState<Metricas>({ pendientesRevision: 0, aprobadosYEntregados: 0 })
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState<boolean>(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error', texto: string } | null>(null)

  // ============================================================================
  // LÓGICA DE LA PESTAÑA: MÉTRICAS ORIGINAL
  // ============================================================================
  const fetchMetrics = useCallback(async () => {
    if (supabaseUrl === 'https://placeholder.supabase.co') return
    try {
      const [pendientesRes, despachadosRes] = await Promise.all([
        supabase.from('ordenes').select('*', { count: 'exact', head: true }).eq('estado', 'PENDIENTE_REVISION'),
        supabase.from('ordenes').select('*', { count: 'exact', head: true }).in('estado', ['APROBADO_DESPACHO', 'ENTREGADO'])
      ])
      setMetricas({
        pendientesRevision: pendientesRes.count || 0,
        aprobadosYEntregados: despachadosRes.count || 0
      })
    } catch (error) {
      console.error('Error obteniendo métricas:', error)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'metricas') {
      fetchMetrics()
      const canalOrdenes = supabase
        .channel('metricas_ordenes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, fetchMetrics)
        .subscribe()
      return () => { supabase.removeChannel(canalOrdenes) }
    }
    if (activeTab === 'clientes') {
      supabase.from('clientes').select('*').order('nombre').then(({ data }) => {
        if (data) setClientes(data)
      })
    }
  }, [activeTab, fetchMetrics])
  
  const handleDownloadPDF = async () => {
    if (!startDate || !endDate) {
      return setMensaje({ tipo: 'error', texto: 'Por favor, selecciona un rango de fechas válido.' })
    }
    setIsGenerating(true)
    setMensaje(null)

    try {
      const { data: ordenesData, error: dbError } = await supabase
        .from('ordenes')
        .select(`
          id, estado, total_usd, total_bs, fecha_creacion,
          clientes ( nombre ), usuarios ( nombre ),
          orden_items ( cantidad, productos ( nombre ) )
        `)
        .gte('fecha_creacion', `${startDate}T00:00:00.000Z`)
        .lte('fecha_creacion', `${endDate}T23:59:59.999Z`)
        .order('fecha_creacion', { ascending: false })
        
      const ordenes = (ordenesData as unknown) as OrdenReporte[] | null

      if (dbError) throw new Error(`Fallo consultando BD: ${dbError.message}`)
      if (!ordenes || ordenes.length === 0) throw new Error('No hay órdenes registradas en ese rango de fechas.')

      const { default: jsPDF } = await import('jspdf')
      const autoTable = (await import('jspdf-autotable')).default
      const doc = new jsPDF('l', 'pt', 'a4')

      doc.setFontSize(18)
      doc.text('Reporte Ejecutivo de Ventas y Órdenes', 40, 40)
      doc.setFontSize(11)
      doc.setTextColor(100)
      doc.text(`Período: ${startDate} al ${endDate}`, 40, 60)
      doc.text(`Fecha de emisión: ${new Date().toLocaleString()}`, 40, 75)

      const tableColumn = ["ID Orden", "Fecha", "Cliente", "Vendedor", "Productos (Cant.)", "Total USD", "Total BS", "Estado"]
      const tableRows = ordenes.map(orden => {
        const fecha = new Date(orden.fecha_creacion).toLocaleDateString()
        const resumenProductos = orden.orden_items.map(item => `${item.cantidad}x ${item.productos?.nombre || 'N/A'}`).join('\n')
        return [
          orden.id.split('-')[0], fecha, orden.clientes?.nombre || 'Desconocido', orden.usuarios?.nombre || 'Desconocido',
          resumenProductos, `$${orden.total_usd.toFixed(2)}`, `Bs. ${orden.total_bs.toFixed(2)}`, orden.estado.replace('_', ' ')
        ]
      })

      autoTable(doc, {
        head: [tableColumn], body: tableRows, startY: 90,
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [30, 58, 138] },
        alternateRowStyles: { fillColor: [241, 245, 249] },
        columnStyles: { 4: { cellWidth: 150 } },
      })

      doc.save(`Reporte_Ventas_${startDate}_${endDate}.pdf`)
      setMensaje({ tipo: 'exito', texto: 'El PDF ha sido generado y descargado exitosamente.' })
    } catch (err: unknown) {
      setMensaje({ tipo: 'error', texto: err instanceof Error ? err.message : 'Error interno procesando PDF' })
    } finally {
      setIsGenerating(false)
    }
  }

  // ============================================================================
  // RENDER UI/UX CON TABS DE "ACCESO TOTAL"
  // ============================================================================
  return (
    <div className="w-full min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800">
      
      {/* Header Owner */}
      <div className="bg-slate-900 text-white p-6 shadow-md z-10">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-2">
          👑 Control Maestro Owner
        </h1>
        <p className="text-slate-400 font-medium mt-1">Acceso irrestricto a todos los módulos del sistema.</p>
        
        {/* Selector de Pestañas Owner */}
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <TabBtn active={activeTab === 'metricas'} onClick={() => setActiveTab('metricas')}>📊 Reportes y Métricas</TabBtn>
          <TabBtn active={activeTab === 'inventario_global'} onClick={() => setActiveTab('inventario_global')}>🌍 Inventario Global</TabBtn>
          <TabBtn active={activeTab === 'pagos'} onClick={() => setActiveTab('pagos')}>💳 Aprobación Pagos</TabBtn>
          <TabBtn active={activeTab === 'logistica'} onClick={() => setActiveTab('logistica')}>🚚 Logística Despacho</TabBtn>
          <TabBtn active={activeTab === 'pos'} onClick={() => setActiveTab('pos')}>🛒 Punto de Venta</TabBtn>
          <TabBtn active={activeTab === 'clientes'} onClick={() => setActiveTab('clientes')}>👥 Clientes</TabBtn>
        </div>
      </div>

      {/* Renderizado de Módulos (Reutilización React) */}
      <div className="flex-1 overflow-y-auto">
        
        {/* PESTAÑA 1: MÉTRICAS (PROPIO) */}
        {activeTab === 'metricas' && (
          <div className="p-6 md:p-12 max-w-6xl mx-auto animate-in fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
              <div className="bg-white rounded-2xl p-6 border-l-8 border-orange-500 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">Pendientes de Revisión</p>
                  <h2 className="text-4xl font-black text-slate-800">{metricas.pendientesRevision}</h2>
                  <p className="text-xs text-slate-400 mt-2">Auditoría a Administración</p>
                </div>
                <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center text-orange-500 font-bold">
                   <span className="relative flex h-4 w-4">
                     {metricas.pendientesRevision > 0 && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>}
                     <span className="relative inline-flex rounded-full h-4 w-4 bg-orange-500"></span>
                   </span>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-6 border-l-8 border-green-500 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">Aprobados & Entregados</p>
                  <h2 className="text-4xl font-black text-slate-800">{metricas.aprobadosYEntregados}</h2>
                  <p className="text-xs text-slate-400 mt-2">Auditoría a Almacenista</p>
                </div>
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 max-w-4xl">
              <h2 className="text-xl font-bold text-blue-900 mb-6">Generador de Reportes Ejecutivos</h2>
              <div className="flex flex-col md:flex-row items-end gap-6">
                <div className="w-full md:w-1/3">
                  <label className="block text-sm font-bold text-slate-700 mb-2">Fecha de Inicio</label>
                  <input type="date" className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-500 outline-none" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="w-full md:w-1/3">
                  <label className="block text-sm font-bold text-slate-700 mb-2">Fecha de Fin</label>
                  <input type="date" className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-500 outline-none" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
                <div className="w-full md:w-1/3">
                  <button onClick={handleDownloadPDF} disabled={isGenerating} className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold disabled:opacity-50 flex justify-center items-center gap-2">
                    {isGenerating ? 'Generando PDF...' : 'Descargar Resumen PDF'}
                  </button>
                </div>
              </div>
              {mensaje && <div className={`mt-6 p-4 rounded-xl text-sm font-bold ${mensaje.tipo === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{mensaje.texto}</div>}
            </div>
          </div>
        )}

        {/* OTRAS PESTAÑAS: INYECTANDO MÓDULOS DE OTROS ROLES */}
        {activeTab === 'inventario_global' && <div className="animate-in fade-in h-full"><GlobalInventory hideHeader={true} /></div>}
        {activeTab === 'pagos' && <div className="animate-in fade-in h-full"><AdminDashboard hideTabs={true} /></div>}
        {activeTab === 'logistica' && <div className="animate-in fade-in h-full"><AlmacenDashboard /></div>}
        {activeTab === 'pos' && <div className="animate-in fade-in h-full"><VendedorPOS /></div>}
        {activeTab === 'clientes' && (
          <div className="p-6 md:p-12 max-w-6xl mx-auto animate-in fade-in h-full">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-blue-900">Directorio de Clientes</h2>
              <button onClick={() => setShowClientModal(true)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl shadow-md">
                + Nuevo Cliente
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="p-4 font-bold text-slate-700">Cédula / RIF</th>
                      <th className="p-4 font-bold text-slate-700">Nombre / Razón Social</th>
                      <th className="p-4 font-bold text-slate-700">Teléfono</th>
                      <th className="p-4 font-bold text-slate-700">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientes.map(cli => (
                      <tr key={cli.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-4 text-slate-600 font-medium">{cli.cedula_rif}</td>
                        <td className="p-4 font-bold text-slate-800">{cli.nombre}</td>
                        <td className="p-4 text-slate-600">{cli.telefono || 'N/A'}</td>
                        <td className="p-4 text-slate-600">{cli.email || 'N/A'}</td>
                      </tr>
                    ))}
                    {clientes.length === 0 && (
                      <tr><td colSpan={4} className="p-8 text-center text-slate-500 font-medium">No hay clientes registrados.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <CreateClientModal 
              isOpen={showClientModal} 
              onClose={() => setShowClientModal(false)} 
              onSuccess={(nuevo) => {
                setClientes(prev => [...prev, nuevo])
                alert('Cliente registrado exitosamente')
              }} 
            />
          </div>
        )}
        
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={`px-5 py-3 font-bold rounded-t-xl transition-all whitespace-nowrap text-sm border-b-4 ${active ? 'bg-slate-800 text-white border-blue-500' : 'bg-slate-900 text-slate-400 border-transparent hover:bg-slate-800'}`}
    >
      {children}
    </button>
  )
}
