const $ = (id) => document.getElementById(id);
const statusEl = $('statusConexao');

// ============= Estado =============
let categorias = [];
let itens = [];
let senhas = [];
let categoriaAtiva = null;
let termoBusca = '';
let carrinho = []; // linhas: { uid, item, tamanho, item2?, tamanho2?, adicionais[], quantidade }
let ws;

// Estado do modal em edição
let modalCtx = null; // { item, item2?, tamanho?, tamanho2?, adicionais: Set<id>, quantidade, editandoUid?: string }

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
      renderSenhas();
    } else if (msg.tipo === 'senha-criada') {
      senhas.push(msg.senha);
      renderSenhas();
    } else if (msg.tipo === 'senha-pronta' || msg.tipo === 'senha-reaberta') {
      const i = senhas.findIndex(s => s.id === msg.senha.id);
      if (i >= 0) senhas[i] = msg.senha;
      renderSenhas();
    } else if (msg.tipo === 'senha-entregue') {
      senhas = senhas.filter(s => s.id !== msg.senha.id);
      renderSenhas();
    } else if (msg.tipo === 'senhas-zeradas') {
      senhas = [];
      renderSenhas();
    } else if (msg.tipo === 'categoria-alterada' || msg.tipo === 'item-alterado') {
      carregarCardapio();
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

async function carregarCardapio() {
  [categorias, itens] = await Promise.all([
    api('GET', '/api/categorias'),
    api('GET', '/api/itens'),
  ]);
  if (!categoriaAtiva && categorias.length) categoriaAtiva = categorias[0].id;
  renderCardapio();
}

// ============= Render cardápio =============
function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // remove acentos combinantes
}

function destacar(texto, termoNorm) {
  if (!termoNorm) return escape(texto);
  const orig = String(texto || '');
  const norm = normalizar(orig);
  const i = norm.indexOf(termoNorm);
  if (i < 0) return escape(orig);
  return escape(orig.slice(0, i)) + '<mark>' + escape(orig.slice(i, i + termoNorm.length)) + '</mark>' + escape(orig.slice(i + termoNorm.length));
}

function itensFiltrados() {
  const termo = normalizar(termoBusca).trim();
  if (!termo) {
    // Sem busca: só itens da categoria ativa
    return { termo: '', lista: itens.filter(i => i.categoria_id === categoriaAtiva) };
  }
  // Com busca: em TODAS as categorias, casando nome OU descrição
  const lista = itens.filter(i => {
    const nome = normalizar(i.nome);
    const desc = normalizar(i.descricao || '');
    return nome.includes(termo) || desc.includes(termo);
  });
  return { termo, lista };
}

function renderCardapio() {
  const tabs = $('tabsCategorias');
  const grid = $('gridItens');
  const badge = $('badgeBusca');

  if (!categorias.length) {
    tabs.innerHTML = '';
    badge.textContent = '';
    grid.innerHTML = `<div class="carrinho-vazio">
      Cardápio vazio. <a href="/admin">Cadastrar itens →</a>
    </div>`;
    return;
  }

  const { termo, lista } = itensFiltrados();

  // Tabs — só quando não tem busca
  if (termo) {
    tabs.style.display = 'none';
    badge.innerHTML = `<span class="badge-resultado">${lista.length} resultado${lista.length === 1 ? '' : 's'}</span>`;
  } else {
    tabs.style.display = '';
    badge.textContent = '';
    tabs.replaceChildren(...categorias.map(cat => {
      const b = document.createElement('button');
      b.className = 'tab-cat' + (cat.id === categoriaAtiva ? ' ativo' : '');
      if (cat.id === categoriaAtiva) b.classList.add('ativo');
      b.textContent = cat.nome;
      b.onclick = () => {
        categoriaAtiva = cat.id;
        renderCardapio();
      };
      return b;
    }));
  }

  if (!lista.length) {
    grid.innerHTML = termo
      ? `<div class="carrinho-vazio">Nenhum item encontrado para "${escape(termoBusca)}".</div>`
      : `<div class="carrinho-vazio">Nenhum item nesta categoria.</div>`;
    return;
  }

  const catNome = (id) => categorias.find(c => c.id === id)?.nome || '';

  grid.replaceChildren(...lista.map(item => {
    const btn = document.createElement('button');
    btn.className = 'item-card';
    btn.disabled = !item.disponivel;
    const menorPreco = Math.min(...item.tamanhos.map(t => t.preco_centavos));
    const temMultiplos = item.tamanhos.length > 1;
    btn.innerHTML = `
      ${termo ? `<div class="categoria-hint">${escape(catNome(item.categoria_id))}</div>` : ''}
      <div class="nome">${destacar(item.nome, termo)}</div>
      ${item.descricao ? `<div class="desc">${destacar(item.descricao, termo)}</div>` : ''}
      ${item.disponivel
        ? `<div class="faixa">${temMultiplos ? 'a partir de ' : ''}${formatarPreco(menorPreco)}</div>`
        : `<div class="esgotado-tag">Esgotado</div>`
      }
    `;
    btn.onclick = () => abrirModalItem(item);
    return btn;
  }));
}

