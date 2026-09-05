const $ = (id) => document.getElementById(id);
const cardapio = $('cardapio');
const statusEl = $('statusConexao');

let categorias = [];
let itens = [];
let propagandas = [];
let config = {};
let ws;

// ============= Abas =============
document.querySelectorAll('.aba-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.aba-btn').forEach(b => {
      b.classList.remove('ativa');
      b.style.color = 'var(--cinza-500)';
      b.style.borderBottomColor = 'transparent';
      b.style.fontWeight = '600';
    });
    btn.classList.add('ativa');
    btn.style.color = 'var(--primaria)';
    btn.style.borderBottomColor = 'var(--acento)';
    btn.style.fontWeight = '700';

    const aba = btn.dataset.aba;
    $('secaoCardapio').style.display = aba === 'cardapio' ? '' : 'none';
    $('secaoPropagandas').style.display = aba === 'propagandas' ? '' : 'none';
    $('secaoSistema').style.display = aba === 'sistema' ? '' : 'none';
    if (aba === 'propagandas') carregarPropagandas();
    if (aba === 'sistema') carregarSistema();
  };
});

// ============= Conexão WebSocket =============
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
    if (msg.tipo === 'categoria-alterada' || msg.tipo === 'item-alterado') {
      carregar();
    } else if (msg.tipo === 'propaganda-alterada' || msg.tipo === 'config-alterada') {
      carregarPropagandas();
    }
  });
}

// ============= API =============
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (r.status === 204) return null;
  const data = await r.json();
  if (!r.ok) throw new Error(data.erro || 'erro na requisição');
  return data;
}

async function carregar() {
  [categorias, itens] = await Promise.all([
    api('GET', '/api/categorias'),
    api('GET', '/api/itens'),
  ]);
  render();
}

// ============= Render =============
function render() {
  if (!categorias.length) {
    cardapio.innerHTML = `<div class="vazio">Nenhuma categoria cadastrada. Comece criando uma categoria (ex: "Pizzas Salgadas").</div>`;
    return;
  }
  cardapio.replaceChildren(...categorias.map(blocoCategoria));
}

function blocoCategoria(cat) {
  const itensCat = itens.filter(i => i.categoria_id === cat.id);
  const bloco = document.createElement('div');
  bloco.className = 'categoria-bloco';

  const header = document.createElement('div');
  header.className = 'categoria-header';
  header.innerHTML = `
    <h3>${escape(cat.nome)} <span class="qty">${itensCat.length}</span></h3>
    <div class="acoes">
      <button class="btn btn-cat" onclick="editarCategoria(${cat.id})">editar</button>
      <button class="btn btn-cat" onclick="apagarCategoria(${cat.id})">apagar</button>
    </div>
  `;
  bloco.appendChild(header);

  const container = document.createElement('div');
  container.className = 'categoria-itens';
  if (!itensCat.length) {
    container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--cinza-500); font-size: 13px;">Nenhum item nessa categoria.</div>`;
  } else {
    itensCat.forEach(item => container.appendChild(linhaItem(item)));
  }
  bloco.appendChild(container);
  return bloco;
}

