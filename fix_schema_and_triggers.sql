-- ========================================================================================
-- MIGRACIÓN SQL: FIX SCHEMA Y TRIGGERS DE STOCK
-- ========================================================================================

-- 1. Unificar/Actualizar el ENUM de estados de ordenes
-- (Agregamos los nuevos estados en minúscula para evitar romper la data actual)
ALTER TYPE estado_orden_enum ADD VALUE IF NOT EXISTS 'pendiente';
ALTER TYPE estado_orden_enum ADD VALUE IF NOT EXISTS 'aprobado';
ALTER TYPE estado_orden_enum ADD VALUE IF NOT EXISTS 'rechazado';
ALTER TYPE estado_orden_enum ADD VALUE IF NOT EXISTS 'rechazado_en_entrega';
ALTER TYPE estado_orden_enum ADD VALUE IF NOT EXISTS 'entregado';
ALTER TYPE estado_orden_enum ADD VALUE IF NOT EXISTS 'pagado';
ALTER TYPE estado_orden_enum ADD VALUE IF NOT EXISTS 'cancelado';


-- 2. Asegurar que 'orden_items' tenga ON DELETE CASCADE hacia 'ordenes'
-- Eliminamos cualquier constraint anterior y creamos el nuevo restrictivo
DO $$ 
DECLARE
  fk_name text;
BEGIN
  SELECT constraint_name INTO fk_name 
  FROM information_schema.table_constraints 
  WHERE table_name = 'orden_items' AND constraint_type = 'FOREIGN KEY' 
  AND constraint_name LIKE '%orden_id%';
  
  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE orden_items DROP CONSTRAINT ' || fk_name;
  END IF;
END $$;

ALTER TABLE orden_items 
ADD CONSTRAINT orden_items_orden_id_fkey 
FOREIGN KEY (orden_id) REFERENCES ordenes(id) ON DELETE CASCADE;


-- 3. Crear Función y Trigger BEFORE UPDATE OR DELETE para la tabla ordenes
-- Repone el stock automáticamente (restaura stock_disponible, reduce stock_reservado)
CREATE OR REPLACE FUNCTION procesar_cambio_estado_orden_o_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    item RECORD;
BEGIN
    -- CASO A: ELIMINACIÓN FÍSICA (DELETE)
    -- Si la orden se borra por completo, devolvemos el stock que tuviera retenido (reservado)
    IF TG_OP = 'DELETE' THEN
        -- Omitimos devolver stock si ya estaba cancelado/entregado (ya se procesó en su momento)
        IF OLD.estado NOT IN ('CANCELADO', 'cancelado', 'RECHAZADO', 'rechazado', 'RECHAZADO_EN_ENTREGA', 'rechazado_en_entrega', 'ENTREGADO', 'entregado', 'pagado', 'PAGADO') THEN
            FOR item IN SELECT producto_id, cantidad FROM orden_items WHERE orden_id = OLD.id LOOP
                UPDATE productos
                SET stock_reservado = GREATEST(stock_reservado - item.cantidad, 0),
                    stock_disponible = stock_disponible + item.cantidad
                WHERE id = item.producto_id;
            END LOOP;
        END IF;
        RETURN OLD;
    END IF;

    -- CASO B: ACTUALIZACIÓN DE ESTADO (UPDATE)
    IF TG_OP = 'UPDATE' THEN
        IF OLD.estado = NEW.estado THEN
            RETURN NEW;
        END IF;

        NEW.fecha_actualizacion = NOW();

        -- 1. Si la orden se CANCELA o RECHAZA (y no estaba previamente cancelada/entregada)
        IF NEW.estado IN ('CANCELADO', 'cancelado', 'RECHAZADO', 'rechazado', 'RECHAZADO_EN_ENTREGA', 'rechazado_en_entrega') 
           AND OLD.estado NOT IN ('CANCELADO', 'cancelado', 'RECHAZADO', 'rechazado', 'RECHAZADO_EN_ENTREGA', 'rechazado_en_entrega', 'ENTREGADO', 'entregado', 'pagado', 'PAGADO') THEN
            
            FOR item IN SELECT producto_id, cantidad FROM orden_items WHERE orden_id = NEW.id LOOP
                UPDATE productos
                SET stock_reservado = GREATEST(stock_reservado - item.cantidad, 0),
                    stock_disponible = stock_disponible + item.cantidad
                WHERE id = item.producto_id;
            END LOOP;
        END IF;

        -- 2. Si la orden se ENTREGA o PAGA (y no estaba entregada previamente)
        IF NEW.estado IN ('ENTREGADO', 'entregado', 'pagado', 'PAGADO') 
           AND OLD.estado NOT IN ('ENTREGADO', 'entregado', 'pagado', 'PAGADO', 'CANCELADO', 'cancelado', 'RECHAZADO', 'rechazado', 'RECHAZADO_EN_ENTREGA', 'rechazado_en_entrega') THEN
            
            FOR item IN SELECT producto_id, cantidad FROM orden_items WHERE orden_id = NEW.id LOOP
                UPDATE productos
                SET stock_reservado = GREATEST(stock_reservado - item.cantidad, 0)
                WHERE id = item.producto_id;
            END LOOP;
        END IF;

        RETURN NEW;
    END IF;
END;
$$;

-- Limpiar triggers antiguos si existen
DROP TRIGGER IF EXISTS tr_orden_update_delete ON ordenes;
DROP TRIGGER IF EXISTS tr_orden_update ON ordenes;

-- Instalar el nuevo trigger unificado
CREATE TRIGGER tr_orden_update_delete
    BEFORE UPDATE OR DELETE ON ordenes
    FOR EACH ROW
    EXECUTE FUNCTION procesar_cambio_estado_orden_o_delete();


-- 4. Habilitar y Ajustar Políticas RLS para DELETE y UPDATE
ALTER TABLE ordenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

-- Limpiar políticas de DELETE/UPDATE por si ya existían para evitar choques
DROP POLICY IF EXISTS "Permitir update ordenes a staff" ON ordenes;
DROP POLICY IF EXISTS "Permitir delete ordenes a admin" ON ordenes;
DROP POLICY IF EXISTS "Permitir delete orden_items a admin" ON orden_items;

-- Políticas unificadas (El acceso a get_user_role() debe existir previamente según el esquema base)
CREATE POLICY "Permitir update ordenes a staff" ON ordenes 
    FOR UPDATE USING (
        get_user_role() IN ('owner', 'administracion', 'almacenista', 'vendedor')
    );

CREATE POLICY "Permitir delete ordenes a admin" ON ordenes 
    FOR DELETE USING (
        get_user_role() IN ('owner', 'administracion')
    );

CREATE POLICY "Permitir delete orden_items a admin" ON orden_items 
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM ordenes 
            WHERE ordenes.id = orden_items.orden_id 
            AND get_user_role() IN ('owner', 'administracion')
        )
    );
