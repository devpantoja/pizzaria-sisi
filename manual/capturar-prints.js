// Captura screenshots das telas do sistema pro manual.
// PRÉ-REQUISITO: servidor rodando em http://localhost:3000 com banco demo populado.
// Uso: node manual/capturar-prints.js

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = './manual/imgs';
mkdirSync(OUT, { recursive: true });

const VIEWPORT_DESKTOP = { width: 1440, height: 900 };
const VIEWPORT_TV = { width: 1920, height: 1080 };
const VIEWPORT_TERMICA = { width: 420, height: 900 };

async function capturar(nomeArquivo, url, opts = {}) {
  const {
    viewport = VIEWPORT_DESKTOP,
    fullPage = false,
    espera = 500,
    antes = null,
  } = opts;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(espera);
  if (antes) await antes(page);
  const caminho = `${OUT}/${nomeArquivo}.png`;
  await page.screenshot({ path: caminho, fullPage });
  await browser.close();
  console.log(`✓ ${caminho}`);
}

console.log('Capturando screenshots…\n');

// ============= ATENDENTE =============
await capturar('01-atendente-inicial', '/atendente', {
  antes: async (page) => {
    // Garante que o cardápio já carregou
    await page.waitForSelector('.item-card');
  },
});

// Modal de item aberto (montagem de pedido)
await capturar('02-atendente-modal-item', '/atendente', {
  espera: 700,
  antes: async (page) => {
    await page.waitForSelector('.item-card');
    // Clica na Margherita
    await page.locator('.item-card', { hasText: 'Margherita' }).first().click();
    await page.waitForSelector('#modalItem.aberto');
    // Seleciona tamanho Grande
    await page.locator('.opcao-tamanho', { hasText: 'Grande' }).click();
    await page.waitForTimeout(200);
  },
});

// Meia-meia
await capturar('03-atendente-meia-meia', '/atendente', {
  espera: 700,
  antes: async (page) => {
    await page.waitForSelector('.item-card');
    await page.locator('.item-card', { hasText: 'Margherita' }).first().click();
    await page.waitForSelector('#modalItem.aberto');
    await page.locator('.opcao-tamanho', { hasText: 'Grande' }).click();
    await page.waitForTimeout(150);
    await page.locator('#chkMeiaMeia').check();
    await page.waitForTimeout(200);
    await page.locator('#opcoesSegundoSabor .opcao-tamanho', { hasText: 'Calabresa' }).click();
    await page.waitForTimeout(200);
    // marca um adicional
    const chk = page.locator('#listaAdicionais input[type=checkbox]').first();
    if (await chk.count() > 0) await chk.check();
    await page.waitForTimeout(200);
  },
});

// Busca ativa
await capturar('04-atendente-busca', '/atendente', {
  espera: 700,
  antes: async (page) => {
    await page.waitForSelector('.item-card');
    await page.locator('#inputBusca').fill('choco');
    await page.waitForTimeout(300);
  },
});

// ============= PAINEL DA TV =============
await capturar('05-painel-tv', '/painel', {
  viewport: VIEWPORT_TV,
  espera: 1200,
  antes: async (page) => {
    // Esconde o indicador de "próxima propaganda" pra print limpo
    await page.evaluate(() => {
      const el = document.getElementById('proximoSlide');
      if (el) el.style.display = 'none';
    });
  },
});

// Painel mostrando o slide de propaganda CodeGus
await capturar('06-painel-slide-codegus', '/painel', {
  viewport: VIEWPORT_TV,
  espera: 800,
  antes: async (page) => {
    // Força mostrar o slide da primeira propaganda (CodeGus)
    await page.evaluate(() => {
      // A função mostrarProximoSlide está no escopo do módulo — chamamos manualmente
      // via reset do timer e chamada direta
      if (typeof mostrarProximoSlide === 'function') mostrarProximoSlide();
    });
    // Fallback: se não conseguiu chamar, aguarda até o próximo ciclo
    // Como o intervalo padrão pode ser grande, injetamos manualmente
    await page.waitForTimeout(500);
    const visivel = await page.locator('#telaSlide.visivel').count();
    if (!visivel) {
      // força via DOM direto
      await page.evaluate(() => {
        const tela = document.getElementById('telaSlide');
        tela.className = 'visivel codegus';
        document.getElementById('slideSelo').textContent = 'CG';
        document.getElementById('slideTitulo').textContent = 'CodeGus';
        document.getElementById('slideSubtitulo').textContent = 'Sistemas sob medida para o seu negócio';
        document.getElementById('slideSubtitulo').style.display = '';
        document.getElementById('slideCorpo').textContent = 'codegus.com  ·  (47) 98496-5787';
        document.getElementById('slideCorpo').style.display = '';
      });
      await page.waitForTimeout(400);
    }
    // Esconde indicador
    await page.evaluate(() => {
      const el = document.getElementById('proximoSlide');
      if (el) el.style.display = 'none';
    });
  },
});

// ============= ADMIN CARDÁPIO =============
await capturar('07-admin-cardapio', '/admin', {
  antes: async (page) => {
    await page.waitForSelector('.categoria-bloco');
  },
});

// Modal de novo item aberto
await capturar('08-admin-modal-item', '/admin', {
  espera: 600,
  antes: async (page) => {
    await page.waitForSelector('.categoria-bloco');
    // Encontra o botão "editar" do primeiro item da primeira categoria
    await page.locator('.item-linha .btn-cinza', { hasText: 'editar' }).first().click();
    await page.waitForSelector('#modalItem.aberto');
  },
});

// ============= ADMIN PROPAGANDAS =============
await capturar('09-admin-propagandas', '/admin', {
  espera: 600,
  antes: async (page) => {
    await page.locator('.aba-btn', { hasText: 'Propagandas' }).click();
    await page.waitForTimeout(500);
  },
});

// Modal config
await capturar('10-admin-config', '/admin', {
  espera: 600,
  antes: async (page) => {
    await page.locator('.aba-btn', { hasText: 'Propagandas' }).click();
    await page.waitForTimeout(400);
    await page.locator('button', { hasText: 'Configurações' }).click();
    await page.waitForSelector('#modalConfig.aberto');
    await page.waitForTimeout(200);
  },
});

// ============= RELATÓRIO =============
await capturar('11-relatorio', '/relatorio', {
  espera: 600,
  fullPage: true,
  antes: async (page) => {
    await page.waitForSelector('.cartao');
  },
});

// ============= IMPRESSÃO =============
// Descobre o ID da senha 2 (a que tem meia-meia + observação) via API
const res = await fetch(`${BASE}/api/senhas`);
const senhas = await res.json();
const senhaPronta = senhas.find(s => s.status === 'pronto') || senhas[0];
const senhaId = senhaPronta?.id ?? 2;

await capturar('12-imprimir-cliente', `/imprimir?senha=${senhaId}&via=cliente&autoprint=0`, {
  viewport: VIEWPORT_TERMICA,
  espera: 500,
  fullPage: true,
});

await capturar('13-imprimir-cozinha', `/imprimir?senha=${senhaId}&via=cozinha&autoprint=0`, {
  viewport: VIEWPORT_TERMICA,
  espera: 500,
  fullPage: true,
});

console.log('\n✅ Todas as capturas concluídas em', OUT);
process.exit(0);