function linhaItem(item) {
  const linha = document.createElement('div');
  linha.className = 'item-linha' + (item.disponivel ? '' : ' indisponivel');

  const tags = [
    ...item.tamanhos.map(t => `<span class="tag tamanho">${escape(t.nome)} · ${formatarPreco(t.preco_centavos)}</span>`),
    ...item.adicionais.map(a => `<span class="tag adicional">+ ${escape(a.nome)}${a.preco_centavos ? ` (${formatarPreco(a.preco_centavos)})` : ''}</span>`),
  ].join('');

  linha.innerHTML = `
    <div class="info">
      <div class="nome">${escape(item.nome)}</div>
      ${item.descricao ? `<div class="desc">${escape(item.descricao)}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
    </div>
    <button class="esgotado-toggle" onclick="toggleDisponivel(${item.id})">
      ${item.disponivel ? 'Disponível' : 'Esgotado'}
    </button>
    <div class="acoes">
      <button class="btn btn-cinza btn-pequeno" onclick="editarItem(${item.id})">editar</button>
      <button class="btn btn-perigo btn-pequeno" onclick="apagarItem(${item.id})">×</button>
    </div>
  `;
  return linha;
}

function formatarPreco(centavos) {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============= Modais =============
function abrirModal(id) { $(id).classList.add('aberto'); }
function fecharModal(event, id) {
  if (event && event.target !== event.currentTarget) return;
  $(id).classList.remove('aberto');
}

// --- Categoria ---
window.abrirModalCategoria = function() {
  $('tituloCategoria').textContent = 'Nova categoria';
  $('catId').value = '';
  $('catNome').value = '';
  $('catOrdem').value = 0;
  abrirModal('modalCategoria');
  setTimeout(() => $('catNome').focus(), 50);
};

window.editarCategoria = function(id) {
  const cat = categorias.find(c => c.id === id);
  if (!cat) return;
  $('tituloCategoria').textContent = 'Editar categoria';
  $('catId').value = cat.id;
  $('catNome').value = cat.nome;
  $('catOrdem').value = cat.ordem;
  abrirModal('modalCategoria');
};

window.salvarCategoria = async function() {
  const id = $('catId').value;
  const dados = {
    nome: $('catNome').value,
    ordem: Number($('catOrdem').value) || 0,
  };
  try {
    if (id) await api('PUT', `/api/categorias/${id}`, dados);
    else await api('POST', '/api/categorias', dados);
    fecharModal(null, 'modalCategoria');
    toast(id ? 'Categoria atualizada' : 'Categoria criada');
  } catch (e) {
    toast(e.message, true);
  }
};

window.apagarCategoria = async function(id) {
  const cat = categorias.find(c => c.id === id);
  const itensCat = itens.filter(i => i.categoria_id === id);
  const msg = itensCat.length
    ? `Apagar "${cat.nome}"? Isso remove também ${itensCat.length} item(ns).`
    : `Apagar "${cat.nome}"?`;
  if (!confirm(msg)) return;
  await api('DELETE', `/api/categorias/${id}`);
  toast('Categoria apagada');
};

// --- Item ---
window.abrirModalItem = function() {
  if (!categorias.length) {
    toast('Crie uma categoria antes', true);
    return;
  }
  $('tituloItem').textContent = 'Novo item';
  $('itemId').value = '';
  $('itemNome').value = '';
  $('itemDescricao').value = '';
  popularSelectCategorias();
  $('itemCategoria').value = categorias[0].id;
  renderTamanhos([]);
  renderAdicionais([]);
  abrirModal('modalItem');
  setTimeout(() => $('itemNome').focus(), 50);
};

window.editarItem = function(id) {
  const item = itens.find(i => i.id === id);
  if (!item) return;
  $('tituloItem').textContent = 'Editar item';
  $('itemId').value = item.id;
  $('itemNome').value = item.nome;
  $('itemDescricao').value = item.descricao || '';
  popularSelectCategorias();
  $('itemCategoria').value = item.categoria_id;
  renderTamanhos(item.tamanhos);
  renderAdicionais(item.adicionais);
  abrirModal('modalItem');
};

function popularSelectCategorias() {
  $('itemCategoria').innerHTML = categorias.map(c => `<option value="${c.id}">${escape(c.nome)}</option>`).join('');
}

function renderTamanhos(lista) {
  const container = $('tamanhos');
  container.replaceChildren(...lista.map(t => linhaSubItem(t.nome, t.preco_centavos, 'tam')));
  if (!lista.length) adicionarTamanho();
}

function renderAdicionais(lista) {
  const container = $('adicionais');
  container.replaceChildren(...lista.map(a => linhaSubItem(a.nome, a.preco_centavos, 'add')));
}

function linhaSubItem(nome = '', precoCentavos = 0, tipo = 'tam') {
  const div = document.createElement('div');
  div.className = 'sub-item';
  div.dataset.tipo = tipo;
  const placeholder = tipo === 'tam' ? 'Ex: Broto' : 'Ex: Borda catupiry';
  div.innerHTML = `
    <input type="text" class="sub-nome" placeholder="${placeholder}" value="${escape(nome)}">
    <input type="text" class="sub-preco" placeholder="R$ 0,00" value="${precoCentavos ? (precoCentavos / 100).toFixed(2).replace('.', ',') : ''}">
    <button type="button" title="Remover">×</button>
  `;
  div.querySelector('button').onclick = () => div.remove();
  return div;
}

window.adicionarTamanho = function() {
  $('tamanhos').appendChild(linhaSubItem('', 0, 'tam'));
};

window.adicionarAdicional = function() {
  $('adicionais').appendChild(linhaSubItem('', 0, 'add'));
};

function coletarSubItens(containerId) {
  return [...$(containerId).querySelectorAll('.sub-item')].map((div, i) => {
    const nome = div.querySelector('.sub-nome').value.trim();
    const precoStr = div.querySelector('.sub-preco').value.replace(/[^\d,\.]/g, '').replace(',', '.');
    const preco = parseFloat(precoStr) || 0;
    return { nome, preco_centavos: Math.round(preco * 100), ordem: i };
  }).filter(x => x.nome);
}

window.salvarItem = async function() {
  const id = $('itemId').value;
  const dados = {
    categoria_id: Number($('itemCategoria').value),
    nome: $('itemNome').value,
    descricao: $('itemDescricao').value,
    disponivel: true,
    tamanhos: coletarSubItens('tamanhos'),
    adicionais: coletarSubItens('adicionais'),
  };
  if (!dados.nome.trim()) return toast('Nome é obrigatório', true);
  if (!dados.tamanhos.length) return toast('Cadastre ao menos um tamanho', true);
  try {
    if (id) await api('PUT', `/api/itens/${id}`, dados);
    else await api('POST', '/api/itens', dados);
    fecharModal(null, 'modalItem');
    toast(id ? 'Item atualizado' : 'Item criado');
  } catch (e) {
    toast(e.message, true);
  }
};

window.toggleDisponivel = async function(id) {
  await api('POST', `/api/itens/${id}/toggle-disponivel`);
};

window.apagarItem = async function(id) {
  const item = itens.find(i => i.id === id);
  if (!confirm(`Apagar "${item.nome}"?`)) return;
  await api('DELETE', `/api/itens/${id}`);
  toast('Item apagado');
};

// ============= Toast =============
function toast(msg, erro = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (erro ? ' erro' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ============= Propagandas =============
async function carregarPropagandas() {
  [propagandas, config] = await Promise.all([
    api('GET', '/api/propagandas'),
    api('GET', '/api/config'),
  ]);
  renderPropagandas();
}

function renderPropagandas() {
  const lista = $('listaPropagandas');
  if (!propagandas.length) {
    lista.innerHTML = `<div class="vazio">Nenhuma propaganda cadastrada.</div>`;
    return;
  }
  lista.replaceChildren(...propagandas.map(cardPropaganda));
}

function cardPropaganda(p) {
  const div = document.createElement('div');
  div.className = 'categoria-bloco';
  div.style.marginBottom = '10px';

  const corTipo = p.tipo === 'codegus' ? 'var(--cg-gradient)' : 'var(--verde)';
  const opacidade = p.ativa ? '1' : '0.5';

  div.innerHTML = `
    <div class="categoria-header" style="background: ${corTipo}; opacity: ${opacidade};">
      <h3>${escape(p.titulo)} <span class="qty" style="background: rgba(0,0,0,0.15);">${p.tipo}</span></h3>
      <div class="acoes">
        <button class="btn btn-cat" onclick="togglePropaganda(${p.id})">${p.ativa ? 'ativa' : 'pausada'}</button>
        <button class="btn btn-cat" onclick="editarPropaganda(${p.id})">editar</button>
        <button class="btn btn-cat" onclick="apagarPropaganda(${p.id})">apagar</button>
      </div>
    </div>
    <div style="padding: 14px 20px; ${p.ativa ? '' : 'opacity: 0.5;'}">
      ${p.subtitulo ? `<div style="font-size: 13px; color: var(--cinza-700); margin-bottom: 4px;">${escape(p.subtitulo)}</div>` : ''}
      ${p.corpo ? `<div style="font-size: 12px; color: var(--cinza-500); white-space: pre-wrap;">${escape(p.corpo)}</div>` : ''}
      ${p.imagem_url ? `<img src="${escape(p.imagem_url)}" style="max-height: 80px; margin-top: 8px; border-radius: 4px;">` : ''}
    </div>
  `;
  return div;
}

window.abrirModalPropaganda = function() {
  $('tituloPropaganda').textContent = 'Nova propaganda';
  $('propId').value = '';
  $('propTitulo').value = '';
  $('propSubtitulo').value = '';
  $('propCorpo').value = '';
  $('propImagemUrl').value = '';
  $('propTipo').value = 'codegus';
  abrirModal('modalPropaganda');
  setTimeout(() => $('propTitulo').focus(), 50);
};

window.editarPropaganda = function(id) {
  const p = propagandas.find(x => x.id === id);
  if (!p) return;
  $('tituloPropaganda').textContent = 'Editar propaganda';
  $('propId').value = p.id;
  $('propTitulo').value = p.titulo;
  $('propSubtitulo').value = p.subtitulo || '';
  $('propCorpo').value = p.corpo || '';
  $('propImagemUrl').value = p.imagem_url || '';
  $('propTipo').value = p.tipo;
  abrirModal('modalPropaganda');
};

window.salvarPropaganda = async function() {
  const id = $('propId').value;
  const dados = {
    titulo: $('propTitulo').value,
    subtitulo: $('propSubtitulo').value,
    corpo: $('propCorpo').value,
    imagem_url: $('propImagemUrl').value,
    tipo: $('propTipo').value,
    ativa: true,
  };
  if (!dados.titulo.trim()) return toast('Título é obrigatório', true);
  try {
    if (id) await api('PUT', `/api/propagandas/${id}`, dados);
    else await api('POST', '/api/propagandas', dados);
    fecharModal(null, 'modalPropaganda');
    toast(id ? 'Propaganda atualizada' : 'Propaganda criada');
  } catch (e) { toast(e.message, true); }
};

window.togglePropaganda = async function(id) {
  await api('POST', `/api/propagandas/${id}/toggle-ativa`);
};

window.apagarPropaganda = async function(id) {
  const p = propagandas.find(x => x.id === id);
  if (!confirm(`Apagar "${p.titulo}"?`)) return;
  await api('DELETE', `/api/propagandas/${id}`);
  toast('Propaganda apagada');
};

// ============= Config =============
window.abrirModalConfig = async function() {
  if (!config.intervalo_slides_seg) {
    config = await api('GET', '/api/config');
  }
  $('cfgIntervalo').value = config.intervalo_slides_seg;
  $('cfgDuracao').value = config.duracao_slide_seg;
  $('cfgPausa').value = config.pausar_com_senha_nova_seg;
  abrirModal('modalConfig');
};

window.salvarConfig = async function() {
  const dados = {
    intervalo_slides_seg: Number($('cfgIntervalo').value) || 300,
    duracao_slide_seg: Number($('cfgDuracao').value) || 10,
    pausar_com_senha_nova_seg: Number($('cfgPausa').value) || 15,
  };
  try {
    await api('PUT', '/api/config', dados);
    fecharModal(null, 'modalConfig');
    toast('Configuração salva');
  } catch (e) { toast(e.message, true); }
};

// ============= Sistema (versão + auto-update) =============
async function carregarSistema() {
  try {
    const info = await api('GET', '/api/versao');
    renderSistema(info);
  } catch (e) {
    $('verLocal').textContent = '?';
    toast('Erro ao carregar versão: ' + e.message, true);
  }
}

function renderSistema(info) {
  $('verLocal').textContent = info.versao_local || '?';
  $('verUltimaCheca').textContent = info.ultima_checagem
    ? new Date(info.ultima_checagem).toLocaleString('pt-BR')
    : 'nunca';

  const box = $('boxAtualizacao');
  const conteudo = $('conteudoAtualizacao');

  if (!info.disponivel) {
    box.style.display = 'none';
    return;
  }

  const d = info.disponivel;
  box.style.display = 'block';
  const mb = (d.tamanho_bytes / 1024 / 1024).toFixed(1);
  conteudo.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">
      <div style="flex: 1;">
        <div style="display: inline-block; background: var(--dourado); color: white; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 3px 10px; border-radius: 10px; font-weight: 700; margin-bottom: 8px;">
          Nova versão disponível
        </div>
        <div style="font-size: 22px; font-weight: 800; color: var(--primaria);">v${escape(d.versao)}</div>
        <div style="font-size: 12px; color: var(--cinza-500); margin-top: 4px;">
          ${mb} MB &nbsp;·&nbsp; publicada em ${new Date(d.publicada_em).toLocaleDateString('pt-BR')}
        </div>
        ${d.notas ? `<div style="margin-top: 12px; padding: 10px 14px; background: var(--cinza-100); border-radius: 6px; font-size: 12px; color: var(--cinza-700); white-space: pre-wrap; max-height: 150px; overflow-y: auto;">${escape(d.notas)}</div>` : ''}
      </div>
      <button class="btn btn-primario" onclick="aplicarAtualizacao()" id="btnAplicar" style="white-space: nowrap;">
        Atualizar agora
      </button>
    </div>
  `;
}

