import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = './data/pizzaria.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS senhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('preparando', 'pronto', 'entregue')),
    criada_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    pronta_em TEXT,
    entregue_em TEXT,
    dia TEXT NOT NULL DEFAULT (date('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_senhas_status ON senhas(status);
  CREATE INDEX IF NOT EXISTS idx_senhas_dia ON senhas(dia);
`);

const hoje = () => new Date().toISOString().slice(0, 10);

const stmts = {
  proximoNumero: db.prepare(
    `SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM senhas WHERE dia = ?`
  ),
  inserir: db.prepare(
    `INSERT INTO senhas (numero, status, dia) VALUES (?, 'preparando', ?)`
  ),
  buscarPorId: db.prepare(`SELECT * FROM senhas WHERE id = ?`),
  ativas: db.prepare(
    `SELECT * FROM senhas WHERE status IN ('preparando', 'pronto') ORDER BY criada_em ASC`
  ),
  marcarPronta: db.prepare(
    `UPDATE senhas SET status = 'pronto', pronta_em = datetime('now', 'localtime') WHERE id = ? AND status = 'preparando'`
  ),
  marcarEntregue: db.prepare(
    `UPDATE senhas SET status = 'entregue', entregue_em = datetime('now', 'localtime') WHERE id = ? AND status = 'pronto'`
  ),
  reabrir: db.prepare(
    `UPDATE senhas SET status = 'preparando', pronta_em = NULL WHERE id = ? AND status = 'pronto'`
  ),
  // Zerar: apaga todas as senhas do dia atual (contador volta pra 01)
  // Pedidos e itens caem em cascata via FK ON DELETE CASCADE.
  apagarSenhasDoDia: db.prepare(`DELETE FROM senhas WHERE dia = ?`),
  contarSenhasDoDia: db.prepare(`SELECT COUNT(*) as n FROM senhas WHERE dia = ?`),
};

export function criarSenha() {
  const dia = hoje();
  const { proximo } = stmts.proximoNumero.get(dia);
  const info = stmts.inserir.run(proximo, dia);
  return stmts.buscarPorId.get(info.lastInsertRowid);
}

export function listarAtivas() {
  return stmts.ativas.all();
}

export function marcarPronta(id) {
  const info = stmts.marcarPronta.run(id);
  if (info.changes === 0) return null;
  return stmts.buscarPorId.get(id);
}

export function marcarEntregue(id) {
  const info = stmts.marcarEntregue.run(id);
  if (info.changes === 0) return null;
  return stmts.buscarPorId.get(id);
}

export function reabrir(id) {
  const info = stmts.reabrir.run(id);
  if (info.changes === 0) return null;
  return stmts.buscarPorId.get(id);
}

export function zerarSenhasDoDia() {
  const dia = hoje();
  const antes = stmts.contarSenhasDoDia.get(dia).n;
  const info = stmts.apagarSenhasDoDia.run(dia);
  return { dia, apagadas: info.changes, antes };
}

export default db;
