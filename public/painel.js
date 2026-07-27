const $ = (id) => document.getElementById(id);
const statusEl = $('statusConexao');
const senhasPreparando = $('senhasPreparando');
const senhasProntas = $('senhasProntas');
const telaSlide = $('telaSlide');

let senhas = [];
let ultimaProntaId = null;
let ws;

// ============= Propagandas =============
let propagandas = [];
let config = { intervalo_slides_seg: 300, duracao_slide_seg: 10, pausar_com_senha_nova_seg: 15 };
let idxSlide = 0;
let timerProximo = null;
let timerFimSlide = null;
let proximoSlideEm = null; // timestamp em ms

async function carregarPropagandas() {
  try {
    const [props, cfg] = await Promise.all([
      fetch('/api/propagandas/ativas').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]);
    propagandas = props;
    config = cfg;
    reiniciarCiclo();
  } catch (e) {
    console.warn('Erro ao carregar propagandas', e);
  }
}

function reiniciarCiclo() {
  clearTimeout(timerProximo);
  clearTimeout(timerFimSlide);
  if (!propagandas.length) {
    proximoSlideEm = null;
    return;
  }
  proximoSlideEm = Date.now() + config.intervalo_slides_seg * 1000;
  timerProximo = setTimeout(mostrarProximoSlide, config.intervalo_slides_seg * 1000);
}

function adiarPorSenha() {
  // Quando entra senha nova, adia o próximo slide
  if (!propagandas.length) return;
  const agora = Date.now();
  const alvo = agora + config.pausar_com_senha_nova_seg * 1000;
  if (proximoSlideEm && alvo > proximoSlideEm) {
    clearTimeout(timerProximo);
    proximoSlideEm = alvo;
    timerProximo = setTimeout(mostrarProximoSlide, config.pausar_com_senha_nova_seg * 1000);
  }
}

function mostrarProximoSlide() {
  if (!propagandas.length) return;
  const p = propagandas[idxSlide % propagandas.length];
  idxSlide++;
  renderSlide(p);
  telaSlide.classList.add('visivel');
  telaSlide.className = 'visivel ' + (p.tipo === 'terceiro' ? 'terceiro' : 'codegus');

  timerFimSlide = setTimeout(esconderSlide, config.duracao_slide_seg * 1000);
  proximoSlideEm = null;
}

function esconderSlide() {
  telaSlide.classList.remove('visivel');
  reiniciarCiclo();
}

function renderSlide(p) {
  // CodeGus sempre exibe "CG"; propagandas de terceiros usam as iniciais das 2 primeiras palavras
  const selo = p.tipo === 'codegus'
    ? 'CG'
    : (p.titulo || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || 'AD';
  $('slideSelo').textContent = selo;
  $('slideTitulo').textContent = p.titulo;
  $('slideSubtitulo').textContent = p.subtitulo || '';
  $('slideSubtitulo').style.display = p.subtitulo ? '' : 'none';
  $('slideCorpo').textContent = p.corpo || '';
  $('slideCorpo').style.display = p.corpo ? '' : 'none';
  const img = $('slideImagem');
  if (p.imagem_url) {
    img.src = p.imagem_url;
    img.style.display = '';
  } else {
    img.style.display = 'none';
  }
}

// Indicador de próximo slide (canto superior esquerdo)
setInterval(() => {
  const el = $('proximoSlide');
  if (!proximoSlideEm || !propagandas.length) {
    el.textContent = '';
    return;
  }
  const seg = Math.max(0, Math.round((proximoSlideEm - Date.now()) / 1000));
  el.textContent = `próxima propaganda em ${seg}s`;
}, 1000);

// ============= WebSocket =============
function conectar() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    statusEl.textContent = 'online';
    statusEl.classList.remove('offline');
  });

  ws.addEventListener('close', () => {
    statusEl.textContent = 'reconectando…';
    statusEl.classList.add('offline');
    setTimeout(conectar, 2000);
  });

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.tipo === 'snapshot') {
      senhas = msg.senhas;
    } else if (msg.tipo === 'senha-criada') {
      senhas.push(msg.senha);
      adiarPorSenha();
    } else if (msg.tipo === 'senha-pronta') {
      const i = senhas.findIndex(s => s.id === msg.senha.id);
      if (i >= 0) senhas[i] = msg.senha;
      ultimaProntaId = msg.senha.id;
      adiarPorSenha();
    } else if (msg.tipo === 'senha-reaberta') {
      const i = senhas.findIndex(s => s.id === msg.senha.id);
      if (i >= 0) senhas[i] = msg.senha;
      if (ultimaProntaId === msg.senha.id) ultimaProntaId = null;
    } else if (msg.tipo === 'senha-entregue') {
      senhas = senhas.filter(s => s.id !== msg.senha.id);
      if (ultimaProntaId === msg.senha.id) ultimaProntaId = null;
    } else if (msg.tipo === 'senhas-zeradas') {
      senhas = [];
      ultimaProntaId = null;
    } else if (msg.tipo === 'propaganda-alterada' || msg.tipo === 'config-alterada') {
      carregarPropagandas();
    }
    render();
  });
}

// ============= Render =============
function n(numero, destaque) {
  const div = document.createElement('div');
  div.className = 'n' + (destaque ? ' destaque' : '');
  div.textContent = String(numero).padStart(2, '0');
  return div;
}

function vazio(texto) {
  const div = document.createElement('div');
  div.className = 'vazio';
  div.textContent = texto;
  return div;
}

function render() {
  const preparando = senhas.filter(s => s.status === 'preparando');
  const prontas = senhas.filter(s => s.status === 'pronto');

  senhasPreparando.replaceChildren(
    ...(preparando.length ? preparando.map(s => n(s.numero, false)) : [vazio('—')])
  );

  const idDestaque = ultimaProntaId ?? (prontas[prontas.length - 1]?.id);
  senhasProntas.replaceChildren(
    ...(prontas.length ? prontas.map(s => n(s.numero, s.id === idDestaque)) : [vazio('—')])
  );
}

conectar();
carregarPropagandas();
render();
