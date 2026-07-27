import db from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS propagandas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    subtitulo TEXT DEFAULT '',
    corpo TEXT DEFAULT '',
    imagem_url TEXT DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'codegus' CHECK(tipo IN ('codegus', 'terceiro')),
    ativa INTEGER NOT NULL DEFAULT 1,
    ordem INTEGER NOT NULL DEFAULT 0,
    criada_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );
`);

// Config default: intervalo entre slides (segundos) + duração de cada slide
const defaultConfig = {
  intervalo_slides_seg: '300',   // a cada 5 min mostra propaganda
  duracao_slide_seg: '10',       // slide fica 10s na tela
  pausar_com_senha_nova_seg: '15', // pausa slides por 15s quando entra senha nova
};

const stmtGetConfig = db.prepare(`SELECT valor FROM config WHERE chave = ?`);
const stmtSetConfig = db.prepare(`INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`);

for (const [k, v] of Object.entries(defaultConfig)) {
  if (!stmtGetConfig.get(k)) stmtSetConfig.run(k, v);
}

// Seed propaganda CodeGus (só uma vez)
const stmtContaProp = db.prepare(`SELECT COUNT(*) as n FROM propagandas`);
if (stmtContaProp.get().n === 0) {
  db.prepare(`
    INSERT INTO propagandas (titulo, subtitulo, corpo, tipo, ativa, ordem)
    VALUES (?, ?, ?, 'codegus', 1, 0)
  `).run(
    'CodeGus',
    'Sistemas sob medida para o seu negócio',
    'codegus.com  ·  (47) 98496-5787'
  );
}

const stmts = {
  listarTodas: db.prepare(`SELECT * FROM propagandas ORDER BY ordem, id`),
  listarAtivas: db.prepare(`SELECT * FROM propagandas WHERE ativa = 1 ORDER BY ordem, id`),
  buscar: db.prepare(`SELECT * FROM propagandas WHERE id = ?`),
  inserir: db.prepare(
    `INSERT INTO propagandas (titulo, subtitulo, corpo, imagem_url, tipo, ativa, ordem)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  atualizar: db.prepare(
    `UPDATE propagandas
     SET titulo = ?, subtitulo = ?, corpo = ?, imagem_url = ?, tipo = ?, ativa = ?, ordem = ?
     WHERE id = ?`
  ),
  toggle: db.prepare(
    `UPDATE propagandas SET ativa = CASE ativa WHEN 1 THEN 0 ELSE 1 END WHERE id = ?`
  ),
  apagar: db.prepare(`DELETE FROM propagandas WHERE id = ?`),
};

function hidratar(p) {
  if (!p) return null;
  return { ...p, ativa: p.ativa === 1 };
}

export const listarPropagandas = () => stmts.listarTodas.all().map(hidratar);
export const listarPropagandasAtivas = () => stmts.listarAtivas.all().map(hidratar);
export const buscarPropaganda = (id) => hidratar(stmts.buscar.get(id));

export function criarPropaganda({ titulo, subtitulo = '', corpo = '', imagem_url = '', tipo = 'codegus', ativa = true, ordem = 0 }) {
  const info = stmts.inserir.run(
    titulo.trim(), subtitulo, corpo, imagem_url, tipo, ativa ? 1 : 0, ordem
  );
  return buscarPropaganda(info.lastInsertRowid);
}

export function atualizarPropaganda(id, { titulo, subtitulo = '', corpo = '', imagem_url = '', tipo = 'codegus', ativa = true, ordem = 0 }) {
  const info = stmts.atualizar.run(
    titulo.trim(), subtitulo, corpo, imagem_url, tipo, ativa ? 1 : 0, ordem, id
  );
  if (info.changes === 0) return null;
  return buscarPropaganda(id);
}

export function toggleAtivaPropaganda(id) {
  const info = stmts.toggle.run(id);
  if (info.changes === 0) return null;
  return buscarPropaganda(id);
}

export function apagarPropaganda(id) {
  return stmts.apagar.run(id).changes > 0;
}

export function getConfig() {
  const rows = db.prepare(`SELECT chave, valor FROM config`).all();
  const cfg = {};
  for (const r of rows) cfg[r.chave] = r.valor;
  return {
    intervalo_slides_seg: Number(cfg.intervalo_slides_seg) || 300,
    duracao_slide_seg: Number(cfg.duracao_slide_seg) || 10,
    pausar_com_senha_nova_seg: Number(cfg.pausar_com_senha_nova_seg) || 15,
  };
}

export function setConfig(patch) {
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (['intervalo_slides_seg', 'duracao_slide_seg', 'pausar_com_senha_nova_seg'].includes(k)) {
        stmtSetConfig.run(k, String(v));
      }
    }
  });
  tx();
  return getConfig();
}
