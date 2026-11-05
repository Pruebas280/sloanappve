/**
 * Roles del sistema. Es la única lista válida: cualquier otro valor en `usuarios.rol`
 * se trata como "sin acceso", nunca se sustituye por un rol por defecto.
 */
export const ROLES = ['owner', 'administracion', 'almacenista', 'vendedor'] as const

export type Rol = (typeof ROLES)[number]

/** Nombre visible de cada rol y qué módulos abre (según el menú del panel principal) */
export const INFO_ROL: Record<Rol, { etiqueta: string; acceso: string }> = {
  owner: { etiqueta: 'Owner', acceso: 'Acceso total, incluidos reportes, clientes y personal.' },
  administracion: { etiqueta: 'Administración', acceso: 'Inventario, monitoreo de órdenes y cuentas por cobrar.' },
  almacenista: { etiqueta: 'Almacén', acceso: 'Inventario y logística de despacho.' },
  vendedor: { etiqueta: 'Ventas', acceso: 'Inventario y punto de venta.' },
}

export function esRolValido(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
}
