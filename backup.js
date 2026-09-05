// backup.js — export/import JSON de todo o sistema.
//
// Export: dump completo de cadastros + historico.
// Import (merge): mantem o que existe, adiciona/atualiza do backup.
//   - categorias: chave = nome
//   - itens: chave = (categoria_nome, nome) — tamanhos/adicionais sao substituidos
//   - propagandas: chave = titulo
//   - config: chave (KV)
//   - senhas: chave = (dia, numero) — ignora se colidir
//   - pedidos: sempre insere novo (senha_id remapeado)

import db from './db.js';

const VERSAO_BACKUP = 1;

// ============= EXPORT =============
export function exportarBackup() {
  const categorias = db.prepare('SELECT * FROM categorias ORDER BY id').all();
  const itens = db.prepare('SELECT * FROM itens ORDER BY id').all();
  const tamanhos = db.prepare('SELECT * FROM tamanhos ORDER BY id').all();
  const adicionais = db.prepare('SELECT * FROM adicionais ORDER BY id').all();
  const propagandas = db.prepare('SELECT * FROM propagandas ORDER BY id').all();
  const config = db.prepare('SELECT * FROM config').all();
  const senhas = db.prepare('SELECT * FROM senhas ORDER BY id').all();
  const pedidos = db.prepare('SELECT * FROM pedidos ORDER BY id').all();
  const pedido_itens = db.prepare('SELECT * FROM pedido_itens ORDER BY id').all();
  const pedido_item_adicionais = db.prepare('SELECT * FROM pedido_item_adicionais ORDER BY id').all();

  return {
    versao_backup: VERSAO_BACKUP,
    exportado_em: new Date().toISOString(),
    origem: 'sisi-pizzeria',
    dados: {
      categorias, itens, tamanhos, adicionais,
      propagandas, config,
      senhas, pedidos, pedido_itens, pedido_item_adicionais,
    },
  };
}

