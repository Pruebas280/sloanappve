'use server'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import * as xlsx from 'xlsx'

// ==========================================
// 1. DEFINICIONES DE TIPOS ESTRICTOS
// ==========================================
type UploadResult = {
  procesados: number
  creados: number
  actualizados: number
  errores: Array<{ fila: number; motivo: string }>
}

// Interfaz para la fila cruda leída por la librería xlsx
interface RawExcelRow {
  SKU?: string | number
  Nombre?: string
  Descripcion?: string
  Precio_USD?: number | string
  Precio_BS?: number | string
  Cantidad?: number | string
}

// Tipo que define la estructura esperada de la tabla en base de datos (simplificada)
interface ProductoDB {
  id: string
  stock_disponible: number
  // ... otros campos
}

// ==========================================
// 2. FUNCIÓN PRINCIPAL (SERVER ACTION)
// ==========================================
export async function uploadInventoryAction(formData: FormData): Promise<UploadResult> {
  const result: UploadResult = { procesados: 0, creados: 0, actualizados: 0, errores: [] }

  try {
    // A. Inicializar Supabase Client para App Router con manejo de Cookies
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options)
              })
            } catch {
              // Puede fallar si se llama desde un Server Component que no admite mutación de cookies,
              // pero en un Server Action esto funcionará correctamente.
            }
          },
        },
      }
    )

    // B. Autenticación y Verificación de Rol
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      throw new Error('Usuario no autenticado.')
    }

    // Validar Rol (según esquema previo)
    const { data: userData, error: userProfileError } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single()

    if (userProfileError || !userData) {
      throw new Error('No se pudo verificar el perfil del usuario.')
    }

    if (userData.rol !== 'owner' && userData.rol !== 'administracion') {
      throw new Error('Permisos insuficientes. Solo administracion u owner pueden realizar carga masiva.')
    }

    // C. Extracción y Lectura del Archivo
    const file = formData.get('file') as File | null
    if (!file) {
      throw new Error('No se encontró ningún archivo en el formulario.')
    }

    const arrayBuffer = await file.arrayBuffer()
    // Convertir ArrayBuffer a Buffer nativo para uso de la librería xlsx en Node.js
    const buffer = Buffer.from(arrayBuffer)
    const workbook = xlsx.read(buffer, { type: 'buffer' })
    
    if (!workbook.SheetNames.length) {
      throw new Error('El archivo Excel está vacío o no tiene hojas.')
    }

    const firstSheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[firstSheetName]
    
    // Obtener los datos mapeados por la cabecera (defval: '' para evitar undefined en celdas vacías)
    const rows = xlsx.utils.sheet_to_json<RawExcelRow>(worksheet, { defval: '' })

    // D. Procesamiento fila por fila
    // Iteramos con for...of para asegurar que las llamadas asíncronas se resuelvan en orden
    // (Opcionalmente, se podría paralelizar con Promise.all si el archivo es pequeño, pero
    // hacerlo secuencial o en lotes es más seguro para no agotar conexiones a la DB).
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const fila = index + 2 // +2 porque el índice 0 es la fila 2 de Excel (la fila 1 es cabecera)
      
      try {
        // Validaciones estrictas de datos y parseo de tipos
        const skuStr = String(row.SKU || '').trim()
        const nombre = String(row.Nombre || '').trim()
        const descripcion = String(row.Descripcion || '').trim()
        const precioUSD = Number(row.Precio_USD)
        const precioBS = Number(row.Precio_BS)
        const cantidadStr = String(row.Cantidad || '0').trim()
        const cantidad = parseInt(cantidadStr, 10)

        // Verificaciones básicas de integridad
        if (!skuStr) throw new Error('SKU está vacío')
        if (!nombre) throw new Error('Nombre está vacío')
        if (isNaN(precioUSD) || precioUSD < 0) throw new Error('Precio_USD inválido')
        if (isNaN(precioBS) || precioBS < 0) throw new Error('Precio_BS inválido')
        if (isNaN(cantidad) || cantidad < 0) throw new Error('Cantidad inválida')

        // 1. Consultar si el SKU ya existe en la DB
        const { data: productoExistente, error: queryError } = await supabase
          .from('productos')
          .select('id, stock_disponible')
          .eq('sku', skuStr)
          .maybeSingle()

        if (queryError) {
          throw new Error(`Error consultando producto: ${queryError.message}`)
        }

        if (productoExistente) {
          // CASO A: El SKU existe -> Actualizar sumando cantidad
          const nuevoStock = Number(productoExistente.stock_disponible) + cantidad

          const { error: updateError } = await supabase
            .from('productos')
            .update({
              nombre,
              descripcion,
              precio_usd: precioUSD,
              precio_bs: precioBS,
              stock_disponible: nuevoStock
            })
            .eq('id', productoExistente.id)

          if (updateError) {
            throw new Error(`Fallo al actualizar producto: ${updateError.message}`)
          }
          
          result.actualizados++
        } else {
          // CASO B: El SKU NO existe -> Insertar nuevo registro
          const { error: insertError } = await supabase
            .from('productos')
            .insert({
              sku: skuStr,
              nombre,
              descripcion,
              precio_usd: precioUSD,
              precio_bs: precioBS,
              stock_disponible: cantidad,
              stock_reservado: 0,
              activo: true // Por defecto
            })

          if (insertError) {
            throw new Error(`Fallo al crear producto: ${insertError.message}`)
          }
          
          result.creados++
        }

        result.procesados++
      } catch (err: unknown) {
        // Manejo estricto de excepciones (err podría no ser instancia de Error)
        const errorMessage = err instanceof Error ? err.message : 'Error desconocido'
        result.errores.push({
          fila,
          motivo: errorMessage
        })
      }
    }

    return result
  } catch (error: unknown) {
    // Captura global de errores (por ej. archivo corrupto, error auth)
    const fatalError = error instanceof Error ? error.message : 'Error crítico en procesamiento'
    return {
      procesados: result.procesados,
      creados: result.creados,
      actualizados: result.actualizados,
      errores: [...result.errores, { fila: 0, motivo: fatalError }] // Fila 0 denota error general
    }
  }
}
