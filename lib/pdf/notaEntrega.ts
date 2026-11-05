import type { CellHookData } from 'jspdf-autotable'
import type { OrdenAdmin } from '@/lib/services/ordenes'

/**
 * Nota de Entrega corporativa (Sloan / Fluidmaster). Es el mismo documento que generaba
 * AdminDashboard, movido aquí sin cambios de diseño. Si falla, lanza el error para que la pantalla
 * lo muestre.
 */
export async function descargarNotaEntrega(orden: OrdenAdmin) {
  const { default: jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF('p', 'pt', 'a4')

  // Fondo Superior (Azul Claro pastel)
  doc.setFillColor(224, 242, 254)
  doc.rect(0, 0, 600, 100, 'F')

  // 1. Cabecera Corporativa y Logos
  const fetchBase64 = async (url: string) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      return new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  }

  const [globalB64, sloanB64, fluidB64] = await Promise.all([
    fetchBase64('/logos/global.png'),
    fetchBase64('/logos/sloan.png'),
    fetchBase64('/logos/fluidmaster.png')
  ])

  let currentX = 40;
  const logoHeight = 22; // Altura proporcional mejorada

  if (globalB64) {
    const props = doc.getImageProperties(globalB64);
    const width = (props.width * logoHeight) / props.height;
    doc.addImage(globalB64, 'PNG', currentX, 15, width, logoHeight);
    currentX += width + 20; // 20pt de separación
  }
  if (sloanB64) {
    const props = doc.getImageProperties(sloanB64);
    const width = (props.width * logoHeight) / props.height;
    doc.addImage(sloanB64, 'PNG', currentX, 15, width, logoHeight);
    currentX += width + 20;
  }
  if (fluidB64) {
    const props = doc.getImageProperties(fluidB64);
    const width = (props.width * logoHeight) / props.height;
    doc.addImage(fluidB64, 'PNG', currentX, 15, width, logoHeight);
  }

  doc.setFontSize(20)
  doc.setTextColor(2, 132, 199) // Azul Rey brillante
  doc.text('NOTA DE ENTREGA', 40, 55) // Ajustado ligeramente hacia abajo por el aumento de logo

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

  // Espaciado vertical (interlineado) ajustado a 16pt para mayor limpieza
  // startY incrementado a 120 para tener 20pt de margen desde el borde inferior del header azul (que termina en Y=100)
  const startY = 120;
  const lineHeight = 16;

  doc.text(`Cliente: ${orden.clientes?.nombre || 'N/A'}`, 40, startY)
  doc.text(`RIF / CI: ${orden.clientes?.cedula_rif || 'N/A'}`, 40, startY + lineHeight)

  const dirFiscal = orden.clientes?.direccion || 'No especificada'
  const lineasDirFiscal = doc.splitTextToSize(`Dir. Fiscal: ${dirFiscal}`, 300)
  doc.text(lineasDirFiscal, 40, startY + (lineHeight * 2))

  let dirY = startY + (lineHeight * 2) + (lineasDirFiscal.length * lineHeight)
  if (orden.direccion_envio && orden.direccion_envio !== dirFiscal) {
    const lineasDirEnvio = doc.splitTextToSize(`Dir. Envío: ${orden.direccion_envio}`, 300)
    doc.text(lineasDirEnvio, 40, dirY)
    dirY += (lineasDirEnvio.length * lineHeight)
  }

  doc.text(`Condición: ${orden.condicion_entrega || 'Retiro'}`, 40, dirY)

  // Columna Derecha (Datos de Orden) - Alineación sincronizada con el interlineado nuevo
  doc.text(`Fecha: ${new Date(orden.fecha_creacion || orden.creado_en || Date.now()).toLocaleDateString()}`, 400, startY)
  doc.text(`Ejecutivo: ${orden.usuarios?.nombre || 'N/A'}`, 400, startY + lineHeight)
  doc.text(`Pago: ${orden.metodo_pago}`, 400, startY + (lineHeight * 2))

  const isCredito = orden.modalidad_pago === 'Crédito'
  if (isCredito) doc.setFontSize(8)
  doc.text(isCredito ? `Modalidad: CRÉDITO | Inicial: $${Number(orden.inicial_monto || 0).toFixed(2)} | Plazo: ${orden.dias_credito} Días` : `Modalidad: CONTADO`, 400, startY + (lineHeight * 3))
  if (isCredito) doc.setFontSize(11)

  doc.text(`Estado: ${orden.estado.toUpperCase()}`, 400, startY + (lineHeight * 4))

  // Asegurar que la tabla no se solape si los datos del cliente son muy largos
  const finalHeaderY = Math.max(dirY + 20, startY + (lineHeight * 4) + 20, 185)

  // 3. Tabla de Productos
  const tableColumn = ["Cant.", "Código/SKU", "Descripción", "P.U USD", "Total USD"]
  const tableRows = (orden.orden_items || []).map(item => [
    item.cantidad,
    item.productos?.sku || 'N/A',
    item.productos?.nombre || 'Producto',
    `$${Number(item.precio_unitario_usd || 0).toFixed(2)}`,
    `$${(item.cantidad * Number(item.precio_unitario_usd || 0)).toFixed(2)}`
  ])

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: finalHeaderY,
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
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 170

  const totalUSD = Number(orden.total_usd || 0)
  const descuentoPorcentaje = orden.porcentaje_descuento || 0
  const descuentoMonto = orden.monto_descuento || 0
  const subtotal = totalUSD + descuentoMonto;

  doc.setFontSize(10)
  doc.setTextColor(100)

  // Términos en margen izquierdo (X=40 -> ~14mm)
  doc.text('Términos: Los pagos deben confirmarse antes del despacho.', 40, finalY + 45, { maxWidth: 200 })

  const totalsRows = []
  totalsRows.push(['Subtotal:', `$${subtotal.toFixed(2)}`])

  if (descuentoPorcentaje > 0) {
    totalsRows.push([`Descuento (${descuentoPorcentaje}%):`, `-$${descuentoMonto.toFixed(2)}`])
  }

  totalsRows.push(['TOTAL GENERAL:', `$${totalUSD.toFixed(2)}`])

  autoTable(doc, {
    body: totalsRows,
    startY: finalY + 30,
    margin: { left: 325 }, // ~115mm
    theme: 'plain',
    styles: { fontSize: 11, cellPadding: 6, textColor: [0, 0, 0] },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'right' }
    },
    didParseCell: function(data: CellHookData) {
      if (data.row.index === totalsRows.length - 1) { // Última fila (TOTAL GENERAL)
        data.cell.styles.fillColor = [224, 242, 254] // #E0F2FE
        data.cell.styles.textColor = [2, 132, 199]   // #0284C7
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fontSize = 13
      }
    }
  })

  // 5. Bloque de Firmas y Pie de página final
  doc.setDrawColor(186, 230, 253) // Azul pastel suave

  // Firma 1 (Cliente)
  doc.line(40, finalY + 120, 240, finalY + 120)
  doc.setTextColor(100)
  doc.setFontSize(10)
  doc.text('Recibido Conforme (Cliente)', 40, finalY + 135)

  // Firma 2 (Almacén)
  doc.line(320, finalY + 120, 520, finalY + 120)
  doc.text('Entregado Por (Almacén)', 320, finalY + 135)

  const pageHeight = doc.internal.pageSize.getHeight()
  const footerY = pageHeight - 50
  doc.setFillColor(224, 242, 254)
  doc.rect(0, footerY, 600, 50, 'F')

  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text('Sistema ERP Master | Documento generado automáticamente.', 40, footerY + 25)
  doc.text(`Impreso: ${new Date().toLocaleString()}`, 400, footerY + 25)

  doc.save(`Nota_de_Entrega_Orden_${orden.id.slice(0, 8)}.pdf`)
}