window.checarVersao = async function() {
  const btn = $('btnCheca');
  btn.disabled = true;
  btn.textContent = 'Verificando…';
  try {
    const r = await api('POST', '/api/versao/checar');
    if (r.erro) {
      toast('Falha ao verificar: ' + r.erro, true);
    } else if (r.atualizada) {
      toast('Você está na versão mais recente ✓');
    } else {
      toast(`Nova versão disponível: v${r.disponivel.versao}`);
    }
    await carregarSistema();
  } catch (e) {
    toast('Erro: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verificar atualizações';
  }
};

window.zerarSenhas = async function() {
  if (!confirm('Zerar TODAS as senhas ativas e voltar o contador para 01?\n\nO histórico do dia continua no Relatório, mas as senhas em preparação e prontas somem do painel.')) return;
  const btn = $('btnZerar');
  btn.disabled = true;
  btn.textContent = 'Zerando…';
  try {
    const r = await api('POST', '/api/senhas/zerar');
    toast(`${r.apagadas} senha(s) removida(s). Próxima começa em 01.`, 'sucesso');
  } catch (e) {
    toast('Erro: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Zerar senhas';
  }
};

window.aplicarAtualizacao = async function() {
  if (!confirm('Atualizar agora? O sistema ficará indisponível por alguns segundos.')) return;
  const btn = $('btnAplicar');
  btn.disabled = true;
  btn.textContent = 'Baixando…';
  try {
    await api('POST', '/api/versao/atualizar');
    toast('Atualização iniciada. Recarregue em 30s.', 'sucesso');
    // Espera 8s e recarrega — servidor deve ter reiniciado
    setTimeout(() => location.reload(), 8000);
  } catch (e) {
    toast('Erro: ' + e.message, true);
    btn.disabled = false;
    btn.textContent = 'Atualizar agora';
  }
};

// ============= Backup =============
window.exportarBackup = async function() {
  const btn = $('btnExportarBackup');
  btn.disabled = true;
  btn.textContent = 'Gerando…';
  try {
    // Nao usa api() porque retorna arquivo, nao JSON
    const r = await fetch('/api/backup/exportar');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="([^"]+)"/);
    const nome = m ? m[1] : `sisi-backup-${new Date().toISOString().slice(0,10)}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup baixado. Guarde num lugar seguro (Drive, pendrive).', 'sucesso');
  } catch (e) {
    toast('Erro ao exportar: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Exportar backup';
  }
};

window.importarBackup = async function(ev) {
  const arq = ev.target.files?.[0];
  ev.target.value = ''; // permite selecionar o mesmo arquivo de novo
  if (!arq) return;

  if (!confirm(`Importar "${arq.name}"?\n\nO sistema vai MESCLAR os dados: mantém o que já existe e adiciona/atualiza a partir do backup. Itens com mesmo nome na mesma categoria serão atualizados.`)) return;

  const btn = $('btnImportarBackup');
  btn.disabled = true;
  btn.textContent = 'Importando…';
  try {
    const texto = await arq.text();
    let payload;
    try { payload = JSON.parse(texto); }
    catch { throw new Error('Arquivo não é um JSON válido'); }

    const r = await api('POST', '/api/backup/importar', payload);
    const s = r.resumo;
    const linhas = [
      `Categorias: ${s.categorias.criadas} novas, ${s.categorias.atualizadas} atualizadas`,
      `Itens: ${s.itens.criados} novos, ${s.itens.atualizados} atualizados`,
      `Propagandas: ${s.propagandas.criadas} novas, ${s.propagandas.atualizadas} atualizadas`,
      `Configurações: ${s.config.chaves}`,
      `Senhas históricas: ${s.senhas.importadas} importadas, ${s.senhas.ignoradas} ignoradas`,
      `Pedidos históricos: ${s.pedidos.importados}`,
    ];
    alert('Backup importado com sucesso!\n\n' + linhas.join('\n'));
    await carregar();
    if ($('secaoPropagandas').style.display !== 'none') await carregarPropagandas();
  } catch (e) {
    toast('Erro ao importar: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar backup';
  }
};

// ============= Boot =============
conectar();
carregar();
