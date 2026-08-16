import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { loadEnvConfig } from '@next/env'

// Cargar variables de entorno local
loadEnvConfig(process.cwd())

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan las credenciales de Supabase en las variables de entorno.")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function cargarProductos() {
  const dirPath = path.join(process.cwd(), 'fotos_productos')

  if (!fs.existsSync(dirPath)) {
    console.error(`La carpeta '${dirPath}' no existe.`)
    return
  }

  // 1. Consulta a Supabase todos los códigos registrados
  const { data: productosExistentes, error: queryError } = await supabase
    .from('productos')
    .select('sku')

  if (queryError) {
    console.error("❌ Error al consultar la base de datos:", queryError.message)
    return
  }

  const codigosEnBD = new Set(productosExistentes?.map(p => p.sku) || [])
  console.log(`🔍 Total de productos verificados en la base de datos: ${codigosEnBD.size}`)

  const files = fs.readdirSync(dirPath)
  let fallidos = 0
  let procesadosNuevos = 0
  let omitidos = 0

  for (const file of files) {
    if (!file.match(/\.(png|jpe?g|webp)$/i)) continue

    const baseName = path.parse(file).name
    const firstSpaceIndex = baseName.indexOf(' ')

    if (firstSpaceIndex === -1) {
      console.warn(`⚠️ Archivo ignorado: ${file} (No tiene el formato 'codigo nombre')`)
      continue
    }

    const codigo = baseName.substring(0, firstSpaceIndex).trim()
    const nombre = baseName.substring(firstSpaceIndex + 1).trim()
    const filePath = path.join(dirPath, file)

    // SI 'codigo' YA existe en 'codigosEnBD'
    if (codigosEnBD.has(codigo)) {
      try {
        fs.unlinkSync(filePath)
        console.log(`🗑️ Limpiado (ya estaba en BD): [${codigo}]`)
        omitidos++
      } catch (err) {
        console.error(`❌ Error borrando archivo local ${file}:`, err)
      }
      continue
    }

    // SI 'codigo' NO existe
    const fileBuffer = fs.readFileSync(filePath)

    try {
      const fileName = `${codigo}-${Date.now()}${path.extname(file)}`
      
      const { error: uploadError } = await supabase.storage
        .from('productos')
        .upload(fileName, fileBuffer, {
          contentType: file.toLowerCase().endsWith('png') ? 'image/png' : 'image/jpeg',
          upsert: true
        })

      if (uploadError) {
        console.error(`❌ Error subiendo imagen ${file}:`, uploadError.message)
        fallidos++
        continue
      }

      const { data: { publicUrl } } = supabase.storage.from('productos').getPublicUrl(fileName)

      const productoPayload = {
        sku: codigo,
        nombre,
        stock_disponible: 1,
        precio_usd: 1,
        precio_bs: 0,
        imagenes: [publicUrl],
        activo: true
      }

      const { error: upsertError } = await supabase
        .from('productos')
        .upsert(productoPayload, { onConflict: 'sku' })

      if (upsertError) {
        console.error(`❌ Error registrando producto [${codigo}]:`, upsertError.message)
        fallidos++
      } else {
        // Borrar el archivo local tras éxito total
        fs.unlinkSync(filePath)
        console.log(`✅ Subido y eliminado localmente: [${codigo}] ${nombre} - Stock: 1 - Precio: $1`)
        procesadosNuevos++
      }
    } catch (err) {
      console.error(`❌ Excepción procesando archivo ${file}:`, err)
      fallidos++
    }
  }

  console.log('\n=========================================')
  console.log(`📊 RESUMEN FINAL:`)
  console.log(`   - Verificados en BD: ${codigosEnBD.size}`)
  console.log(`   - Limpiados (ya existían): ${omitidos}`)
  console.log(`   - Nuevos subidos: ${procesadosNuevos}`)
  console.log(`   - Archivos fallidos (aún en carpeta): ${fallidos}`)
  console.log('=========================================\n')
}

cargarProductos()