// ============= Busca =============
const inputBusca = $('inputBusca');
const buscaWrap = $('buscaWrap');
let debounceTimer = null;
inputBusca.addEventListener('input', (e) => {
  termoBusca = e.target.value;
  buscaWrap.classList.toggle('tem-texto', termoBusca.length > 0);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderCardapio, 100);
});
inputBusca.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') limparBusca();
});
window.limparBusca = function() {
  termoBusca = '';
  inputBusca.value = '';
  buscaWrap.classList.remove('tem-texto');
  renderCardapio();
  inputBusca.focus();
};

// ============= Modal item =============
function abrirModalItem(item, editandoLinha = null) {
  modalCtx = {
    item,
    item2: editandoLinha?.item2 ?? null,
    tamanho: editandoLinha?.tamanho ?? null,
    tamanho2: editandoLinha?.tamanho2 ?? null,
    adicionais: new Set(editandoLinha?.adicionais.map(a => a.id) ?? []),
    quantidade: editandoLinha?.quantidade ?? 1,
    editandoUid: editandoLinha?.uid ?? null,
  };

  $('modalItemNome').textContent = item.nome;
  $('modalItemDesc').textContent = item.descricao || '';

  // Meia-meia toggle: só faz sentido se tem 2+ itens disponíveis na mesma categoria com mesmo tamanho
  const outrosItens = itens.filter(i =>
    i.id !== item.id && i.categoria_id === item.categoria_id && i.disponivel
  );
  const podeMeiaMeia = outrosItens.length > 0;
  const areaMM = $('areaMeiaMeia');
  if (podeMeiaMeia) {
    areaMM.innerHTML = `
      <label class="toggle-meia-meia">
        <input type="checkbox" id="chkMeiaMeia" ${modalCtx.item2 ? 'checked' : ''}>
        <div class="info-mm">Meia a meia
          <small>Junte 2 sabores da mesma categoria. Preço = o mais caro.</small>
        </div>
      </label>
    `;
    $('chkMeiaMeia').onchange = (e) => {
      if (!e.target.checked) {
        modalCtx.item2 = null;
        modalCtx.tamanho2 = null;
      }
      renderModalItem();
    };
  } else {
    areaMM.innerHTML = '';
  }

  $('qtyItem').textContent = modalCtx.quantidade;
  renderModalItem();
  $('modalItem').classList.add('aberto');
}

