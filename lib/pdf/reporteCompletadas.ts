import type { OrdenAdmin } from '@/lib/services/ordenes'

/** Reporte de órdenes completadas (el mismo que generaba AdminDashboard). Si falla, lanza el error */
export async function descargarReporteCompletadas(ordenesCompletadas: OrdenAdmin[]) {
  const { default: jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF('p', 'pt', 'a4')

  doc.setFontSize(18)
  doc.setTextColor(15, 23, 42)
  doc.text('Reporte de Órdenes Completadas', 40, 50)

  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Fecha de emisión: ${new Date().toLocaleString()}`, 40, 65)
  doc.text(`Total Órdenes: ${ordenesCompletadas.length}`, 40, 80)

  const tableData = ordenesCompletadas.map(o => [
    o.id.split('-')[0].toUpperCase(),
    new Date(o.fecha_creacion || o.creado_en || Date.now()).toLocaleDateString(),
    o.clientes?.nombre || 'N/A',
    o.usuarios?.nombre || 'N/A',
    o.estado.toUpperCase().replace('_', ' '),
    `$${Number(o.total_usd).toFixed(2)}`
  ])

  autoTable(doc, {
    startY: 100,
    head: [['Orden', 'Fecha', 'Cliente', 'Vendedor', 'Estado', 'Total USD']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229] },
  })

  const totalGeneral = ordenesCompletadas.reduce((sum, o) => sum + Number(o.total_usd), 0)

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 100
  doc.setFontSize(12)
  doc.setTextColor(0)
  doc.text(`Total General USD: $${totalGeneral.toFixed(2)}`, 40, finalY + 30)

  doc.save(`Reporte_Completadas_${new Date().getTime()}.pdf`)
}
