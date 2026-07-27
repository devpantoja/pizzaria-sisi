import db from './db.js';

const stmts = {
  senhasDoDia: db.prepare(`SELECT * FROM senhas WHERE dia = ? ORDER BY id`),
  itensVendidosDia: db.prepare(`
    SELECT pi.nome_snapshot, pi.tamanho_nome, SUM(pi.quantidade) as qty, SUM(pi.preco_total_centavos) as total
    FROM pedido_itens pi
    JOIN pedidos p ON p.id = pi.pedido_id
    JOIN senhas s ON s.id = p.senha_id
    WHERE s.dia = ?
    GROUP BY pi.nome_snapshot, pi.tamanho_nome
    ORDER BY qty DESC, total DESC
  `),
  totaisDia: db.prepare(`
    SELECT
      COUNT(DISTINCT s.id) as senhas_total,
      COUNT(DISTINCT CASE WHEN s.status = 'entregue' THEN s.id END) as senhas_entregues,
      COUNT(DISTINCT p.id) as pedidos_total,
      COALESCE(SUM(p.total_centavos), 0) as faturamento_centavos
    FROM senhas s
    LEFT JOIN pedidos p ON p.senha_id = s.id
    WHERE s.dia = ?
  `),
  pedidosCompletos: db.prepare(`
    SELECT
      s.id AS senha_id, s.numero, s.status, s.criada_em, s.pronta_em, s.entregue_em,
      p.id AS pedido_id, p.total_centavos
    FROM senhas s
    LEFT JOIN pedidos p ON p.senha_id = s.id
    WHERE s.dia = ?
    ORDER BY s.numero
  `),
  itensDoPedido: db.prepare(`
    SELECT nome_snapshot, tamanho_nome, quantidade, preco_total_centavos, meia_meia
    FROM pedido_itens WHERE pedido_id = ?
  `),
};

const hoje = () => new Date().toISOString().slice(0, 10);

export function relatorioDia(data) {
  const dia = data || hoje();
  const totais = stmts.totaisDia.get(dia);
  const itensMaisVendidos = stmts.itensVendidosDia.all(dia);
  const pedidos = stmts.pedidosCompletos.all(dia).map(row => ({
    ...row,
    itens: row.pedido_id ? stmts.itensDoPedido.all(row.pedido_id).map(i => ({
      ...i, meia_meia: i.meia_meia === 1,
    })) : [],
  }));
  return { dia, totais, itens_mais_vendidos: itensMaisVendidos, pedidos };
}