// ============= IMPORT (merge) =============
export function importarBackup(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Backup invalido: nao e um objeto JSON');
  }
  if (payload.versao_backup !== VERSAO_BACKUP) {
    throw new Error(`Versao de backup incompativel (esperado ${VERSAO_BACKUP}, veio ${payload.versao_backup})`);
  }
  const d = payload.dados || {};
  const req = ['categorias', 'itens', 'tamanhos', 'adicionais', 'propagandas', 'config'];
  for (const k of req) {
    if (!Array.isArray(d[k])) throw new Error(`Backup invalido: falta "${k}"`);
  }

  const resumo = {
    categorias: { criadas: 0, atualizadas: 0 },
    itens:      { criados: 0, atualizados: 0 },
    propagandas:{ criadas: 0, atualizadas: 0 },
    config:     { chaves: 0 },
    senhas:     { importadas: 0, ignoradas: 0 },
    pedidos:    { importados: 0 },
  };

  // Statements
  const s = {
    getCat:      db.prepare('SELECT id FROM categorias WHERE nome = ?'),
    insCat:      db.prepare('INSERT INTO categorias (nome, ordem) VALUES (?, ?)'),
    updCat:      db.prepare('UPDATE categorias SET ordem = ? WHERE id = ?'),

    getItem:     db.prepare('SELECT id FROM itens WHERE categoria_id = ? AND nome = ?'),
    insItem:     db.prepare('INSERT INTO itens (categoria_id, nome, descricao, disponivel, ordem) VALUES (?, ?, ?, ?, ?)'),
    updItem:     db.prepare('UPDATE itens SET descricao = ?, disponivel = ?, ordem = ? WHERE id = ?'),
    delTam:      db.prepare('DELETE FROM tamanhos WHERE item_id = ?'),
    delAdd:      db.prepare('DELETE FROM adicionais WHERE item_id = ?'),
    insTam:      db.prepare('INSERT INTO tamanhos (item_id, nome, preco_centavos, ordem) VALUES (?, ?, ?, ?)'),
    insAdd:      db.prepare('INSERT INTO adicionais (item_id, nome, preco_centavos, ordem) VALUES (?, ?, ?, ?)'),

    getProp:     db.prepare('SELECT id FROM propagandas WHERE titulo = ?'),
    insProp:     db.prepare('INSERT INTO propagandas (titulo, subtitulo, corpo, imagem_url, tipo, ativa, ordem, criada_em) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime(\'now\', \'localtime\')))'),
    updProp:     db.prepare('UPDATE propagandas SET subtitulo = ?, corpo = ?, imagem_url = ?, tipo = ?, ativa = ?, ordem = ?, criada_em = COALESCE(?, criada_em) WHERE id = ?'),

    setConfig:   db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'),

    getSenha:    db.prepare('SELECT id FROM senhas WHERE dia = ? AND numero = ?'),
    insSenha:    db.prepare('INSERT INTO senhas (numero, status, criada_em, pronta_em, entregue_em, dia) VALUES (?, ?, ?, ?, ?, ?)'),

    insPedido:   db.prepare('INSERT INTO pedidos (senha_id, total_centavos, observacao, criado_em) VALUES (?, ?, ?, ?)'),
    insPedItem:  db.prepare(`INSERT INTO pedido_itens
      (pedido_id, item_id, item2_id, nome_snapshot, tamanho_nome, tamanho_id, tamanho2_id,
       quantidade, preco_base_centavos, preco_adicionais_centavos, preco_total_centavos, meia_meia)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insPedItemAdd: db.prepare('INSERT INTO pedido_item_adicionais (pedido_item_id, adicional_id, nome_snapshot, preco_centavos) VALUES (?, ?, ?, ?)'),
  };

  const tx = db.transaction(() => {
    // 1. Categorias — mapa oldId -> newId
    const mapCat = new Map();
    for (const c of d.categorias) {
      const existente = s.getCat.get(c.nome);
      if (existente) {
        s.updCat.run(c.ordem ?? 0, existente.id);
        mapCat.set(c.id, existente.id);
        resumo.categorias.atualizadas++;
      } else {
        const info = s.insCat.run(c.nome, c.ordem ?? 0);
        mapCat.set(c.id, info.lastInsertRowid);
        resumo.categorias.criadas++;
      }
    }

    // 2. Itens (usa cat mapeada) — mapa oldItemId -> newItemId
    const mapItem = new Map();
    for (const it of d.itens) {
      const newCatId = mapCat.get(it.categoria_id);
      if (!newCatId) continue; // orfao, ignora
      const existente = s.getItem.get(newCatId, it.nome);
      let newId;
      if (existente) {
        s.updItem.run(it.descricao ?? '', it.disponivel ?? 1, it.ordem ?? 0, existente.id);
        newId = existente.id;
        // Substitui tamanhos/adicionais (evita duplicar preços)
        s.delTam.run(newId);
        s.delAdd.run(newId);
        resumo.itens.atualizados++;
      } else {
        const info = s.insItem.run(newCatId, it.nome, it.descricao ?? '', it.disponivel ?? 1, it.ordem ?? 0);
        newId = info.lastInsertRowid;
        resumo.itens.criados++;
      }
      mapItem.set(it.id, newId);
    }

    // 3. Tamanhos (usa item mapeado) — mapa oldTamId -> newTamId (pra remapear em pedido_itens)
    const mapTam = new Map();
    for (const t of d.tamanhos) {
      const newItemId = mapItem.get(t.item_id);
      if (!newItemId) continue;
      const info = s.insTam.run(newItemId, t.nome, t.preco_centavos ?? 0, t.ordem ?? 0);
      mapTam.set(t.id, info.lastInsertRowid);
    }

    // 4. Adicionais — mapa oldAddId -> newAddId
    const mapAdd = new Map();
    for (const a of d.adicionais) {
      const newItemId = mapItem.get(a.item_id);
      if (!newItemId) continue;
      const info = s.insAdd.run(newItemId, a.nome, a.preco_centavos ?? 0, a.ordem ?? 0);
      mapAdd.set(a.id, info.lastInsertRowid);
    }

    // 5. Propagandas
    for (const p of d.propagandas) {
      const existente = s.getProp.get(p.titulo);
      if (existente) {
        s.updProp.run(p.subtitulo ?? '', p.corpo ?? '', p.imagem_url ?? '', p.tipo ?? 'codegus', p.ativa ?? 1, p.ordem ?? 0, p.criada_em ?? null, existente.id);
        resumo.propagandas.atualizadas++;
      } else {
        s.insProp.run(p.titulo, p.subtitulo ?? '', p.corpo ?? '', p.imagem_url ?? '', p.tipo ?? 'codegus', p.ativa ?? 1, p.ordem ?? 0, p.criada_em ?? null);
        resumo.propagandas.criadas++;
      }
    }

    // 6. Config
    for (const c of d.config) {
      s.setConfig.run(c.chave, c.valor);
      resumo.config.chaves++;
    }

    // 7. Historico (senhas + pedidos) — se veio no backup
    if (Array.isArray(d.senhas)) {
      const mapSenha = new Map();
      for (const sn of d.senhas) {
        if (s.getSenha.get(sn.dia, sn.numero)) {
          resumo.senhas.ignoradas++;
          continue;
        }
        const info = s.insSenha.run(sn.numero, sn.status, sn.criada_em, sn.pronta_em, sn.entregue_em, sn.dia);
        mapSenha.set(sn.id, info.lastInsertRowid);
        resumo.senhas.importadas++;
      }

      if (Array.isArray(d.pedidos) && Array.isArray(d.pedido_itens)) {
        const mapPedido = new Map();
        for (const p of d.pedidos) {
          const newSenhaId = mapSenha.get(p.senha_id);
          if (!newSenhaId) continue; // senha original nao entrou (colisao) — ignora pedido
          const info = s.insPedido.run(newSenhaId, p.total_centavos ?? 0, p.observacao ?? '', p.criado_em);
          mapPedido.set(p.id, info.lastInsertRowid);
          resumo.pedidos.importados++;
        }

        const mapPedItem = new Map();
        for (const pi of d.pedido_itens) {
          const newPedidoId = mapPedido.get(pi.pedido_id);
          if (!newPedidoId) continue;
          const info = s.insPedItem.run(
            newPedidoId,
            mapItem.get(pi.item_id) ?? null,
            pi.item2_id ? (mapItem.get(pi.item2_id) ?? null) : null,
            pi.nome_snapshot,
            pi.tamanho_nome,
            pi.tamanho_id ? (mapTam.get(pi.tamanho_id) ?? null) : null,
            pi.tamanho2_id ? (mapTam.get(pi.tamanho2_id) ?? null) : null,
            pi.quantidade ?? 1,
            pi.preco_base_centavos ?? 0,
            pi.preco_adicionais_centavos ?? 0,
            pi.preco_total_centavos ?? 0,
            pi.meia_meia ?? 0,
          );
          mapPedItem.set(pi.id, info.lastInsertRowid);
        }

        if (Array.isArray(d.pedido_item_adicionais)) {
          for (const pa of d.pedido_item_adicionais) {
            const newPedItemId = mapPedItem.get(pa.pedido_item_id);
            if (!newPedItemId) continue;
            s.insPedItemAdd.run(
              newPedItemId,
              pa.adicional_id ? (mapAdd.get(pa.adicional_id) ?? null) : null,
              pa.nome_snapshot,
              pa.preco_centavos ?? 0,
            );
          }
        }
      }
    }
  });

  tx();
  return resumo;
}
