'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'

import AdminDashboard from '@/components/AdminDashboard'
import AlmacenDashboard from '@/components/AlmacenDashboard'
import VendedorPOS from '@/components/VendedorPOS'
import GlobalInventory from '@/components/GlobalInventory'
import UserManagement from '@/components/UserManagement'
import ClientsManager from '@/components/ClientsManager'
import { Crown, BarChart, Globe, CreditCard, Truck, ShoppingCart, Users, Briefcase, FileText, Trash2, CheckCircle2, X, Menu, Search, Bell, HelpCircle, PackageCheck, ClipboardCheck } from 'lucide-react'

// ============================================================================
// CONFIGURACIÓN DE SUPABASE Y TYPES
// ============================================================================
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

// Interfaces
interface Metricas {
  pendientesRevision: number
  pendientesAlmacen: number
  entregados: number
}

interface OrdenReporte {
  id: string
  estado: string
  total_usd: number
  total_bs: number
  fecha_creacion: string
  cliente: { nombre: string } | null
  vendedor: { nombre: string } | null
  orden_items: {
    cantidad: number
    productos: { nombre: string } | null
  }[]
}

type OwnerTab = 'metricas' | 'inventario_global' | 'pagos' | 'logistica' | 'pos' | 'clientes' | 'personal' | 'cobranza'

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function OwnerDashboard({ 
  role = 'owner', 
  userName = 'Admin System', 
  onLogout 
}: { 
  role?: string, 
  userName?: string, 
  onLogout?: () => void 
}) {
  
  // Establecer vista por defecto según rol
  const getInitialTab = () => {
    switch(role) {
      case 'owner': return 'metricas';
      case 'administracion': return 'pagos';
      case 'almacenista': return 'logistica';
      case 'vendedor': return 'pos';
      default: return 'metricas';
    }
  }

  const [activeTab, setActiveTab] = useState<OwnerTab>(getInitialTab() as OwnerTab)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // Estado para métricas
  const [metricas, setMetricas] = useState<Metricas>({ pendientesRevision: 0, pendientesAlmacen: 0, entregados: 0 })
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [estadoFiltro, setEstadoFiltro] = useState<string>('TODAS')
  const [isGenerating, setIsGenerating] = useState<boolean>(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error', texto: string } | null>(null)

  // Limpieza de Historial Modal
  const [showLimpiarModal, setShowLimpiarModal] = useState(false)
  const [limpiezaRango, setLimpiezaRango] = useState('todo')
  const [isCleaning, setIsCleaning] = useState(false)

  // ============================================================================
  // LÓGICA DE LA PESTAÑA: MÉTRICAS ORIGINAL
  // ============================================================================
  const fetchMetrics = useCallback(async () => {
    if (supabaseUrl === 'https://placeholder.supabase.co') return
    try {
      const { data, error } = await supabase.from('ordenes').select('estado');
      if (error) throw error;
      
      const ordenes = data || [];
      const pendientesRevision = ordenes.filter(o => ['pendiente', 'pendiente_pago', 'esperando_aprobacion'].includes(o.estado?.toLowerCase())).length;
      const pendientesAlmacen = ordenes.filter(o => ['aprobado', 'en_proceso'].includes(o.estado?.toLowerCase())).length;
      const entregados = ordenes.filter(o => o.estado?.toLowerCase() === 'entregado').length;
      
      setMetricas({
        pendientesRevision,
        pendientesAlmacen,
        entregados
      })
    } catch (error) {
      console.error('Error obteniendo métricas:', error)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'metricas' && role === 'owner') {
      fetchMetrics()
      const canalOrdenes = supabase
        .channel('metricas_ordenes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, fetchMetrics)
        .subscribe()
      return () => { supabase.removeChannel(canalOrdenes) }
    }
  }, [activeTab, fetchMetrics, role])
  
  const handleDownloadPDF = async () => {
    setMensaje(null)
    if (!startDate || !endDate) {
      return setMensaje({ tipo: 'error', texto: 'Por favor, selecciona un rango de fechas válido.' })
    }
    setIsGenerating(true)

    try {
      const { data: ordenesData, error: dbError } = await supabase
        .from('ordenes')
        .select(`
          id, estado, total_usd, total_bs, fecha_creacion,
          cliente:clientes!fk_ordenes_cliente ( nombre ),
          vendedor:perfiles!fk_ordenes_vendedor ( nombre ),
          orden_items ( cantidad, productos ( nombre ) )
        `)
        .gte('fecha_creacion', `${startDate}T00:00:00.000Z`)
        .lte('fecha_creacion', `${endDate}T23:59:59.999Z`)
        .order('fecha_creacion', { ascending: false })
        
      let ordenes = (ordenesData as unknown) as OrdenReporte[] | null

      if (dbError) throw new Error(`Fallo consultando BD: ${dbError.message}`)
      if (!ordenes || ordenes.length === 0) throw new Error('No hay órdenes registradas en ese rango de fechas.')

      // Normalización y filtrado por estado
      ordenes = ordenes.filter((orden) => {
        const estadoStr = (orden.estado || '').toLowerCase().trim();
        if (estadoFiltro === 'TODAS') return true;
        if (estadoFiltro === 'APROBADOS') {
          return ['aprobado', 'aprobados', 'aprobadas', 'entregado', 'aprobado_despacho'].includes(estadoStr);
        }
        if (estadoFiltro === 'RECHAZADOS') {
          return ['rechazado', 'rechazados', 'rechazadas', 'cancelado'].includes(estadoStr);
        }
        return estadoStr === estadoFiltro.toLowerCase();
      });

      if (ordenes.length === 0) throw new Error('No hay órdenes que coincidan con el filtro seleccionado.')

      const { default: jsPDF } = await import('jspdf')
      const autoTable = (await import('jspdf-autotable')).default
      const doc = new jsPDF('l', 'pt', 'a4')

      doc.setFontSize(18)
      doc.text('Reporte Ejecutivo de Ventas y Órdenes', 40, 40)
      doc.setFontSize(11)
      doc.setTextColor(100)
      doc.text(`Período: ${startDate} al ${endDate} | Filtro: ${estadoFiltro}`, 40, 60)
      doc.text(`Fecha de emisión: ${new Date().toLocaleString()}`, 40, 75)

      let totalUSD = 0;
      let totalBS = 0;

      const tableColumn = ["ID Orden", "Fecha", "Cliente", "Vendedor", "Productos (Cant.)", "Total USD", "Total BS", "Estado"]
      const tableRows = ordenes.map(orden => {
        totalUSD += Number(orden.total_usd);
        totalBS += Number(orden.total_bs);
        
        const fecha = new Date(orden.fecha_creacion).toLocaleDateString()
        const resumenProductos = orden.orden_items.map(item => `${item.cantidad}x ${item.productos?.nombre || 'N/A'}`).join('\n')
        return [
          orden.id.split('-')[0], fecha, orden.cliente?.nombre || 'Desconocido', orden.vendedor?.nombre || 'Desconocido',
          resumenProductos, `$${orden.total_usd.toFixed(2)}`, `Bs. ${orden.total_bs.toFixed(2)}`, orden.estado.replace('_', ' ')
        ]
      })

      autoTable(doc, {
        head: [tableColumn], 
        body: tableRows, 
        foot: [['', '', '', '', 'TOTALES:', `$${totalUSD.toFixed(2)}`, `Bs. ${totalBS.toFixed(2)}`, '']],
        startY: 90,
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

  const handleLimpiarHistorial = async () => {
    setIsCleaning(true)
    setMensaje(null)
    
    try {
      // Llamar al RPC en Supabase
      const { error } = await supabase.rpc('limpiar_historial_por_rango', { p_rango: limpiezaRango })
      
      if (error) throw new Error(error.message)
      
      setMensaje({ tipo: 'exito', texto: `Historial limpiado exitosamente para el período: ${limpiezaRango}` })
      setShowLimpiarModal(false)
      fetchMetrics()
    } catch (err: any) {
      setMensaje({ tipo: 'error', texto: err.message || 'Error limpiando el historial.' })
    } finally {
      setIsCleaning(false)
    }
  }

  // Helper para items del sidebar
  const SidebarItem = ({ tab, icon: Icon, label }: { tab: OwnerTab, icon: React.ElementType, label: string }) => {
    const isActive = activeTab === tab;
    return (
      <button 
        onClick={() => { setActiveTab(tab); setIsSidebarOpen(false); }}
        className={`w-full ${isActive 
          ? 'bg-indigo-600 text-white font-semibold rounded-2xl shadow-md px-4 py-3 flex items-center gap-3 text-sm transition-all' 
          : 'text-slate-400 hover:bg-slate-900 hover:text-white rounded-xl px-4 py-3 flex items-center gap-3 text-sm font-medium transition-all'}`}
      >
        <Icon className="w-5 h-5" />
        <span>{label}</span>
      </button>
    )
  }

  // ============================================================================
  // RENDER UI/UX SAAS ENTERPRISE (SPLIT LAYOUT)
  // ============================================================================
  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100 font-sans text-slate-800 relative">
      
      {/* SIDEBAR BACKDROP (Móvil) */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 backdrop-blur-sm bg-slate-950/80 z-30 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR LATERAL NAVEGACIÓN */}
      <aside className={`fixed lg:relative top-0 left-0 w-64 h-full bg-slate-950 text-slate-300 flex flex-col justify-between p-4 z-40 shrink-0 transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        
        <div className="flex flex-col h-full">
          {/* Logo Corporativo */}
          <div className="text-white font-bold text-xl flex items-center gap-2 mb-8 px-2 py-4 border-b border-slate-800/80">
            <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md">
              <Crown className="w-4 h-4 text-white" />
            </div>
            <span className="tracking-tight">ERP<span className="text-slate-500 font-medium">|Master</span></span>
          </div>

          {/* Mapeo de Navegación Vertical (Malla de Permisos) */}
          <nav className="flex-1 space-y-2 overflow-y-auto scrollbar-hide pr-2">
            {role === 'owner' && <SidebarItem tab="metricas" icon={BarChart} label="Reportes y Métricas" />}
            
            <SidebarItem tab="inventario_global" icon={Globe} label="Inventario Global" />
            
            {(role === 'owner' || role === 'administracion') && <SidebarItem tab="pagos" icon={ClipboardCheck} label="Monitoreo de Órdenes" />}
            
            {(role === 'owner' || role === 'administracion') && <SidebarItem tab="cobranza" icon={FileText} label="Cuentas por Cobrar" />}
            
            {(role === 'owner' || role === 'almacenista') && <SidebarItem tab="logistica" icon={Truck} label="Logística Despacho" />}
            
            {(role === 'owner' || role === 'vendedor') && <SidebarItem tab="pos" icon={PackageCheck} label="Ordenes" />}
            
            {role === 'owner' && <SidebarItem tab="clientes" icon={Users} label="Clientes" />}
            
            {role === 'owner' && <SidebarItem tab="personal" icon={Briefcase} label="Personal" />}
          </nav>
          
          {/* Pie del Sidebar */}
          <div className="mt-auto pt-4 border-t border-slate-800">
            <p className="text-slate-500 text-xs text-center font-medium">v1.0.0 Enterprise</p>
          </div>
        </div>
      </aside>

      {/* CONTENEDOR PRINCIPAL (RIGHT SIDE) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative w-full">
        
        {/* NAVBAR SUPERIOR */}
        <header className="bg-white h-16 border-b border-slate-200/80 px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm shrink-0">
          {/* Lado Izquierdo */}
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="hidden sm:block text-slate-800 font-semibold text-lg tracking-tight capitalize">
              {activeTab.replace('_', ' ')}
            </h2>
          </div>
          
          {/* Lado Derecho */}
          <div className="flex items-center gap-3 md:gap-5 text-slate-500">
            <button className="hover:text-slate-900 transition-colors p-1.5 hidden sm:block"><Search className="w-5 h-5" /></button>
            <button className="hover:text-slate-900 transition-colors p-1.5 hidden sm:block"><HelpCircle className="w-5 h-5" /></button>
            <button className="relative hover:text-slate-900 transition-colors p-1.5">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 bg-red-500 border-2 border-white rounded-full h-2.5 w-2.5"></span>
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1"></div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-800 leading-tight">{userName}</span>
                <span className="text-[10px] font-bold text-indigo-600 uppercase bg-indigo-50 px-1.5 rounded-md">{role}</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white shadow-sm border border-slate-700">
                <Crown className="w-4 h-4" />
              </div>
              {onLogout && (
                <button 
                  onClick={onLogout}
                  className="ml-2 text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-md transition-colors border border-red-200"
                >
                  Salir
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ÁREA DE TRABAJO SCROLLABLE */}
        <main className="flex-1 h-full overflow-y-auto p-6 md:p-8">
          
          {/* PESTAÑA 1: MÉTRICAS (PROPIO DEL OWNER) */}
          {activeTab === 'metricas' && role === 'owner' && (
            <div className="max-w-6xl mx-auto animate-in fade-in">
              
              {/* Tarjetas Superiores */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                
                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 border border-indigo-100">
                    <BarChart className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Pendientes de Pago</p>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{metricas.pendientesRevision}</h2>
                  </div>
                </div>
                
                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">En Cola Almacén</p>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{metricas.pendientesAlmacen}</h2>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Entregados (Total)</p>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{metricas.entregados}</h2>
                  </div>
                </div>
                
                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-center gap-1">
                   <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Auditoría Global</p>
                   <div className="flex items-center gap-2">
                     <span className="text-xl font-bold text-slate-900 tracking-tight">Activa</span>
                     <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Óptima</span>
                   </div>
                </div>

              </div>

              {/* Generador de Reportes Inferior */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 md:p-8 max-w-5xl">
                <h2 className="text-lg font-semibold text-slate-900 tracking-tight mb-6">Filtros y Reportes Ejecutivos</h2>
                <div className="flex flex-wrap items-end gap-4 w-full">
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Fecha de Inicio</label>
                    <input type="date" className="w-full h-11 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800 bg-white shadow-sm" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Fecha de Fin</label>
                    <input type="date" className="w-full h-11 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800 bg-white shadow-sm" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Filtrar Estado</label>
                    <select className="w-full h-11 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none bg-white text-sm text-slate-800 shadow-sm" value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}>
                      <option value="TODAS">Todas las Órdenes</option>
                      <option value="APROBADOS">Solo Aprobados</option>
                      <option value="RECHAZADOS">Solo Rechazados</option>
                    </select>
                  </div>
                  <div className="flex-none flex gap-2 w-full mt-2 sm:mt-0 sm:w-auto">
                    <button onClick={handleDownloadPDF} disabled={isGenerating} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl shadow-sm transition-all whitespace-nowrap text-sm disabled:opacity-50">
                      {isGenerating ? 'Procesando...' : <><FileText className="w-4 h-4" /> Exportar PDF</>}
                    </button>
                    <button onClick={() => setShowLimpiarModal(true)} disabled={isGenerating} className="flex-none flex items-center justify-center gap-2 px-5 h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg shadow-sm transition-all whitespace-nowrap text-sm disabled:opacity-50" title="Vaciar historial">
                      <Trash2 className="w-4 h-4" /> 
                    </button>
                  </div>
                </div>
                {mensaje && <div className={`mt-6 p-4 rounded-xl text-sm font-medium border ${mensaje.tipo === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{mensaje.texto}</div>}
              </div>
            </div>
          )}

          {/* RENDERING DINÁMICO DE MÓDULOS DEL RESTO DE LA APP */}
          {activeTab === 'inventario_global' && <div className="animate-in fade-in h-full"><GlobalInventory hideHeader={true} /></div>}
          {activeTab === 'pagos' && (role === 'owner' || role === 'administracion') && <div className="animate-in fade-in h-full -m-4 md:-m-6 lg:-m-8"><AdminDashboard hideTabs={true} /></div>}
          {activeTab === 'cobranza' && (role === 'owner' || role === 'administracion') && <div className="animate-in fade-in h-full -m-4 md:-m-6 lg:-m-8"><AdminDashboard hideTabs={true} defaultTab="cobranza" /></div>}
          {activeTab === 'logistica' && (role === 'owner' || role === 'almacenista') && <div className="animate-in fade-in h-full -m-4 md:-m-6 lg:-m-8"><AlmacenDashboard /></div>}
          {activeTab === 'pos' && (role === 'owner' || role === 'vendedor') && <div className="animate-in fade-in h-full -m-4 md:-m-6 lg:-m-8"><VendedorPOS /></div>}
          {activeTab === 'personal' && role === 'owner' && <div className="animate-in fade-in h-full -m-4 md:-m-6 lg:-m-8"><UserManagement /></div>}
          {activeTab === 'clientes' && role === 'owner' && <div className="animate-in fade-in h-full -m-4 md:-m-6 lg:-m-8"><ClientsManager /></div>}
          
        </main>
      </div>

      {/* Modal de Limpieza de Historial (Restaurado intacto en lógica y mejorado visualmente) */}
      {showLimpiarModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-white">
              <h3 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-2"><Trash2 className="w-5 h-5 text-slate-500" /> Limpiar Historial</h3>
              <button type="button" onClick={() => setShowLimpiarModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-6 space-y-5 bg-white">
              <div className="bg-amber-50 border border-amber-200 text-amber-700 p-4 font-medium text-sm leading-relaxed rounded-xl shadow-sm">
                Advertencia: Esta acción eliminará permanentemente los registros de órdenes (y sus detalles) con estado entregado, cancelado o rechazado del período seleccionado.
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-900 mb-3">Selecciona el período a eliminar:</label>
                
                <label className="flex items-center gap-3 p-3.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                  <input type="radio" name="rango" value="dia" checked={limpiezaRango === 'dia'} onChange={() => setLimpiezaRango('dia')} className="w-4 h-4 text-slate-900 focus:ring-slate-900" />
                  <span className="font-medium text-slate-700 text-sm">Órdenes de hace más de 1 Día</span>
                </label>
                
                <label className="flex items-center gap-3 p-3.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                  <input type="radio" name="rango" value="semana" checked={limpiezaRango === 'semana'} onChange={() => setLimpiezaRango('semana')} className="w-4 h-4 text-slate-900 focus:ring-slate-900" />
                  <span className="font-medium text-slate-700 text-sm">Órdenes de hace más de 1 Semana</span>
                </label>
                
                <label className="flex items-center gap-3 p-3.5 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                  <input type="radio" name="rango" value="mes" checked={limpiezaRango === 'mes'} onChange={() => setLimpiezaRango('mes')} className="w-4 h-4 text-slate-900 focus:ring-slate-900" />
                  <span className="font-medium text-slate-700 text-sm">Órdenes de hace más de 1 Mes</span>
                </label>

                <label className="flex items-center gap-3 p-3.5 border border-rose-200 bg-rose-50/50 rounded-xl cursor-pointer hover:bg-rose-50 transition-colors">
                  <input type="radio" name="rango" value="todo" checked={limpiezaRango === 'todo'} onChange={() => setLimpiezaRango('todo')} className="w-4 h-4 text-rose-600 focus:ring-rose-600" />
                  <span className="font-medium text-rose-700 text-sm">Todo el Historial Antiguo</span>
                </label>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setShowLimpiarModal(false)} className="px-4 h-11 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-colors text-sm">
                  Cancelar
                </button>
                <button onClick={handleLimpiarHistorial} disabled={isCleaning} className="px-5 h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-xl shadow-md transition-colors disabled:opacity-50 flex items-center gap-2 text-sm">
                  {isCleaning ? 'Borrando...' : 'Confirmar Eliminación'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
