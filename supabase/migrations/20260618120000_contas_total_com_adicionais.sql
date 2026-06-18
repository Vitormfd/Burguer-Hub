-- Recalcula o total das contas incluindo adicionais dos itens de mesa.
UPDATE contas c
SET total = COALESCE(calc.total, 0)
FROM (
  SELECT
    p.conta_id,
    COALESCE(SUM(
      CASE
        WHEN pi.cancelado THEN 0
        ELSE (pi.preco_unitario * pi.quantidade) + COALESCE(ad.sum_adicionais, 0)
      END
    ), 0) AS total
  FROM pedidos p
  JOIN pedido_itens pi ON pi.pedido_id = p.id
  LEFT JOIN (
    SELECT
      pedido_item_id,
      SUM(preco_unitario * quantidade) AS sum_adicionais
    FROM pedido_item_adicionais
    GROUP BY pedido_item_id
  ) ad ON ad.pedido_item_id = pi.id
  WHERE p.conta_id IS NOT NULL
    AND p.status <> 'cancelado'
    AND p.cancelado_em IS NULL
  GROUP BY p.conta_id
) calc
WHERE c.id = calc.conta_id;

UPDATE contas c
SET total = 0
WHERE NOT EXISTS (
  SELECT 1
  FROM pedidos p
  WHERE p.conta_id = c.id
    AND p.status <> 'cancelado'
    AND p.cancelado_em IS NULL
);
