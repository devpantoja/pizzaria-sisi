import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { criarSenha, listarAtivas, marcarPronta, marcarEntregue, reabrir, zerarSenhasDoDia } from './db.js';
import {
  listarCategorias, criarCategoria, atualizarCategoria, apagarCategoria,
  listarItens, buscarItem, criarItem, atualizarItem, toggleDisponivel, apagarItem,
} from './cardapio.js';
import { criarPedido, buscarPedido, buscarPedidoPorSenha } from './pedidos.js';
import {
  listarPropagandas, listarPropagandasAtivas, criarPropaganda, atualizarPropaganda,
  toggleAtivaPropaganda, apagarPropaganda, getConfig, setConfig,
} from './propagandas.js';
import { relatorioDia } from './relatorio.js';
import { exportarBackup, importarBackup } from './backup.js';
import {
  requireAtendente, requireAdmin,
  loginHandler, logoutHandler, sessaoHandler,
  AUTH_HABILITADO,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.set('trust proxy', 1); // pra saber se e HTTPS quando atras do Caddy/nginx
app.use(express.json({ limit: '50mb' }));

// ============= Rotas publicas (sem auth) =============
app.get('/login', (req, res) => res.sendFile(join(PUBLIC, 'login.html')));
app.post('/api/login', loginHandler);
app.post('/api/logout', logoutHandler);
app.get('/api/sessao', sessaoHandler);

// Painel TV — publico (cliente ve na TV, nao faz sentido pedir senha)
app.get('/painel', (req, res) => res.sendFile(join(PUBLIC, 'painel.html')));

// Assets estaticos (css/js/imgs) — publicos
// IMPORTANTE: NAO expor os .html sensiveis daqui (senao protecao das rotas /admin, /atendente vira teatro).
// A gente serve so os assets que os HTMLs importam.
app.use('/assets', express.static(PUBLIC, { index: false, extensions: [] }));
// Compat com HTMLs que ja referenciam /styles.css, /painel.js, etc na raiz
app.get(/^\/[^/]+\.(css|js|png|jpg|jpeg|svg|ico|woff2?)$/, (req, res, next) => {
  res.sendFile(join(PUBLIC, req.path.slice(1)), (err) => err && next());
});

// ============= APIs consumidas pelo painel publico =============
app.get('/api/propagandas/ativas', (req, res) => res.json(listarPropagandasAtivas()));
app.get('/api/config', (req, res) => res.json(getConfig()));

// Snapshot de senhas: painel precisa. Nao expoe dados sensiveis (so numero + status).
app.get('/api/senhas', (req, res) => res.json(listarAtivas()));

// ============= Rotas de ATENDENTE (atendente OU admin) =============
app.get('/', (req, res) => res.redirect('/atendente'));
app.get('/atendente', requireAtendente, (req, res) => res.sendFile(join(PUBLIC, 'atendente.html')));
app.get('/imprimir', requireAtendente, (req, res) => res.sendFile(join(PUBLIC, 'imprimir.html')));

app.post('/api/senhas', requireAtendente, (req, res) => {
  const senha = criarSenha();
  broadcast({ tipo: 'senha-criada', senha });
  res.status(201).json(senha);
});

app.post('/api/senhas/:id/pronta', requireAtendente, (req, res) => {
  const senha = marcarPronta(Number(req.params.id));
  if (!senha) return res.status(404).json({ erro: 'senha não encontrada ou já processada' });
  broadcast({ tipo: 'senha-pronta', senha });
  res.json(senha);
});

app.post('/api/senhas/:id/entregue', requireAtendente, (req, res) => {
  const senha = marcarEntregue(Number(req.params.id));
  if (!senha) return res.status(404).json({ erro: 'senha não encontrada ou já entregue' });
  broadcast({ tipo: 'senha-entregue', senha });
  res.json(senha);
});

app.post('/api/senhas/:id/reabrir', requireAtendente, (req, res) => {
  const senha = reabrir(Number(req.params.id));
  if (!senha) return res.status(404).json({ erro: 'senha não pode ser reaberta' });
  broadcast({ tipo: 'senha-reaberta', senha });
  res.json(senha);
});

// Pedidos (criar + consultar) — atendente
app.post('/api/pedidos', requireAtendente, (req, res) => {
  const { linhas, observacao } = req.body || {};
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return res.status(400).json({ erro: 'pedido precisa ter ao menos 1 item' });
  }
  try {
    const senha = criarSenha();
    const pedido = criarPedido({ senhaId: senha.id, linhas, observacao });
    broadcast({ tipo: 'senha-criada', senha });
    res.status(201).json({ senha, pedido });
  } catch (e) {
    return res.status(400).json({ erro: e.message });
  }
});

