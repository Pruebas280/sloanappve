'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, XCircle, FileText, X, Clock, Trash2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'

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
  // comprobante_pago_url removed
  modalidad_pago?: string
  dias_credito?: number
  inicial_monto?: number
  condicion_entrega?: string
  direccion_envio?: string
  vendedor_id?: string
  fecha_actualizacion?: string
  clientes: { nombre: string; cedula_rif: string; direccion?: string; telefono?: string } | null
  usuarios: { nombre: string } | null // Vendedor
  detalles_orden: {
    cantidad: number
    producto_id: string
    precio_unitario_usd: number
    productos: { nombre: string; sku?: string } | null
  }[]
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
interface AdminDashboardProps {
  hideTabs?: boolean
  defaultTab?: string // Mantenido por retrocompatibilidad, ignorado internamente
}

export default function AdminDashboard({ hideTabs = false, defaultTab: defaultTabProp = 'ordenes' }: AdminDashboardProps = {}) {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const defaultTab = searchParams.get('tab') || defaultTabProp
  
  // Estados de UI
  const [ordenes, setOrdenes] = useState<OrdenAdmin[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [modalImage, setModalImage] = useState<string | null>(null)
  
  // Tab control
  const [activeTab, setActiveTab] = useState<'ordenes' | 'auditoria' | 'cobranza' | 'historial_pagos'>((defaultTab as 'ordenes' | 'auditoria' | 'cobranza' | 'historial_pagos') || 'ordenes')

  // Rechazo Modal
  const [showRechazoModal, setShowRechazoModal] = useState(false)
  const [ordenRechazoId, setOrdenRechazoId] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState('')

  // Compatibilidad TS para requerimientos estrictos del usuario
  const fetchProductos: any = undefined;
  const fetchOrdenes: any = undefined;
  const setProductos: any = undefined;

  // Devolución Modal
  const [showDevolucionModal, setShowDevolucionModal] = useState(false)
  const [ordenDevolucionId, setOrdenDevolucionId] = useState<string | null>(null)
  const [motivoDevolucion, setMotivoDevolucion] = useState('')

  // Reversión Modal
  const [showReversionModal, setShowReversionModal] = useState(false)
  const [ordenReversionId, setOrdenReversionId] = useState<string | null>(null)
  const [motivoReversion, setMotivoReversion] = useState('')

  // Limpieza de Pagos Modal
  const [showLimpiarPagosModal, setShowLimpiarPagosModal] = useState(false)
  const [pagoALimpiarId, setPagoALimpiarId] = useState<string | null>(null)

  // Auditoria
  const [productosAuditoria, setProductosAuditoria] = useState<any[]>([])

  // Cuentas por Cobrar & Pagos Procesados
  const [cuentasCobrar, setCuentasCobrar] = useState<OrdenAdmin[]>([])
  const [pagosProcesados, setPagosProcesados] = useState<OrdenAdmin[]>([])

  // ============================================================================
  // CARGA DE DATOS
  // ============================================================================
  const fetchCuentasCobrar = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .select('*, clientes ( nombre, cedula_rif, direccion, telefono ), detalles_orden ( *, productos ( nombre, sku ) )')
        .eq('modalidad_pago', 'Crédito')
        .in('estado', ['pendiente', 'aprobado', 'entregado', 'pendiente_pago', 'esperando_aprobacion'])
        .order('fecha_creacion', { ascending: false })
      if (error) throw error
      setCuentasCobrar(data as unknown as OrdenAdmin[])
    } catch (err: any) {
      console.error('Error cargando cuentas por cobrar:', err)
    }
  }, [supabase])

  const fetchPagosProcesados = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .select('*, clientes ( nombre, cedula_rif, direccion, telefono ), detalles_orden ( *, productos ( nombre, sku ) )')
        .eq('estado', 'pagado')
        .order('fecha_creacion', { ascending: false })
      if (error) throw error
      setPagosProcesados(data as unknown as OrdenAdmin[])
    } catch (err: any) {
      console.error('Error cargando pagos procesados:', err)
    }
  }, [supabase])

  const fetchOrdenesPendientes = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .select(`
          *,
          clientes ( nombre, cedula_rif, direccion ),
          usuarios!vendedor_id ( nombre ),
          detalles_orden ( *, productos ( nombre, sku ) )
        `)
        .neq('estado', 'cancelado')
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
    fetchCuentasCobrar()
    fetchPagosProcesados()

    // Realtime subscription
    const channel = supabase
      .channel('ordenes-admin-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => {
        fetchOrdenesPendientes()
        fetchCuentasCobrar()
        fetchPagosProcesados()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchOrdenesPendientes, fetchCuentasCobrar, fetchPagosProcesados, supabase])

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
      setOrdenes(prev => prev.filter(o => o.id !== cleanId));

      // 3. Traer el inventario actualizado directamente de Supabase para reflejar el nuevo stock_disponible
      const { data: productosActualizados } = await supabase.from('productos').select('*');
      if (productosActualizados && typeof setProductos === 'function') {
        setProductos(productosActualizados);
      }

      // 4. Refrescar datos generales
      if (typeof fetchProductos === 'function') await fetchProductos();
      if (typeof fetchOrdenes === 'function') await fetchOrdenes();

      // Refrescos reales (retrocompatibilidad)
      if (typeof fetchOrdenesPendientes === 'function') await fetchOrdenesPendientes();
      if (typeof fetchAuditoria === 'function') await fetchAuditoria();

    } catch (err) {
      console.error("Excepción en anulación:", err);
    }
  }

  const confirmarRechazoAdmin = async () => {
    if (!ordenRechazoId || !motivoRechazo.trim()) return
    setIsLoading(true)
    try {
      await handleAnularOBorrarOrden(ordenRechazoId)
      alert('Orden rechazada exitosamente')
      setShowRechazoModal(false)
    } catch (err: any) {
      alert("Error al rechazar: " + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const confirmarDevolucion = async () => {
    if (!ordenDevolucionId || !motivoDevolucion.trim()) return
    setIsLoading(true)
    try {
      await handleAnularOBorrarOrden(ordenDevolucionId)
      alert('Orden devuelta y stock reintegrado.')
      setShowDevolucionModal(false)
    } catch (err: any) {
      alert("Error al devolver orden: " + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const confirmarReversion = async () => {
    if (!ordenReversionId || !motivoReversion.trim()) return
    setIsLoading(true)
    try {
      const ordenObj = ordenes.find(o => o.id === ordenReversionId)
      if (!ordenObj) throw new Error("Orden no encontrada localmente")

      const oldEstado = ordenObj.estado.toLowerCase()
      // Si la orden estaba rechazada/cancelada, el stock se habia reintegrado al almacen.
      // Al devolverla a pendiente, hay que RESTAR el stock nuevamente.
      if (['rechazado', 'rechazado_en_entrega', 'cancelado'].includes(oldEstado)) {
        if (ordenObj.detalles_orden) {
          for (const item of ordenObj.detalles_orden) {
            const { data: prodData } = await supabase.from('productos').select('stock_disponible').eq('id', (item as any).producto_id).single()
            if (prodData) {
              await supabase.from('productos').update({
                stock_disponible: prodData.stock_disponible - item.cantidad
              }).eq('id', (item as any).producto_id)
            }
          }
        }
      }

      // Se usa motivo_rechazo como columna para almacenar la observación de devolución/reversión
      const { error } = await supabase.from('ordenes').update({ 
        estado: 'pendiente', 
        motivo_rechazo: motivoReversion 
      }).eq('id', ordenReversionId)
      
      if (error) throw error

      await fetchOrdenesPendientes()
      alert('Orden devuelta al flujo activo correctamente')
      setShowReversionModal(false)
    } catch (err: any) {
      alert("Error al revertir orden: " + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const confirmarLimpiarPago = async () => {
    setIsLoading(true)
    try {
      if (pagoALimpiarId) {
        await supabase.from('ordenes').delete().eq('id', pagoALimpiarId)
      } else {
        // Como la tabla de pagos es "ordenes" (con estado="pagado"), 
        // agregamos el eq('estado', 'pagado') para no borrar toda la base de datos de órdenes.
        await supabase.from('ordenes').delete().eq('estado', 'pagado').neq('id', '00000000-0000-0000-0000-000000000000')
      }
      setPagosProcesados([])
      await fetchPagosProcesados()
      setShowLimpiarPagosModal(false)
      alert('Historial de pagos limpiado')
    } catch (err: any) {
      alert("Error al limpiar pagos: " + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleVaciarHistorialPagos() {
    if (!confirm("¿Deseas vaciar todo el historial de órdenes y devolver el stock?")) return;

    try {
      await supabase.from('ordenes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      
      setOrdenes([]);
      if (typeof fetchProductos === 'function') await fetchProductos();
      if (typeof fetchOrdenes === 'function') await fetchOrdenes();

      // Refrescos reales de la interfaz
      if (typeof fetchOrdenesPendientes === 'function') await fetchOrdenesPendientes();
      if (typeof fetchPagosProcesados === 'function') await fetchPagosProcesados();
    } catch (e) {
      console.error("Error al vaciar historial:", e);
    }
  }

  const fetchAuditoria = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('productos').select('*').order('stock_disponible', { ascending: true })
      if (data) setProductosAuditoria(data)
    } catch (e) {
      console.error(e)
    }
  }, [supabase])

  const marcarComoPagado = async (ordenId: string) => {
    try {
      const { error } = await supabase.from('ordenes').update({ estado: 'pagado' }).eq('id', ordenId)
      if (error) throw error
      alert('Orden marcada como pagada.')
      fetchCuentasCobrar()
      fetchPagosProcesados()
    } catch(err:any) {
      alert('Error marcando orden pagada: ' + err.message)
    }
  }

  // ============================================================================
  useEffect(() => {
    if (activeTab === 'auditoria') {
      fetchAuditoria()
    }
    if (activeTab === 'historial_pagos') {
      fetchPagosProcesados()
    }
  }, [activeTab, fetchAuditoria, fetchPagosProcesados])

  // ============================================================================
  // GENERADOR DE PDF CORPORATIVO (SLOAN/Fluidmaster)
  // ============================================================================
  const generarPDF = async (orden: OrdenAdmin) => {
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = (await import('jspdf-autotable')).default
      
      const doc = new jsPDF('p', 'pt', 'a4')

      // Fondo Superior (Azul Claro pastel)
      doc.setFillColor(224, 242, 254)
      doc.rect(0, 0, 600, 100, 'F')

      // 1. Cabecera Corporativa
      doc.setFontSize(22)
      doc.setTextColor(2, 132, 199) // Azul Rey brillante
      doc.text('NOTA DE ENTREGA / DELIVERY NOTE', 40, 50)
      
      doc.setFontSize(10)
      doc.setTextColor(100)
      doc.text('Rif: J-12345678-9 | Telf: +58 412-1234567', 40, 65)
      doc.text('Av. Principal, Edificio Empresarial, PB.', 40, 78)

      // Cuadro de Número de Orden
      doc.setFillColor(2, 132, 199) // Azul Océano
      doc.roundedRect(400, 35, 150, 45, 5, 5, 'F')
      doc.setFontSize(12)
      doc.setTextColor(255, 255, 255)
      doc.text('ORDER No.', 410, 52)
      doc.setFontSize(14)
      doc.text(`N°: ${orden.id.split('-')[0].toUpperCase()}`, 410, 70)

      // 2. Datos del Cliente y Vendedor
      doc.setFontSize(11)
      doc.setTextColor(0)
      doc.text(`Cliente: ${orden.clientes?.nombre || 'N/A'}`, 40, 110)
      doc.text(`RIF / CI: ${orden.clientes?.cedula_rif || 'N/A'}`, 40, 125)
      
      const dirFiscal = orden.clientes?.direccion || 'No especificada'
      doc.text(`Dir. Fiscal: ${dirFiscal}`, 40, 140, { maxWidth: 300 })
      
      let dirY = 155
      if (orden.direccion_envio && orden.direccion_envio !== dirFiscal) {
        doc.text(`Dir. Envío: ${orden.direccion_envio}`, 40, dirY, { maxWidth: 300 })
        dirY += 15
      }
      
      doc.text(`Condición: ${orden.condicion_entrega || 'Retiro'}`, 40, dirY)
      
      doc.text(`Fecha: ${new Date(orden.fecha_creacion || orden.creado_en || Date.now()).toLocaleDateString()}`, 400, 110)
      doc.text(`Ejecutivo: ${orden.usuarios?.nombre || 'N/A'}`, 400, 125)
      doc.text(`Pago: ${orden.metodo_pago}`, 400, 140)
      
      const isCredito = orden.modalidad_pago === 'Crédito'
      if (isCredito) doc.setFontSize(8)
      doc.text(isCredito ? `Modalidad: CRÉDITO | Inicial: $${Number(orden.inicial_monto || 0).toFixed(2)} | Plazo: ${orden.dias_credito} Días` : `Modalidad: CONTADO`, 400, 155)
      if (isCredito) doc.setFontSize(11) // Restore font size
      
      doc.text(`Estado: ${orden.estado.toUpperCase()}`, 400, 170)

      // 3. Tabla de Productos
      const tableColumn = ["Cant.", "Código/SKU", "Descripción", "P.U USD", "Total USD"]
      const tableRows = (orden.detalles_orden || []).map(item => [
        item.cantidad,
        item.productos?.sku || 'N/A',
        item.productos?.nombre || 'Producto',
        `$${Number(item.precio_unitario_usd || 0).toFixed(2)}`,
        `$${(item.cantidad * Number(item.precio_unitario_usd || 0)).toFixed(2)}`
      ])

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 185,
        styles: { fontSize: 10, cellPadding: 5, lineColor: [224, 242, 254], lineWidth: 0.5 },
        headStyles: { fillColor: [2, 132, 199], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [240, 249, 255] },
        columnStyles: {
          0: { cellWidth: 40, halign: 'center' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold' }
        }
      })

      // 4. Desglose al pie (Totales)
      const finalY = (doc as any).lastAutoTable?.finalY || 170
      
      const totalUSD = Number(orden.total_usd || 0)
      const baseImponible = totalUSD / 1.16
      const iva = totalUSD - baseImponible

      doc.setFontSize(10)
      doc.setTextColor(100)
      
      // Términos en margen izquierdo (X=40 -> ~14mm)
      doc.text('Términos: Los pagos deben confirmarse antes del despacho.', 40, finalY + 30, { maxWidth: 200 })
      
      const totalsRows = [
        ['Base Imponible:', `$${baseImponible.toFixed(2)}`],
        ['IVA (16%):', `$${iva.toFixed(2)}`],
        ['Flete:', '$0.00'],
        ['TOTAL GENERAL:', `$${totalUSD.toFixed(2)}`]
      ]

      autoTable(doc, {
        body: totalsRows,
        startY: finalY + 15,
        margin: { left: 325 }, // ~115mm
        theme: 'plain',
        styles: { fontSize: 11, cellPadding: 6, textColor: [0, 0, 0] },
        columnStyles: {
          0: { halign: 'left' },
          1: { halign: 'right' }
        },
        didParseCell: function(data: any) {
          if (data.row.index === 3) {
            data.cell.styles.fillColor = [224, 242, 254] // #E0F2FE
            data.cell.styles.textColor = [2, 132, 199]   // #0284C7
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.fontSize = 13
          }
        }
      })

      // 5. Línea de firma y Pie de página final
      doc.setDrawColor(186, 230, 253) // Azul pastel suave
      doc.line(40, finalY + 70, 240, finalY + 70)
      doc.setTextColor(100)
      doc.setFontSize(10)
      doc.text('Firma de Conformidad / Signature', 40, finalY + 85)

      const pageHeight = doc.internal.pageSize.getHeight()
      const footerY = pageHeight - 50
      doc.setFillColor(224, 242, 254)
      doc.rect(0, footerY, 600, 50, 'F')
      
      doc.setFontSize(9)
      doc.setTextColor(100)
      doc.text('Sistema ERP Master | Documento generado automáticamente.', 40, footerY + 25)
      doc.text(`Impreso: ${new Date().toLocaleString()}`, 400, footerY + 25)

      doc.save(`Orden_${orden.id.split('-')[0]}.pdf`)
    } catch (err: any) {
      alert("Error generando PDF: " + err.message)
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
        <button 
          onClick={() => setActiveTab('ordenes')}
          className={`flex-1 py-3 text-center font-medium text-sm transition-colors ${activeTab === 'ordenes' ? 'text-slate-900 border-b-2 border-slate-900 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Órdenes y Validaciones
        </button>
        <button 
          onClick={() => { setActiveTab('auditoria'); fetchAuditoria(); }}
          className={`flex-1 py-3 text-center font-medium text-sm transition-colors ${activeTab === 'auditoria' ? 'text-slate-900 border-b-2 border-slate-900 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Auditoría e Inventario
        </button>
        <button 
          onClick={() => setActiveTab('cobranza')}
          className={`flex-1 py-3 text-center font-medium text-sm transition-colors ${activeTab === 'cobranza' ? 'text-slate-900 border-b-2 border-slate-900 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Cuentas por Cobrar
        </button>
        <button 
          onClick={() => { setActiveTab('historial_pagos'); fetchPagosProcesados(); }}
          className={`flex-1 py-3 text-center font-medium text-sm transition-colors ${activeTab === 'historial_pagos' ? 'text-slate-900 border-b-2 border-slate-900 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Historial de Pagos
        </button>
      </div>
      )}

      <main className="p-6 md:p-8 flex-1 overflow-y-auto">
        {activeTab === 'ordenes' ? (
        
        <div className="space-y-6 max-w-7xl mx-auto">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-slate-700">Monitoreo Global de Órdenes ({ordenes.length})</h2>
            <button 
              onClick={handleVaciarHistorialPagos}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded shadow mb-4"
            >
              🗑️ Vaciar Historial de Pagos
            </button>
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
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-5 bg-slate-50/80 flex flex-col gap-3 border-t border-slate-100">
                    <button 
                      onClick={() => generarPDF(orden)}
                      className="flex items-center justify-center gap-2 w-full py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-all shadow-sm text-sm"
                    >
                      <FileText className="w-4 h-4" /> Descargar PDF
                    </button>

                    <div className="pt-2 flex justify-end border-t border-slate-100">
                      <button 
                        onClick={async () => {
                          if (confirm('¿Borrar orden de la vista?')) {
                            await supabase.from('ordenes').delete().eq('id', orden.id);
                            fetchOrdenesPendientes();
                          }
                        }}
                        className="text-slate-400 hover:text-red-500 transition p-1"
                        title="Borrar de la vista"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        ) : activeTab === 'auditoria' ? (
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-700">Auditoría de Inventario</h2>
              <button 
                onClick={() => {
                  alert('Exportación de inventario en construcción (simulada).')
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 shadow-sm"
              >
                <FileText className="w-4 h-4" /> Exportar Inventario PDF
              </button>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-6 py-4 font-semibold">SKU</th>
                    <th className="px-6 py-4 font-semibold">Producto</th>
                    <th className="px-6 py-4 font-semibold text-right">Precio USD</th>
                    <th className="px-6 py-4 font-semibold text-center">Disponible</th>
                    <th className="px-6 py-4 font-semibold text-center">Reservado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productosAuditoria.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-500">{p.sku}</td>
                      <td className="px-6 py-4 font-semibold text-slate-900">{p.nombre}</td>
                      <td className="px-6 py-4 text-right text-slate-700 font-medium">${p.precio_usd.toFixed(2)}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${p.stock_disponible > 5 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {p.stock_disponible}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                          {p.stock_reservado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'cobranza' ? (
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-700">Cuentas por Cobrar (Créditos)</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {cuentasCobrar.map(orden => {
                const fechaTope = new Date(orden.creado_en || orden.fecha_creacion || Date.now())
                fechaTope.setDate(fechaTope.getDate() + (orden.dias_credito || 0))
                const diasRestantes = Math.ceil((fechaTope.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                
                const inicial = Number(orden.inicial_monto || 0);
                const total = Number(orden.total_usd || 0);
                const montoPendiente = (orden as any).saldo_pendiente !== null && (orden as any).saldo_pendiente !== undefined 
                  ? Number((orden as any).saldo_pendiente) 
                  : (total - inicial);

                const telefonoLimpio = orden.clientes?.telefono ? String(orden.clientes.telefono) : 'No registrado';

                let semaforoClase = 'bg-green-100 border-green-500 text-green-800'
                let estadoSemaforo = 'AL DÍA'
                
                if (diasRestantes < 0) {
                  semaforoClase = 'bg-red-100 border-red-500 text-red-800'
                  estadoSemaforo = 'VENCIDO'
                } else if (diasRestantes <= 3) {
                  semaforoClase = 'bg-yellow-100 border-yellow-500 text-yellow-800'
                  estadoSemaforo = 'POR VENCER'
                }

                return (
                  <div key={orden.id} className={`rounded-xl shadow-sm border-l-4 overflow-hidden flex flex-col transition-shadow ${semaforoClase}`}>
                    <div className="p-5 bg-white flex-1">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <span className="text-xs font-bold text-slate-400 block mb-0.5 tracking-wide">SALDO A CANCELAR</span>
                          <span className="font-black text-slate-900 text-2xl">
                            ${montoPendiente.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`px-2 py-1 rounded text-xs font-bold shadow-sm ${semaforoClase}`}>
                            {estadoSemaforo}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">ORD-{orden.id.split('-')[0].toUpperCase()}</span>
                        </div>
                      </div>

                      <div className="space-y-1 mb-4 text-xs">
                        <p className="text-slate-600"><span className="font-bold text-slate-800">Cliente:</span> {orden.clientes?.nombre}</p>
                        <p className="text-slate-600"><span className="font-bold text-slate-800">RIF/CI:</span> {orden.clientes?.cedula_rif}</p>
                        <p className="text-slate-600"><span className="font-bold text-slate-800">Teléfono:</span> {telefonoLimpio}</p>
                        <p className="text-slate-600"><span className="font-bold text-slate-800">Dir. Fiscal:</span> {orden.clientes?.direccion || 'N/A'}</p>
                        {orden.direccion_envio && (
                          <p className="text-slate-600"><span className="font-bold text-slate-800">Envío:</span> {orden.direccion_envio}</p>
                        )}
                        <p className="text-slate-600"><span className="font-bold text-slate-800">Límite:</span> {fechaTope.toLocaleDateString()} ({diasRestantes} días)</p>
                      </div>

                      <details className="mb-4 group">
                        <summary className="text-xs font-bold text-blue-600 cursor-pointer hover:text-blue-700 select-none list-none flex items-center gap-1">
                          <span className="transition group-open:rotate-90">▶</span> Ver desglose de productos
                        </summary>
                        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                          {(orden.detalles_orden && orden.detalles_orden.length > 0) ? orden.detalles_orden.map((detalle, idx) => (
                            <div key={idx} className="flex justify-between items-center text-xs text-slate-600 bg-slate-50 p-1.5 rounded">
                              <div className="flex gap-2">
                                <span className="font-bold">{detalle.cantidad}x</span>
                                <span className="truncate max-w-[120px]">{detalle.productos?.nombre || 'Producto'}</span>
                              </div>
                              <span className="font-medium">${(detalle.cantidad * Number(detalle.precio_unitario_usd || 0)).toFixed(2)}</span>
                            </div>
                          )) : (
                            <p className="text-xs text-slate-400 italic">Sin desglose de productos disponible.</p>
                          )}
                        </div>
                      </details>
                      
                      <button 
                        onClick={() => marcarComoPagado(orden.id)}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-2 rounded-lg text-sm transition-colors"
                      >
                        Marcar como Pagado
                      </button>
                    </div>
                  </div>
                )
              })}
              {cuentasCobrar.length === 0 && (
                <div className="col-span-full p-8 text-center text-slate-500 font-medium">
                  No hay cuentas por cobrar pendientes.
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'historial_pagos' ? (
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-700">Historial de Pagos Procesados</h2>
              <button 
                onClick={() => { setPagoALimpiarId(null); setShowLimpiarPagosModal(true); }}
                className="flex items-center gap-2 bg-rose-50 text-rose-600 px-4 py-2 rounded-lg font-medium hover:bg-rose-100 border border-rose-200 transition-colors text-sm"
              >
                <Trash2 className="w-4 h-4" /> Vaciar Historial Completo
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pagosProcesados.map(orden => (
                <div key={orden.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                  <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex justify-between items-center">
                    <span className="text-emerald-700 font-bold text-sm">PAGADO</span>
                    <span className="text-xs font-bold text-slate-500">ORD-{orden.id.split('-')[0].toUpperCase()}</span>
                  </div>
                  <div className="p-5 flex-1">
                    <p className="text-2xl font-black text-slate-900 mb-4">${Number(orden.total_usd || 0).toFixed(2)}</p>
                    <div className="space-y-1 text-sm mb-4">
                      <p className="text-slate-600"><span className="font-bold">Cliente:</span> {orden.clientes?.nombre}</p>
                      <p className="text-slate-600"><span className="font-bold">Vendedor:</span> {orden.vendedor_id}</p>
                      <p className="text-slate-600"><span className="font-bold">Fecha:</span> {new Date(orden.fecha_actualizacion || Date.now()).toLocaleDateString()}</p>
                    </div>
                    <button 
                      onClick={() => { setPagoALimpiarId(orden.id); setShowLimpiarPagosModal(true); }}
                      className="w-full flex justify-center items-center gap-2 bg-white border border-slate-300 text-slate-600 font-medium py-2 rounded-lg hover:bg-slate-50 transition-colors text-sm"
                    >
                      <Trash2 className="w-4 h-4" /> Eliminar Pago
                    </button>
                  </div>
                </div>
              ))}
              {pagosProcesados.length === 0 && (
                <div className="col-span-full p-8 text-center text-slate-500 font-medium">
                  No hay pagos procesados en el historial.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>

      {/* Modal de Rechazo Admin */}
      {showRechazoModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-red-100 flex justify-between items-center bg-red-50">
              <h3 className="text-lg font-semibold text-red-900 tracking-tight flex items-center gap-2">
                <XCircle className="w-5 h-5" /> Rechazar Orden
              </h3>
              <button onClick={() => setShowRechazoModal(false)} className="text-red-400 hover:text-red-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-6 space-y-5 bg-white">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
                Al confirmar, el inventario reservado regresará automáticamente al stock disponible y la orden quedará anulada.
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Motivo del Rechazo</label>
                <textarea 
                  className="w-full p-3 rounded-xl border border-slate-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none text-sm text-slate-800 bg-slate-50 transition-colors resize-none"
                  rows={4}
                  value={motivoRechazo}
                  onChange={(e) => setMotivoRechazo(e.target.value)}
                  required
                ></textarea>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 rounded-b-xl">
              <button 
                onClick={() => setShowRechazoModal(false)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmarRechazoAdmin}
                disabled={isLoading || !motivoRechazo.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                Confirmar Rechazo
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Visor de Devolución */}
      {showDevolucionModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full flex flex-col shadow-xl border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-xl">
              <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                <XCircle className="w-5 h-5 text-orange-600" /> 
                Devolver Orden
              </h3>
              <button onClick={() => setShowDevolucionModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 mb-4 font-medium">
                Esta acción cancelará la orden y reintegrará el stock de los productos. Por favor, indique el motivo o la observación de la devolución:
              </p>
              <textarea
                value={motivoDevolucion}
                onChange={e => setMotivoDevolucion(e.target.value)}
                placeholder="Ej. El cliente se arrepintió, producto equivocado..."
                className="w-full h-24 p-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none resize-none text-sm font-medium text-slate-700 shadow-sm"
                required
              />
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 rounded-b-xl">
              <button 
                onClick={() => setShowDevolucionModal(false)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
              >
                Atrás
              </button>
              <button 
                onClick={confirmarDevolucion}
                disabled={isLoading || !motivoDevolucion.trim()}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                Confirmar Devolución
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Visor de Reversión */}
      {showReversionModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full flex flex-col shadow-xl border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-xl">
              <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-indigo-600" /> 
                Revertir Orden
              </h3>
              <button onClick={() => setShowReversionModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 mb-4 font-medium">
                Esta acción devolverá la orden al flujo activo (Pendiente) y ajustará el stock si es necesario. Indique el motivo de la corrección:
              </p>
              <textarea
                value={motivoReversion}
                onChange={e => setMotivoReversion(e.target.value)}
                placeholder="Ej. Error al entregar, Cliente solicita reabrir..."
                className="w-full h-24 p-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none resize-none text-sm font-medium text-slate-700 shadow-sm"
                required
              />
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 rounded-b-xl">
              <button 
                onClick={() => setShowReversionModal(false)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmarReversion}
                disabled={isLoading || !motivoReversion.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                Confirmar Reversión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Limpiar Historial de Pagos */}
      {showLimpiarPagosModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full flex flex-col shadow-xl border border-slate-200">
            <div className="p-5 border-b border-rose-100 flex justify-between items-center bg-rose-50 rounded-t-xl">
              <h3 className="font-bold text-rose-900 text-lg flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-600" /> 
                Confirmar Limpieza
              </h3>
              <button onClick={() => setShowLimpiarPagosModal(false)} className="text-rose-400 hover:text-rose-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 bg-white">
              <p className="text-sm text-slate-600 font-medium">
                {pagoALimpiarId 
                  ? '¿Estás seguro de eliminar este pago procesado? Esta acción borrará la orden de la base de datos de manera definitiva.' 
                  : '¿Estás seguro de eliminar TODOS los pagos procesados del historial? Esta acción borrará todas las órdenes pagadas de la base de datos y no se puede deshacer.'}
              </p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 rounded-b-xl">
              <button 
                onClick={() => setShowLimpiarPagosModal(false)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmarLimpiarPago}
                disabled={isLoading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
