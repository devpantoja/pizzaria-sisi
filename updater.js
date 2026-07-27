// updater.js — auto-update via GitHub Releases.
//
// Fluxo:
//  1. Ao iniciar o servidor, checa `latest_release` da CodeGus no GitHub.
//  2. Se a versão remota > local, baixa o novo binário pra pasta temporária.
//  3. Expõe endpoint POST /api/atualizar que aplica o update:
//       - encerra servidor
//       - substitui o binário
//       - reinicia
//  4. Se auto-check falhar (offline), ignora silencioso.
//
// Config via env: UPDATE_REPO=devpantoja/pizzaria-sisi (owner/repo do GitHub)

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = process.env.UPDATE_REPO || 'devpantoja/pizzaria-sisi';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;  // a cada 6h
let ultimaChecagem = null;
let versaoDisponivel = null;   // { versao, url, publicada_em, notas }

function versaoLocal() {
  try {
    // Empacotado (pkg): version.json fica ao lado do executável
    const base = dirname(process.execPath);
    const p1 = join(base, 'version.json');
    if (existsSync(p1)) return JSON.parse(readFileSync(p1, 'utf8')).version;
    // Rodando via node em dev
    const p2 = './package.json';
    if (existsSync(p2)) return JSON.parse(readFileSync(p2, 'utf8')).version;
  } catch {}
  return '0.0.0';
}

function comparaVersoes(a, b) {
  // Retorna 1 se a > b, -1 se a < b, 0 se iguais
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function assetPorPlataforma(assets) {
  // Nome esperado: pizzaria-senhas-win.exe, pizzaria-senhas-linux, pizzaria-senhas-macos
  const map = { win32: 'win', linux: 'linux', darwin: 'macos' };
  const suffix = map[process.platform];
  if (!suffix) return null;
  return assets.find(a => a.name.toLowerCase().includes(suffix));
}

export async function checarAtualizacao() {
  ultimaChecagem = new Date().toISOString();
  try {
    // Busca TODAS as releases e filtra oficiais (não pre-release, não draft)
    // Assim ignoramos `dev-latest` gerada pelo push em main.
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: { 'Accept': 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error(`GitHub retornou ${r.status}`);
    const todas = await r.json();
    const oficiais = todas.filter(x => !x.prerelease && !x.draft);
    if (!oficiais.length) throw new Error('nenhuma release oficial encontrada');
    // As releases já vêm ordenadas por data desc; pega a mais recente
    const rel = oficiais[0];

    const versaoRemota = String(rel.tag_name || '').replace(/^v/, '');
    if (!versaoRemota) throw new Error('sem tag_name');

    const cmp = comparaVersoes(versaoRemota, versaoLocal());
    if (cmp <= 0) {
      versaoDisponivel = null;
      return { atualizada: true, versao_local: versaoLocal(), versao_remota: versaoRemota };
    }

    const asset = assetPorPlataforma(rel.assets || []);
    if (!asset) throw new Error(`sem asset pra plataforma ${process.platform}`);

    versaoDisponivel = {
      versao: versaoRemota,
      url: asset.browser_download_url,
      nome_arquivo: asset.name,
      tamanho_bytes: asset.size,
      publicada_em: rel.published_at,
      notas: rel.body || '',
    };
    return { atualizada: false, disponivel: versaoDisponivel, versao_local: versaoLocal() };
  } catch (e) {
    return { erro: e.message, ultima_checagem: ultimaChecagem };
  }
}

export function statusUpdate() {
  return {
    versao_local: versaoLocal(),
    ultima_checagem: ultimaChecagem,
    disponivel: versaoDisponivel,
  };
}

export async function baixarESubstituir() {
  if (!versaoDisponivel) throw new Error('nenhuma versão disponível');
  const { url, nome_arquivo, versao } = versaoDisponivel;

  // 1. Baixa pra arquivo temporário
  const destTmp = join(tmpdir(), `codegus-update-${versao}-${nome_arquivo}`);
  console.log(`[updater] baixando ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`falha ao baixar (${r.status})`);
  const buffer = Buffer.from(await r.arrayBuffer());
  writeFileSync(destTmp, buffer);
  console.log(`[updater] baixado em ${destTmp} (${buffer.length} bytes)`);

  // 2. Determina caminho do executável atual
  const exeAtual = process.execPath;
  const exeBackup = exeAtual + '.old';

  // 3. Script que substitui + reinicia (Windows precisa esperar processo morrer)
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    const bat = `@echo off
timeout /t 2 /nobreak > NUL
move /Y "${exeAtual}" "${exeBackup}" > NUL
move /Y "${destTmp}" "${exeAtual}" > NUL
start "" "${exeAtual}"
del "${exeBackup}" > NUL 2>&1
del "%~f0"
`;
    const batPath = join(tmpdir(), 'codegus-apply-update.bat');
    writeFileSync(batPath, bat);
    execFileSync('cmd', ['/c', 'start', '', batPath], { detached: true, stdio: 'ignore' });
    console.log('[updater] script de substituição disparado; encerrando servidor');
    setTimeout(() => process.exit(0), 500);
    return { agendado: true };
  } else {
    // Unix (Linux/Mac): pode substituir direto
    if (existsSync(exeAtual)) renameSync(exeAtual, exeBackup);
    renameSync(destTmp, exeAtual);
    execFileSync('chmod', ['+x', exeAtual]);
    if (existsSync(exeBackup)) try { unlinkSync(exeBackup); } catch {}
    console.log('[updater] substituído; reiniciando');
    setTimeout(() => process.exit(0), 500);
    return { agendado: true };
  }
}

// Boot: checa 5s após iniciar + periodicamente
export function iniciarAutoCheck() {
  setTimeout(() => checarAtualizacao(), 5000);
  setInterval(() => checarAtualizacao(), CHECK_INTERVAL_MS);
}
