/** Cliente tal como viene de la tabla `clientes` */
export interface Cliente {
  id: string
  nombre: string
  cedula_rif: string
  telefono: string | null
  email?: string | null
  direccion?: string | null
}

/** Valores del formulario de cliente, ya sin espacios sobrantes */
export interface DatosCliente {
  nombre: string
  cedula_rif: string
  telefono: string
  email: string
  direccion: string
}

/** Forma comparable de una cédula o RIF: en mayúsculas y sin espacios, puntos ni guiones ("v-12.345.678" → "V12345678") */
export const normalizarDocumento = (valor: string) => valor.toUpperCase().replace(/[^A-Z0-9]/g, '')

// Cédula: V o E + 6 a 8 dígitos. RIF: V, E, J, G, P o C + 8 dígitos + dígito verificador
const FORMATO_DOCUMENTO = /^[VEJGPC]\d{6,9}$/

/** Advertencia de formato. No bloquea el guardado: hay documentos antiguos o de extranjeros con otros formatos */
export function avisoFormatoDocumento(valor: string): string | null {
  const documento = normalizarDocumento(valor)
  if (!documento) return null
  if (/^\d+$/.test(documento)) return 'Falta la letra inicial: V, E, J, G, P o C (p. ej. V-12345678).'
  if (!FORMATO_DOCUMENTO.test(documento)) return 'Formato poco común. Lo habitual es V-12345678 (cédula) o J-12345678-9 (RIF).'
  return null
}

/** Otro cliente con el mismo documento, aunque esté escrito con otros puntos, guiones o mayúsculas */
export function buscarDocumentoDuplicado<T extends Pick<Cliente, 'id' | 'cedula_rif'>>(
  clientes: readonly T[],
  documento: string,
  excluirId?: string
): T | null {
  const buscado = normalizarDocumento(documento)
  if (!buscado) return null
  return clientes.find(c => c.id !== excluirId && normalizarDocumento(c.cedula_rif ?? '') === buscado) ?? null
}

/** Texto comparable para búsquedas: minúsculas y sin acentos */
export const textoBuscable = (valor: string | null | undefined) =>
  (valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Busca en nombre, teléfono, correo y dirección; el documento se compara sin puntos ni guiones */
export function coincideConBusqueda(cliente: Cliente, consulta: string): boolean {
  const texto = textoBuscable(consulta).trim()
  if (!texto) return true
  if ([cliente.nombre, cliente.telefono, cliente.email, cliente.direccion].some(campo => textoBuscable(campo).includes(texto))) return true
  const documento = normalizarDocumento(consulta)
  return documento.length > 0 && normalizarDocumento(cliente.cedula_rif ?? '').includes(documento)
}

export const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
