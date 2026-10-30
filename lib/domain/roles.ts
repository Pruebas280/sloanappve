/**
 * Roles del sistema. Es la única lista válida: cualquier otro valor en `usuarios.rol`
 * se trata como "sin acceso", nunca se sustituye por un rol por defecto.
 */
export const ROLES = ['owner', 'administracion', 'almacenista', 'vendedor'] as const

export type Rol = (typeof ROLES)[number]

export function esRolValido(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
}
