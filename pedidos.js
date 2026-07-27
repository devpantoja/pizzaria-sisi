import db from './db.js';
import { buscarItem } from './cardapio.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senha_id INTEGER NOT NULL UNIQUE REFERENCES senhas(id) ON DELETE CASCADE,
    total_centavos INTEGER NOT NULL DEFAULT 0,
    observacao TEXT DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS pedido_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES itens(id) ON DELETE SET NULL,
    item2_id INTEGER REFERENCES itens(id) ON DELETE SET NULL,
    nome_snapshot TEXT NOT NULL,
    tamanho_nome TEXT NOT NULL,
    tamanho_id INTEGER,
    tamanho2_id INTEGER,
    quantidade INTEGER NOT NULL DEFAULT 1,
    preco_base_centavos INTEGER NOT NULL,
    preco_adicionais_centavos INTEGER NOT NULL DEFAULT 0,
    preco_total_centavos INTEGER NOT NULL,
    meia_meia INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens(pedido_id);

  CREATE TABLE IF NOT EXISTS pedido_item_adicionais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_item_id INTEGER NOT NULL REFERENCES pedido_itens(id) ON DELETE CASCADE,
    adicional_id INTEGER REFERENCES adicionais(id) ON DELETE SET NULL,
    nome_snapshot TEXT NOT NULL,
    preco_centavos INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_ped_add_item ON pedido_item_adicionais(pedido_item_id);
`);

const stmts = {
  inserirPedido: db.prepare(
    `INSERT INTO pedidos (senha_id, total_centavos, observacao) VALUES (?, ?, ?)`
  ),
  buscarPedidoPorId: db.prepare(`SELECT * FROM pedidos WHERE id = ?`),
  buscarPedidoPorSenha: db.prepare(`SELECT * FROM pedidos WHERE senha_id = ?`),
  itensDoPedido: db.prepare(`SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id`),
  adicionaisDoItem: db.prepare(`SELECT * FROM pedido_item_adicionais WHERE pedido_item_id = ? ORDER BY id`),

  inserirItemPedido: db.prepare(
    `INSERT INTO pedido_itens
      (pedido_id, item_id, item2_id, nome_snapshot, tamanho_nome, tamanho_id, tamanho2_id,
       quantidade, preco_base_centavos, preco_adicionais_centavos, preco_total_centavos, meia_meia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  inserirAdicionalItem: db.prepare(
    `INSERT INTO pedido_item_adicionais (pedido_item_id, adicional_id, nome_snapshot, preco_centavos)
     VALUES (?, ?, ?, ?)`
  ),
};

// Calcula o preço de uma linha do carrinho a partir do cardápio real (server-side, confiável)
// Retorna { linhaValidada, nome_snapshot, tamanho_nome, preco_base, preco_adicionais, preco_total }
function calcularLinha(linha) {
  const { item_id, item2_id, tamanho_id, tamanho2_id, quantidade = 1, adicionais_ids = [] } = linha;

  const item = buscarItem(item_id);
  if (!item) throw new Error(`Item ${item_id} não existe`);
  if (!item.disponivel) throw new Error(`Item "${item.nome}" está esgotado`);

  const tamanho = item.tamanhos.find(t => t.id === tamanho_id);
  if (!tamanho) throw new Error(`Tamanho inválido para "${item.nome}"`);

  let preco_base = tamanho.preco_centavos;
  let nome_snapshot = item.nome;
  let tamanho_nome = tamanho.nome;
  let meia_meia = 0;
  let item2 = null;
  let tamanho2 = null;

  if (item2_id) {
    item2 = buscarItem(item2_id);
    if (!item2) throw new Error(`Segundo sabor (item ${item2_id}) não existe`);
    if (!item2.disponivel) throw new Error(`"${item2.nome}" está esgotado`);
    // Meia-meia: tamanho2 tem que ter mesmo NOME do tamanho1 (mesmo tamanho)
    tamanho2 = item2.tamanhos.find(t => t.id === tamanho2_id);
    if (!tamanho2) throw new Error(`Tamanho do segundo sabor inválido`);
    if (tamanho2.nome !== tamanho.nome) {
      throw new Error(`Meia-meia exige o mesmo tamanho nos dois sabores`);
    }
    // Regra: preço = o mais caro dos dois
    preco_base = Math.max(tamanho.preco_centavos, tamanho2.preco_centavos);
    nome_snapshot = `${item.nome} / ${item2.nome}`;
    meia_meia = 1;
  }

  // Adicionais: precisam estar cadastrados no item1 (pra meia-meia usamos item1 como base)
  let preco_adicionais = 0;
  const adicionaisValidados = [];
  for (const addId of adicionais_ids) {
    const add = item.adicionais.find(a => a.id === addId);
    if (!add) throw new Error(`Adicional ${addId} não pertence a "${item.nome}"`);
    preco_adicionais += add.preco_centavos;
    adicionaisValidados.push(add);
  }

  const qty = Math.max(1, Number(quantidade) || 1);
  const preco_total = (preco_base + preco_adicionais) * qty;

  return {
    item, item2, tamanho, tamanho2,
    nome_snapshot, tamanho_nome,
    preco_base, preco_adicionais, preco_total,
    meia_meia, quantidade: qty,
    adicionaisValidados,
  };
}

export function criarPedido({ senhaId, linhas, observacao = '' }) {
  if (!Array.isArray(linhas) || linhas.length === 0) {
    throw new Error('Pedido precisa ter ao menos 1 item');
  }

  const linhasCalculadas = linhas.map(calcularLinha);
  const total = linhasCalculadas.reduce((acc, l) => acc + l.preco_total, 0);

  const gravar = db.transaction(() => {
    const info = stmts.inserirPedido.run(senhaId, total, observacao);
    const pedidoId = info.lastInsertRowid;

    for (const l of linhasCalculadas) {
      const infoItem = stmts.inserirItemPedido.run(
        pedidoId,
        l.item.id,
        l.item2?.id ?? null,
        l.nome_snapshot,
        l.tamanho_nome,
        l.tamanho.id,
        l.tamanho2?.id ?? null,
        l.quantidade,
        l.preco_base,
        l.preco_adicionais,
        l.preco_total,
        l.meia_meia
      );
      const pedidoItemId = infoItem.lastInsertRowid;
      for (const a of l.adicionaisValidados) {
        stmts.inserirAdicionalItem.run(pedidoItemId, a.id, a.nome, a.preco_centavos);
      }
    }

    return pedidoId;
  });

  const pedidoId = gravar();
  return buscarPedido(pedidoId);
}

function hidratarPedido(pedido) {
  if (!pedido) return null;
  const itens = stmts.itensDoPedido.all(pedido.id).map(item => ({
    ...item,
    meia_meia: item.meia_meia === 1,
    adicionais: stmts.adicionaisDoItem.all(item.id),
  }));
  return { ...pedido, itens };
}

export function buscarPedido(id) {
  return hidratarPedido(stmts.buscarPedidoPorId.get(id));
}

export function buscarPedidoPorSenha(senhaId) {
  return hidratarPedido(stmts.buscarPedidoPorSenha.get(senhaId));
}
