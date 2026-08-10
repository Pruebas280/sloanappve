import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Crea y retorna el cliente de Supabase optimizado para Server Components y Server Actions.
 * Gestiona el ciclo de vida de las cookies de sesión con Next.js.
 * Provee valores por defecto (fallbacks) seguros para evitar fallos de build en Netlify.
 */
export async function createClient() {
  const cookieStore = await cookies()
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options as CookieOptions)
            })
          } catch (error) {
            // Se ignora el error al usar 'setAll' desde un Server Component de Next.js,
            // ya que allí las cookies son de solo lectura. Funciona correctamente en Server Actions.
          }
        },
      },
    }
  )
}
