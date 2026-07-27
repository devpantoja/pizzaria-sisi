const $ = (id) => document.getElementById(id);
const dataInput = $('dataInput');

let dadosAtuais = null;

function hoje() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

dataInput.value = hoje();
dataInput.onchange = () => carregar();

async function carregar() {
  const d = dataInput.value || hoje();
  const r = await fetch(`/api/relatorio?data=${d}`);
  const dados = await r.json();
  dadosAtuais = dados;
  render(dados);
}

function formatarPreco(centavos) {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
}
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render({ totais, itens_mais_vendidos, pedidos }) {
  // Cartões
  const ticketMedio = totais.pedidos_total > 0
    ? totais.faturamento_centavos / totais.pedidos_total
    : 0;

  $('cartoes').innerHTML = `
    <div class="cartao">
      <div class="rotulo">Faturamento</div>
      <div class="valor verde">${formatarPreco(totais.faturamento_centavos)}</div>
      <div class="sublinha">com base em pedidos registrados</div>
    </div>
    <div class="cartao">
      <div class="rotulo">Pedidos</div>
      <div class="valor">${totais.pedidos_total}</div>
      <div class="sublinha">ticket médio ${formatarPreco(Math.round(ticketMedio))}</div>
    </div>
    <div class="cartao">
      <div class="rotulo">Senhas geradas</div>
      <div class="valor">${totais.senhas_total}</div>
      <div class="sublinha">${totais.senhas_entregues} entregues</div>
    </div>
  `;

  // Top itens
  const topEl = $('topItens');
  if (!itens_mais_vendidos.length) {
    topEl.innerHTML = `<div class="vazio">Nenhum item vendido nesse dia.</div>`;
  } else {
    topEl.innerHTML = `
      <table>
        <thead>
          <tr><th>Item</th><th>Tamanho</th><th style="text-align: right;">Qty</th><th style="text-align: right;">Total</th></tr>
        </thead>
        <tbody>
          ${itens_mais_vendidos.map(i => `
            <tr>
              <td>${escape(i.nome_snapshot)}</td>
              <td>${escape(i.tamanho_nome)}</td>
              <td class="n">${i.qty}</td>
              <td class="n">${formatarPreco(i.total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Lista de pedidos
  const pedEl = $('listaPedidos');
  if (!pedidos.length) {
    pedEl.innerHTML = `<div class="vazio">Nenhuma senha nesse dia.</div>`;
  } else {
    pedEl.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Senha</th>
            <th>Status</th>
            <th>Itens</th>
            <th>Criada</th>
            <th>Pronta</th>
            <th>Entregue</th>
            <th style="text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${pedidos.map(p => `
            <tr>
              <td class="senha-num">${String(p.numero).padStart(2, '0')}</td>
              <td><span class="status-tag ${p.status}">${p.status}</span></td>
              <td style="font-size: 12px; color: var(--cinza-700);">
                ${p.itens.length ? p.itens.map(i => `${i.quantidade}× ${escape(i.nome_snapshot)}${i.meia_meia ? ' (½+½)' : ''}`).join(' · ') : '<em style="color: var(--cinza-500);">sem pedido</em>'}
              </td>
              <td style="font-family: monospace; font-size: 12px;">${(p.criada_em || '').slice(11, 16)}</td>
              <td style="font-family: monospace; font-size: 12px;">${(p.pronta_em || '').slice(11, 16) || '—'}</td>
              <td style="font-family: monospace; font-size: 12px;">${(p.entregue_em || '').slice(11, 16) || '—'}</td>
              <td class="n">${p.total_centavos ? formatarPreco(p.total_centavos) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
}

window.exportarCSV = function() {
  if (!dadosAtuais) return;
  const linhas = [
    ['senha', 'status', 'criada_em', 'pronta_em', 'entregue_em', 'total_reais', 'itens'],
  ];
  for (const p of dadosAtuais.pedidos) {
    linhas.push([
      String(p.numero).padStart(2, '0'),
      p.status,
      p.criada_em || '',
      p.pronta_em || '',
      p.entregue_em || '',
      p.total_centavos ? (p.total_centavos / 100).toFixed(2).replace('.', ',') : '',
      p.itens.map(i => `${i.quantidade}x ${i.nome_snapshot} (${i.tamanho_nome})`).join(' | '),
    ]);
  }
  const csv = linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pizzaria-${dadosAtuais.dia}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

carregar();