app.get('/api/pedidos/:id', requireAtendente, (req, res) => {
  const pedido = buscarPedido(Number(req.params.id));
  if (!pedido) return res.status(404).json({ erro: 'pedido não encontrado' });
  res.json(pedido);
});

app.get('/api/senhas/:id/pedido', requireAtendente, (req, res) => {
  const pedido = buscarPedidoPorSenha(Number(req.params.id));
  if (!pedido) return res.status(404).json({ erro: 'pedido não encontrado' });
  res.json(pedido);
});

// Cardápio leitura — atendente precisa pra montar pedido
app.get('/api/categorias', requireAtendente, (req, res) => res.json(listarCategorias()));
app.get('/api/itens', requireAtendente, (req, res) => res.json(listarItens()));
app.get('/api/itens/:id', requireAtendente, (req, res) => {
  const item = buscarItem(Number(req.params.id));
  if (!item) return res.status(404).json({ erro: 'item não encontrado' });
  res.json(item);
});

// ============= Rotas de ADMIN =============
app.get('/admin', requireAdmin, (req, res) => res.sendFile(join(PUBLIC, 'admin.html')));
app.get('/relatorio', requireAdmin, (req, res) => res.sendFile(join(PUBLIC, 'relatorio.html')));

app.get('/api/relatorio', requireAdmin, (req, res) => {
  res.json(relatorioDia(req.query.data));
});

// Zerar senhas — destrutivo, so admin
app.post('/api/senhas/zerar', requireAdmin, (req, res) => {
  const r = zerarSenhasDoDia();
  broadcast({ tipo: 'senhas-zeradas', ...r });
  res.json(r);
});

// Backup — so admin
app.get('/api/backup/exportar', requireAdmin, (req, res) => {
  const dados = exportarBackup();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sisi-backup-${stamp}.json"`);
  res.send(JSON.stringify(dados, null, 2));
});

app.post('/api/backup/importar', requireAdmin, (req, res) => {
  try {
    const resumo = importarBackup(req.body);
    broadcast({ tipo: 'categoria-alterada' });
    broadcast({ tipo: 'item-alterado' });
    broadcast({ tipo: 'propaganda-alterada' });
    res.json({ ok: true, resumo });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Propagandas — CRUD só admin (listagem completa e a public /ativas ja está acima)
app.get('/api/propagandas', requireAdmin, (req, res) => res.json(listarPropagandas()));

app.post('/api/propagandas', requireAdmin, (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo?.trim()) return res.status(400).json({ erro: 'título é obrigatório' });
  const p = criarPropaganda(req.body);
  broadcast({ tipo: 'propaganda-alterada' });
  res.status(201).json(p);
});

app.put('/api/propagandas/:id', requireAdmin, (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo?.trim()) return res.status(400).json({ erro: 'título é obrigatório' });
  const p = atualizarPropaganda(Number(req.params.id), req.body);
  if (!p) return res.status(404).json({ erro: 'propaganda não encontrada' });
  broadcast({ tipo: 'propaganda-alterada' });
  res.json(p);
});

app.post('/api/propagandas/:id/toggle-ativa', requireAdmin, (req, res) => {
  const p = toggleAtivaPropaganda(Number(req.params.id));
  if (!p) return res.status(404).json({ erro: 'propaganda não encontrada' });
  broadcast({ tipo: 'propaganda-alterada' });
  res.json(p);
});

app.delete('/api/propagandas/:id', requireAdmin, (req, res) => {
  const ok = apagarPropaganda(Number(req.params.id));
  if (!ok) return res.status(404).json({ erro: 'propaganda não encontrada' });
  broadcast({ tipo: 'propaganda-alterada' });
  res.status(204).end();
});

app.put('/api/config', requireAdmin, (req, res) => {
  const cfg = setConfig(req.body || {});
  broadcast({ tipo: 'config-alterada', config: cfg });
  res.json(cfg);
});

// Cardápio CRUD — só admin
app.post('/api/categorias', requireAdmin, (req, res) => {
  const { nome, ordem } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'nome é obrigatório' });
  try {
    const cat = criarCategoria({ nome, ordem });
    broadcast({ tipo: 'categoria-alterada' });
    res.status(201).json(cat);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ erro: 'categoria já existe' });
    throw e;
  }
});

