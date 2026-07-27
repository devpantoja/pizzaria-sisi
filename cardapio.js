import db from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    ordem INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    descricao TEXT DEFAULT '',
    disponivel INTEGER NOT NULL DEFAULT 1,
    ordem INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_itens_categoria ON itens(categoria_id);

  CREATE TABLE IF NOT EXISTS tamanhos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    preco_centavos INTEGER NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tamanhos_item ON tamanhos(item_id);

  CREATE TABLE IF NOT EXISTS adicionais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    preco_centavos INTEGER NOT NULL DEFAULT 0,
    ordem INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_adicionais_item ON adicionais(item_id);
`);

const stmts = {
  // Categorias
  listarCategorias: db.prepare(`SELECT * FROM categorias ORDER BY ordem, nome`),
  buscarCategoria: db.prepare(`SELECT * FROM categorias WHERE id = ?`),
  inserirCategoria: db.prepare(`INSERT INTO categorias (nome, ordem) VALUES (?, ?)`),
  atualizarCategoria: db.prepare(`UPDATE categorias SET nome = ?, ordem = ? WHERE id = ?`),
  apagarCategoria: db.prepare(`DELETE FROM categorias WHERE id = ?`),

  // Itens
  listarItens: db.prepare(`SELECT * FROM itens ORDER BY categoria_id, ordem, nome`),
  itensPorCategoria: db.prepare(`SELECT * FROM itens WHERE categoria_id = ? ORDER BY ordem, nome`),
  buscarItem: db.prepare(`SELECT * FROM itens WHERE id = ?`),
  inserirItem: db.prepare(
    `INSERT INTO itens (categoria_id, nome, descricao, disponivel, ordem) VALUES (?, ?, ?, ?, ?)`
  ),
  atualizarItem: db.prepare(
    `UPDATE itens SET categoria_id = ?, nome = ?, descricao = ?, disponivel = ?, ordem = ? WHERE id = ?`
  ),
  toggleDisponivelItem: db.prepare(
    `UPDATE itens SET disponivel = CASE disponivel WHEN 1 THEN 0 ELSE 1 END WHERE id = ?`
  ),
  apagarItem: db.prepare(`DELETE FROM itens WHERE id = ?`),

  // Tamanhos
  tamanhosDoItem: db.prepare(`SELECT * FROM tamanhos WHERE item_id = ? ORDER BY ordem, preco_centavos`),
  inserirTamanho: db.prepare(
    `INSERT INTO tamanhos (item_id, nome, preco_centavos, ordem) VALUES (?, ?, ?, ?)`
  ),
  atualizarTamanho: db.prepare(
    `UPDATE tamanhos SET nome = ?, preco_centavos = ?, ordem = ? WHERE id = ?`
  ),
  apagarTamanho: db.prepare(`DELETE FROM tamanhos WHERE id = ?`),
  apagarTamanhosDoItem: db.prepare(`DELETE FROM tamanhos WHERE item_id = ?`),

  // Adicionais
  adicionaisDoItem: db.prepare(`SELECT * FROM adicionais WHERE item_id = ? ORDER BY ordem, nome`),
  inserirAdicional: db.prepare(
    `INSERT INTO adicionais (item_id, nome, preco_centavos, ordem) VALUES (?, ?, ?, ?)`
  ),
  atualizarAdicional: db.prepare(
    `UPDATE adicionais SET nome = ?, preco_centavos = ?, ordem = ? WHERE id = ?`
  ),
  apagarAdicional: db.prepare(`DELETE FROM adicionais WHERE id = ?`),
  apagarAdicionaisDoItem: db.prepare(`DELETE FROM adicionais WHERE item_id = ?`),
};

// ============= Categorias =============
export const listarCategorias = () => stmts.listarCategorias.all();

export function criarCategoria({ nome, ordem = 0 }) {
  const info = stmts.inserirCategoria.run(nome.trim(), ordem);
  return stmts.buscarCategoria.get(info.lastInsertRowid);
}

export function atualizarCategoria(id, { nome, ordem = 0 }) {
  const info = stmts.atualizarCategoria.run(nome.trim(), ordem, id);
  if (info.changes === 0) return null;
  return stmts.buscarCategoria.get(id);
}

export function apagarCategoria(id) {
  const info = stmts.apagarCategoria.run(id);
  return info.changes > 0;
}

// ============= Itens (com filhos aninhados) =============
function hidratar(item) {
  if (!item) return null;
  return {
    ...item,
    disponivel: item.disponivel === 1,
    tamanhos: stmts.tamanhosDoItem.all(item.id),
    adicionais: stmts.adicionaisDoItem.all(item.id),
  };
}

export function listarItens() {
  return stmts.listarItens.all().map(hidratar);
}

export function buscarItem(id) {
  return hidratar(stmts.buscarItem.get(id));
}

export function criarItem({ categoria_id, nome, descricao = '', disponivel = true, ordem = 0, tamanhos = [], adicionais = [] }) {
  const criar = db.transaction(() => {
    const info = stmts.inserirItem.run(categoria_id, nome.trim(), descricao, disponivel ? 1 : 0, ordem);
    const itemId = info.lastInsertRowid;
    for (const [i, t] of tamanhos.entries()) {
      stmts.inserirTamanho.run(itemId, t.nome.trim(), Number(t.preco_centavos) || 0, t.ordem ?? i);
    }
    for (const [i, a] of adicionais.entries()) {
      stmts.inserirAdicional.run(itemId, a.nome.trim(), Number(a.preco_centavos) || 0, a.ordem ?? i);
    }
    return itemId;
  });
  return buscarItem(criar());
}

export function atualizarItem(id, { categoria_id, nome, descricao = '', disponivel = true, ordem = 0, tamanhos, adicionais }) {
  const atualizar = db.transaction(() => {
    const info = stmts.atualizarItem.run(categoria_id, nome.trim(), descricao, disponivel ? 1 : 0, ordem, id);
    if (info.changes === 0) return false;

    // Substitui tamanhos/adicionais se enviados (regra simples: apaga e recria)
    if (Array.isArray(tamanhos)) {
      stmts.apagarTamanhosDoItem.run(id);
      for (const [i, t] of tamanhos.entries()) {
        stmts.inserirTamanho.run(id, t.nome.trim(), Number(t.preco_centavos) || 0, t.ordem ?? i);
      }
    }
    if (Array.isArray(adicionais)) {
      stmts.apagarAdicionaisDoItem.run(id);
      for (const [i, a] of adicionais.entries()) {
        stmts.inserirAdicional.run(id, a.nome.trim(), Number(a.preco_centavos) || 0, a.ordem ?? i);
      }
    }
    return true;
  });
  return atualizar() ? buscarItem(id) : null;
}

export function toggleDisponivel(id) {
  const info = stmts.toggleDisponivelItem.run(id);
  if (info.changes === 0) return null;
  return buscarItem(id);
}

export function apagarItem(id) {
  const info = stmts.apagarItem.run(id);
  return info.changes > 0;
}