function renderModalItem() {
  const { item, item2, tamanho, adicionais } = modalCtx;
  const meiaMeia = !!$('chkMeiaMeia')?.checked;

  // Tamanhos
  const opTams = $('opcoesTamanho');
  opTams.replaceChildren(...item.tamanhos.map(t => {
    const b = document.createElement('button');
    b.className = 'opcao-tamanho' + (tamanho?.id === t.id ? ' selecionado' : '');
    b.innerHTML = `${escape(t.nome)}<span class="preco">${formatarPreco(t.preco_centavos)}</span>`;
    b.onclick = () => {
      modalCtx.tamanho = t;
      // Se mudou o tamanho e tem item2, resetar tamanho2
      if (modalCtx.item2 && modalCtx.tamanho2?.nome !== t.nome) {
        modalCtx.tamanho2 = modalCtx.item2.tamanhos.find(t2 => t2.nome === t.nome) ?? null;
      }
      renderModalItem();
    };
    return b;
  }));

  // Segundo sabor (só aparece se meia-meia marcado E tamanho selecionado)
  const campoSS = $('campoSegundoSabor');
  const opSS = $('opcoesSegundoSabor');
  if (meiaMeia && tamanho) {
    campoSS.style.display = '';
    const candidatos = itens.filter(i =>
      i.id !== item.id
      && i.categoria_id === item.categoria_id
      && i.disponivel
      && i.tamanhos.some(t2 => t2.nome === tamanho.nome)
    );
    if (!candidatos.length) {
      opSS.innerHTML = `<div style="font-size: 12px; color: var(--cinza-500);">Nenhum sabor disponível no tamanho ${escape(tamanho.nome)}.</div>`;
    } else {
      opSS.replaceChildren(...candidatos.map(i2 => {
        const t2 = i2.tamanhos.find(t => t.nome === tamanho.nome);
        const b = document.createElement('button');
        b.className = 'opcao-tamanho' + (item2?.id === i2.id ? ' selecionado' : '');
        b.innerHTML = `${escape(i2.nome)}<span class="preco">${formatarPreco(t2.preco_centavos)}</span>`;
        b.onclick = () => {
          modalCtx.item2 = i2;
          modalCtx.tamanho2 = t2;
          renderModalItem();
        };
        return b;
      }));
    }
  } else {
    campoSS.style.display = 'none';
    if (!meiaMeia) {
      modalCtx.item2 = null;
      modalCtx.tamanho2 = null;
    }
  }

  // Adicionais (do item base)
  const campoAdd = $('campoAdicionais');
  if (item.adicionais.length) {
    campoAdd.innerHTML = `
      <label>Adicionais</label>
      <div class="opcoes-adicionais" id="listaAdicionais"></div>
    `;
    const lista = $('listaAdicionais');
    lista.replaceChildren(...item.adicionais.map(a => {
      const label = document.createElement('label');
      label.className = 'opcao-adicional';
      const checked = adicionais.has(a.id) ? 'checked' : '';
      label.innerHTML = `
        <span>
          <input type="checkbox" ${checked}>
          <span class="nome-add">${escape(a.nome)}</span>
        </span>
        <span class="preco-add">${a.preco_centavos ? `+ ${formatarPreco(a.preco_centavos)}` : 'grátis'}</span>
      `;
      label.querySelector('input').onchange = (e) => {
        if (e.target.checked) modalCtx.adicionais.add(a.id);
        else modalCtx.adicionais.delete(a.id);
        renderPreviewTotal();
      };
      return label;
    }));
  } else {
    campoAdd.innerHTML = '';
  }

  renderPreviewTotal();

  // Habilita "Adicionar" só se tamanho selecionado (e, se meia-meia, item2+tamanho2)
  const btnOk = $('btnAdicionar');
  const okMeiaMeia = !meiaMeia || (modalCtx.item2 && modalCtx.tamanho2);
  btnOk.disabled = !(tamanho && okMeiaMeia);
  btnOk.textContent = modalCtx.editandoUid ? 'Atualizar' : 'Adicionar';
}

function renderPreviewTotal() {
  const { item, item2, tamanho, tamanho2, adicionais, quantidade } = modalCtx;
  if (!tamanho) {
    $('previewTotal').textContent = 'R$ —';
    return;
  }
  let base = tamanho.preco_centavos;
  if (item2 && tamanho2) base = Math.max(base, tamanho2.preco_centavos);
  const addCentavos = [...adicionais].reduce((acc, id) => {
    const a = item.adicionais.find(a => a.id === id);
    return acc + (a?.preco_centavos ?? 0);
  }, 0);
  const total = (base + addCentavos) * quantidade;
  $('previewTotal').textContent = formatarPreco(total);
}

window.mudarQty = function(delta) {
  modalCtx.quantidade = Math.max(1, modalCtx.quantidade + delta);
  $('qtyItem').textContent = modalCtx.quantidade;
  renderPreviewTotal();
};

window.fecharModalItem = function() {
  $('modalItem').classList.remove('aberto');
  modalCtx = null;
};

window.adicionarAoCarrinho = function() {
  if (!modalCtx?.tamanho) return;
  const linha = {
    uid: modalCtx.editandoUid ?? `${Date.now()}-${Math.random()}`,
    item: modalCtx.item,
    item2: modalCtx.item2,
    tamanho: modalCtx.tamanho,
    tamanho2: modalCtx.tamanho2,
    adicionais: [...modalCtx.adicionais].map(id => modalCtx.item.adicionais.find(a => a.id === id)),
    quantidade: modalCtx.quantidade,
  };
  if (modalCtx.editandoUid) {
    const i = carrinho.findIndex(l => l.uid === modalCtx.editandoUid);
    if (i >= 0) carrinho[i] = linha;
    toast('Item atualizado', 'info');
  } else {
    carrinho.push(linha);
    toast(`${modalCtx.item.nome} adicionado`, 'info');
  }
  renderCarrinho();
  fecharModalItem();
};