app.put('/api/categorias/:id', requireAdmin, (req, res) => {
  const { nome, ordem } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'nome é obrigatório' });
  const cat = atualizarCategoria(Number(req.params.id), { nome, ordem });
  if (!cat) return res.status(404).json({ erro: 'categoria não encontrada' });
  broadcast({ tipo: 'categoria-alterada' });
  res.json(cat);
});

app.delete('/api/categorias/:id', requireAdmin, (req, res) => {
  const ok = apagarCategoria(Number(req.params.id));
  if (!ok) return res.status(404).json({ erro: 'categoria não encontrada' });
  broadcast({ tipo: 'categoria-alterada' });
  res.status(204).end();
});

app.post('/api/itens', requireAdmin, (req, res) => {
  const { categoria_id, nome } = req.body || {};
  if (!categoria_id || !nome?.trim()) return res.status(400).json({ erro: 'categoria_id e nome são obrigatórios' });
  const item = criarItem(req.body);
  broadcast({ tipo: 'item-alterado' });
  res.status(201).json(item);
});

app.put('/api/itens/:id', requireAdmin, (req, res) => {
  const { categoria_id, nome } = req.body || {};
  if (!categoria_id || !nome?.trim()) return res.status(400).json({ erro: 'categoria_id e nome são obrigatórios' });
  const item = atualizarItem(Number(req.params.id), req.body);
  if (!item) return res.status(404).json({ erro: 'item não encontrado' });
  broadcast({ tipo: 'item-alterado' });
  res.json(item);
});

app.post('/api/itens/:id/toggle-disponivel', requireAdmin, (req, res) => {
  const item = toggleDisponivel(Number(req.params.id));
  if (!item) return res.status(404).json({ erro: 'item não encontrado' });
  broadcast({ tipo: 'item-alterado' });
  res.json(item);
});

app.delete('/api/itens/:id', requireAdmin, (req, res) => {
  const ok = apagarItem(Number(req.params.id));
  if (!ok) return res.status(404).json({ erro: 'item não encontrado' });
  broadcast({ tipo: 'item-alterado' });
  res.status(204).end();
});

// ============= WebSocket =============
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ tipo: 'snapshot', senhas: listarAtivas() }));
});

function broadcast(mensagem) {
  const payload = JSON.stringify(mensagem);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function ipsLocais() {
  const nets = networkInterfaces();
  const ips = [];
  for (const nome of Object.keys(nets)) {
    for (const net of nets[nome] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Pizzaria — Sistema de Senhas (CodeGus)`);
  console.log(`  ────────────────────────────────────────`);
  console.log(`  Login:      http://localhost:${PORT}/login`);
  console.log(`  Atendente:  http://localhost:${PORT}/atendente`);
  console.log(`  Painel TV:  http://localhost:${PORT}/painel`);
  console.log(`  Cardápio:   http://localhost:${PORT}/admin`);
  console.log(`  Relatório:  http://localhost:${PORT}/relatorio`);
  if (!AUTH_HABILITADO) {
    console.log(`\n  ⚠  Modo ABERTO (sem login). Defina SENHA_ADMIN + SESSION_SECRET pra proteger.`);
  }
  const ips = ipsLocais();
  if (ips.length) {
    console.log(`\n  Na rede local (WiFi):`);
    for (const ip of ips) {
      console.log(`    http://${ip}:${PORT}/atendente`);
      console.log(`    http://${ip}:${PORT}/painel`);
    }
  }
  console.log(`\n  Ctrl+C para parar\n`);
});
