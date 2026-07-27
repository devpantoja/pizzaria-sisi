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
import { checarAtualizacao, statusUpdate, baixarESubstituir, iniciarAutoCheck } from './updater.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/atendente'));
app.get('/atendente', (req, res) => res.sendFile(join(__dirname, 'public', 'atendente.html')));
app.get('/painel', (req, res) => res.sendFile(join(__dirname, 'public', 'painel.html')));
app.get('/admin', (req, res) => res.sendFile(join(__dirname, 'public', 'admin.html')));
app.get('/relatorio', (req, res) => res.sendFile(join(__dirname, 'public', 'relatorio.html')));
app.get('/imprimir', (req, res) => res.sendFile(join(__dirname, 'public', 'imprimir.html')));

app.get('/api/relatorio', (req, res) => {
  const data = req.query.data;
  res.json(relatorioDia(data));
});

// ============= Auto-update =============
app.get('/api/versao', (req, res) => res.json(statusUpdate()));

app.post('/api/versao/checar', async (req, res) => {
  const r = await checarAtualizacao();
  broadcast({ tipo: 'versao-checada', ...r });
  res.json(r);
});

app.post('/api/versao/atualizar', async (req, res) => {
  try {
    const r = await baixarESubstituir();
    res.json({ ...r, mensagem: 'Servidor será reiniciado em alguns segundos' });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/senhas', (req, res) => {
  res.json(listarAtivas());
});

app.post('/api/senhas', (req, res) => {
  const senha = criarSenha();
  broadcast({ tipo: 'senha-criada', senha });
  res.status(201).json(senha);
});

app.post('/api/senhas/:id/pronta', (req, res) => {
  const senha = marcarPronta(Number(req.params.id));
  if (!senha) return res.status(404).json({ erro: 'senha não encontrada ou já processada' });
  broadcast({ tipo: 'senha-pronta', senha });
  res.json(senha);
});

app.post('/api/senhas/:id/entregue', (req, res) => {
  const senha = marcarEntregue(Number(req.params.id));
  if (!senha) return res.status(404).json({ erro: 'senha não encontrada ou já entregue' });
  broadcast({ tipo: 'senha-entregue', senha });
  res.json(senha);
});

app.post('/api/senhas/:id/reabrir', (req, res) => {
  const senha = reabrir(Number(req.params.id));
  if (!senha) return res.status(404).json({ erro: 'senha não pode ser reaberta' });
  broadcast({ tipo: 'senha-reaberta', senha });
  res.json(senha);
});

// Zera todas as senhas do dia (contador volta pra 01)
app.post('/api/senhas/zerar', (req, res) => {
  const r = zerarSenhasDoDia();
  broadcast({ tipo: 'senhas-zeradas', ...r });
  res.json(r);
});

// ============= Pedidos =============
// Cria senha + pedido em uma operação atômica
app.post('/api/pedidos', (req, res) => {
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

app.get('/api/pedidos/:id', (req, res) => {
  const pedido = buscarPedido(Number(req.params.id));
  if (!pedido) return res.status(404).json({ erro: 'pedido não encontrado' });
  res.json(pedido);
});

app.get('/api/senhas/:id/pedido', (req, res) => {
  const pedido = buscarPedidoPorSenha(Number(req.params.id));
  if (!pedido) return res.status(404).json({ erro: 'pedido não encontrado' });
  res.json(pedido);
});

// ============= Propagandas =============
app.get('/api/propagandas', (req, res) => res.json(listarPropagandas()));

app.get('/api/propagandas/ativas', (req, res) => res.json(listarPropagandasAtivas()));

app.post('/api/propagandas', (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo?.trim()) return res.status(400).json({ erro: 'título é obrigatório' });
  const p = criarPropaganda(req.body);
  broadcast({ tipo: 'propaganda-alterada' });
  res.status(201).json(p);
});

app.put('/api/propagandas/:id', (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo?.trim()) return res.status(400).json({ erro: 'título é obrigatório' });
  const p = atualizarPropaganda(Number(req.params.id), req.body);
  if (!p) return res.status(404).json({ erro: 'propaganda não encontrada' });
  broadcast({ tipo: 'propaganda-alterada' });
  res.json(p);
});

app.post('/api/propagandas/:id/toggle-ativa', (req, res) => {
  const p = toggleAtivaPropaganda(Number(req.params.id));
  if (!p) return res.status(404).json({ erro: 'propaganda não encontrada' });
  broadcast({ tipo: 'propaganda-alterada' });
  res.json(p);
});

app.delete('/api/propagandas/:id', (req, res) => {
  const ok = apagarPropaganda(Number(req.params.id));
  if (!ok) return res.status(404).json({ erro: 'propaganda não encontrada' });
  broadcast({ tipo: 'propaganda-alterada' });
  res.status(204).end();
});

app.get('/api/config', (req, res) => res.json(getConfig()));
app.put('/api/config', (req, res) => {
  const cfg = setConfig(req.body || {});
  broadcast({ tipo: 'config-alterada', config: cfg });
  res.json(cfg);
});

// ============= Cardápio =============
app.get('/api/categorias', (req, res) => res.json(listarCategorias()));

app.post('/api/categorias', (req, res) => {
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

app.put('/api/categorias/:id', (req, res) => {
  const { nome, ordem } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'nome é obrigatório' });
  const cat = atualizarCategoria(Number(req.params.id), { nome, ordem });
  if (!cat) return res.status(404).json({ erro: 'categoria não encontrada' });
  broadcast({ tipo: 'categoria-alterada' });
  res.json(cat);
});

app.delete('/api/categorias/:id', (req, res) => {
  const ok = apagarCategoria(Number(req.params.id));
  if (!ok) return res.status(404).json({ erro: 'categoria não encontrada' });
  broadcast({ tipo: 'categoria-alterada' });
  res.status(204).end();
});

app.get('/api/itens', (req, res) => res.json(listarItens()));

app.get('/api/itens/:id', (req, res) => {
  const item = buscarItem(Number(req.params.id));
  if (!item) return res.status(404).json({ erro: 'item não encontrado' });
  res.json(item);
});

app.post('/api/itens', (req, res) => {
  const { categoria_id, nome } = req.body || {};
  if (!categoria_id || !nome?.trim()) return res.status(400).json({ erro: 'categoria_id e nome são obrigatórios' });
  const item = criarItem(req.body);
  broadcast({ tipo: 'item-alterado' });
  res.status(201).json(item);
});

app.put('/api/itens/:id', (req, res) => {
  const { categoria_id, nome } = req.body || {};
  if (!categoria_id || !nome?.trim()) return res.status(400).json({ erro: 'categoria_id e nome são obrigatórios' });
  const item = atualizarItem(Number(req.params.id), req.body);
  if (!item) return res.status(404).json({ erro: 'item não encontrado' });
  broadcast({ tipo: 'item-alterado' });
  res.json(item);
});

app.post('/api/itens/:id/toggle-disponivel', (req, res) => {
  const item = toggleDisponivel(Number(req.params.id));
  if (!item) return res.status(404).json({ erro: 'item não encontrado' });
  broadcast({ tipo: 'item-alterado' });
  res.json(item);
});

app.delete('/api/itens/:id', (req, res) => {
  const ok = apagarItem(Number(req.params.id));
  if (!ok) return res.status(404).json({ erro: 'item não encontrado' });
  broadcast({ tipo: 'item-alterado' });
  res.status(204).end();
});

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
  console.log(`  Atendente:  http://localhost:${PORT}/atendente`);
  console.log(`  Painel TV:  http://localhost:${PORT}/painel`);
  console.log(`  Cardápio:   http://localhost:${PORT}/admin`);
  console.log(`  Relatório:  http://localhost:${PORT}/relatorio`);
  const ips = ipsLocais();
  if (ips.length) {
    console.log(`\n  Na rede local (WiFi):`);
    for (const ip of ips) {
      console.log(`    http://${ip}:${PORT}/atendente`);
      console.log(`    http://${ip}:${PORT}/painel`);
    }
  }
  console.log(`\n  Ctrl+C para parar\n`);
  iniciarAutoCheck();
});