// ============= Carrinho =============
function renderCarrinho() {
  $('qtyCarrinho').textContent = carrinho.length;
  const lista = $('listaCarrinho');
  if (!carrinho.length) {
    lista.innerHTML = `<div class="carrinho-vazio">Nenhum item no pedido.<br>Escolha do cardápio ao lado.</div>`;
  } else {
    lista.replaceChildren(...carrinho.map(linhaCarrinhoView));
  }
  const total = carrinho.reduce((acc, l) => acc + precoLinha(l), 0);
  $('totalCarrinho').textContent = formatarPreco(total);
  $('btnConfirmar').disabled = carrinho.length === 0;
}

function precoLinha(l) {
  let base = l.tamanho.preco_centavos;
  if (l.item2 && l.tamanho2) base = Math.max(base, l.tamanho2.preco_centavos);
  const add = l.adicionais.reduce((acc, a) => acc + (a?.preco_centavos ?? 0), 0);
  return (base + add) * l.quantidade;
}

function linhaCarrinhoView(l) {
  const div = document.createElement('div');
  div.className = 'linha-carrinho';
  const nome = l.item2 ? `${l.item.nome} / ${l.item2.nome}` : l.item.nome;
  const adds = l.adicionais.length ? ' · +' + l.adicionais.map(a => a.nome).join(', +') : '';
  div.innerHTML = `
    <div class="topo">
      <div class="nome">${escape(nome)}</div>
      <span class="qty">${l.quantidade}×</span>
    </div>
    <div class="detalhes">${escape(l.tamanho.nome)}${escape(adds)}</div>
    <div class="rodape-linha">
      <span class="preco">${formatarPreco(precoLinha(l))}</span>
      <button class="btn-remover" title="Remover">×</button>
    </div>
  `;
  div.onclick = (e) => {
    if (e.target.classList.contains('btn-remover')) {
      carrinho = carrinho.filter(x => x.uid !== l.uid);
      renderCarrinho();
      return;
    }
    abrirModalItem(l.item, l);
  };
  return div;
}

$('btnLimpar').onclick = () => {
  if (!carrinho.length) return;
  if (!confirm('Limpar o pedido?')) return;
  carrinho = [];
  renderCarrinho();
};

$('btnConfirmar').onclick = async () => {
  if (!carrinho.length) return;
  const btn = $('btnConfirmar');
  btn.disabled = true;
  const observacao = $('observacaoInput').value.trim();
  const linhas = carrinho.map(l => ({
    item_id: l.item.id,
    item2_id: l.item2?.id ?? null,
    tamanho_id: l.tamanho.id,
    tamanho2_id: l.tamanho2?.id ?? null,
    quantidade: l.quantidade,
    adicionais_ids: l.adicionais.map(a => a.id),
  }));
  try {
    const { senha } = await api('POST', '/api/pedidos', { linhas, observacao });
    toast(`Senha ${String(senha.numero).padStart(2, '0')} criada!`, 'sucesso');
    carrinho = [];
    $('observacaoInput').value = '';
    renderCarrinho();
    // Dispara impressão: cliente + cozinha em janelas separadas
    imprimirPedido(senha.id);
  } catch (e) {
    toast(e.message, 'erro');
  } finally {
    btn.disabled = false;
  }
};

function imprimirPedido(senhaId) {
  // Uma janela só: imprime cliente automaticamente e depois oferece "Imprimir cozinha"
  // (evita bloqueio de popup múltiplo).
  const w = window.open(`/imprimir?senha=${senhaId}&via=cliente&duo=1`, `imp-${senhaId}`, 'width=440,height=700');
  if (!w) {
    toast('Popup bloqueado — permita popups pra imprimir', 'erro');
  }
}

// ============= Senhas ativas =============
function renderSenhas() {
  const preparando = senhas.filter(s => s.status === 'preparando');
  const prontas = senhas.filter(s => s.status === 'pronto');
  $('ctPreparando').textContent = `(${preparando.length})`;
  $('ctProntas').textContent = `(${prontas.length})`;
  $('cardsPreparando').replaceChildren(...preparando.map(cardSenha));
  $('cardsProntas').replaceChildren(...prontas.map(cardSenha));
}

