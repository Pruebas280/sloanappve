import type { Producto } from '@/lib/domain/productos'

/** Reporte de inventario (el mismo que generaba GlobalInventory) de los productos que se le pasen. Si falla, lanza el error */
export async function descargarInventarioPDF(productos: Producto[]) {
  const { default: jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF('p', 'pt', 'a4')

  doc.setFillColor(224, 242, 254)
  doc.rect(0, 0, 600, 80, 'F')
  doc.setFontSize(22)
  doc.setTextColor(2, 132, 199)
  doc.text('REPORTE DE INVENTARIO', 40, 45)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Fecha de generación: ${new Date().toLocaleString()}`, 40, 65)

  const tableColumn = ["Código / ID", "Nombre del Producto", "Precio USD", "Stock Actual", "Estado"]
  const tableRows = productos.map(p => [
    p.sku || p.id.split('-')[0],
    p.nombre,
    `$${Number(p.precio_usd || 0).toFixed(2)}`,
    p.stock_disponible,
    p.activo ? 'Activo' : 'Inactivo'
  ])

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: 100,
    styles: { fontSize: 9, cellPadding: 5, lineColor: [224, 242, 254], lineWidth: 0.5 },
    headStyles: { fillColor: [2, 132, 199], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [240, 249, 255] },
    columnStyles: {
      0: { cellWidth: 100 }, // ~35mm
      // 1 is Auto
      2: { cellWidth: 85, halign: 'right' }, // ~30mm
      3: { cellWidth: 70, halign: 'center' }, // ~25mm
      4: { cellWidth: 70, halign: 'center' }  // ~25mm
    }
  })

  doc.save(`Inventario_${Date.now()}.pdf`)
}