function cardSenha(s) {
  const div = document.createElement('div');
  div.className = 'card-senha' + (s.status === 'pronto' ? ' pronto' : '');
  div.style.cursor = 'pointer';
  const numero = String(s.numero).padStart(2, '0');
  div.innerHTML = `<span class="num" title="ver detalhes">${numero}</span><span class="btns"></span>`;
  div.querySelector('.num').onclick = () => abrirDetalheSenha(s);
  const btns = div.querySelector('.btns');
  if (s.status === 'preparando') {
    const b = document.createElement('button');
    b.className = 'btn-mini verde';
    b.textContent = 'Pronto';
    b.onclick = () => acaoSenha(s.id, 'pronta');
    btns.appendChild(b);
  } else if (s.status === 'pronto') {
    const b1 = document.createElement('button');
    b1.className = 'btn-mini escuro';
    b1.textContent = 'Entregue';
    b1.onclick = () => acaoSenha(s.id, 'entregue');
    btns.appendChild(b1);
    const b2 = document.createElement('button');
    b2.className = 'btn-mini cinza';
    b2.textContent = '↺';
    b2.title = 'Voltar para preparação';
    b2.onclick = () => acaoSenha(s.id, 'reabrir');
    btns.appendChild(b2);
  }
  const bp = document.createElement('button');
  bp.className = 'btn-mini cinza';
  bp.textContent = '🖨';
  bp.title = 'Reimprimir cliente + cozinha';
  bp.onclick = (e) => {
    e.stopPropagation();
    imprimirPedido(s.id);
  };
  btns.appendChild(bp);
  return div;
}

async function acaoSenha(id, endpoint) {
  await api('POST', `/api/senhas/${id}/${endpoint}`);
}

let senhaModalAtual = null;

async function abrirDetalheSenha(senha) {
  senhaModalAtual = senha;
  const numero = String(senha.numero).padStart(2, '0');
  $('tituloSenha').textContent = `Senha ${numero}`;
  const corpo = $('corpoSenha');
  corpo.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--cinza-500);">Carregando…</div>`;
  $('modalSenha').classList.add('aberto');
  try {
    const pedido = await api('GET', `/api/senhas/${senha.id}/pedido`);
    renderDetalheSenha(senha, pedido);
  } catch (e) {
    corpo.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--cinza-500);">Senha sem pedido registrado.</div>`;
  }
}

window.reimprimirVia = function(via) {
  if (!senhaModalAtual) return;
  window.open(`/imprimir?senha=${senhaModalAtual.id}&via=${via}`, `imp-${senhaModalAtual.id}-${via}`, 'width=420,height=640');
};

function renderDetalheSenha(senha, pedido) {
  const corpo = $('corpoSenha');
  const statusCor = senha.status === 'pronto' ? 'var(--verde)' : 'var(--dourado)';
  const criada = (senha.criada_em || '').slice(11, 16);
  const linhas = pedido.itens.map(i => {
    const adds = i.adicionais.length
      ? `<div style="font-size: 12px; color: var(--cinza-500); margin-top: 2px;">+ ${i.adicionais.map(a => escape(a.nome_snapshot)).join(', +')}</div>`
      : '';
    const badgeMM = i.meia_meia ? ` <span style="background: var(--dourado); color: white; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px;">1/2 + 1/2</span>` : '';
    return `
      <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--cinza-200);">
        <div style="flex: 1;">
          <div style="font-weight: 600; color: var(--primaria); font-size: 14px;">
            <span style="background: var(--primaria); color: white; padding: 1px 6px; border-radius: 3px; font-size: 11px; margin-right: 6px;">${i.quantidade}×</span>
            ${escape(i.nome_snapshot)}${badgeMM}
          </div>
          <div style="font-size: 12px; color: var(--cinza-500); margin-top: 2px;">${escape(i.tamanho_nome)}</div>
          ${adds}
        </div>
        <div style="font-weight: 700; color: var(--verde); font-size: 14px; white-space: nowrap;">${formatarPreco(i.preco_total_centavos)}</div>
      </div>
    `;
  }).join('');

  corpo.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--cinza-200);">
      <div>
        <div style="font-size: 11px; text-transform: uppercase; color: var(--cinza-500); letter-spacing: 1px;">Status</div>
        <div style="color: ${statusCor}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; font-size: 13px;">${senha.status === 'pronto' ? 'Pronto' : 'Em preparação'}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--cinza-500); letter-spacing: 1px;">Criada às</div>
        <div style="color: var(--primaria); font-weight: 700;">${criada}</div>
      </div>
    </div>
    ${linhas}
    <div style="display: flex; justify-content: space-between; padding-top: 12px; margin-top: 8px; font-weight: 800; font-size: 16px; color: var(--primaria);">
      <div>Total</div>
      <div style="color: var(--verde); font-size: 20px;">${formatarPreco(pedido.total_centavos)}</div>
    </div>
  `;
}

// ============= Utils =============
function formatarPreco(centavos) {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
}
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, tipo = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ============= Boot =============
conectar();
carregarCardapio();
