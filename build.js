// build.js — empacotamento portable com Node.js embutido.
//
// Estratégia:
//   1. esbuild: bundla tudo em ONE arquivo dist/server.cjs (código minificado)
//   2. Baixa Node.js portable (Windows) e coloca em dist/runtime/
//   3. Copia assets estáticos, manual, ícone
//   4. Gera launcher.bat/launcher.vbs (roda escondido) que chama node.exe server.cjs
//   5. O instalador Inno Setup empacota tudo isso num único .exe
//
// Vantagens vs pkg:
//   • Sem compilar Node.js do zero (era 30+ min)
//   • better-sqlite3 usa native module compatível (baixado pelo npm no dist)
//   • Código minificado + variáveis ofuscadas → cliente não consegue editar
//   • Funciona multiplataforma (você só baixa runtime do SO alvo)
//
// Uso:  node build.js         (baixa Node Windows por padrão)
//       node build.js linux   (Node Linux)
//       node build.js sem-runtime  (só bundla o código, sem baixar runtime)

import { build as esbuild } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import zlib from 'node:zlib';

const arg = process.argv[2] || 'win';
const DIST = './dist';
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const NODE_VERSION = 'v22.21.1';   // Alinhada com Node local pra compat native modules

// ============= Limpeza =============
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// ============= 1. Bundle minificado =============
console.log('▸ Bundling com esbuild (minificado)…');
await esbuild({
  entryPoints: ['./server.js'],
  outfile: `${DIST}/server.cjs`,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['better-sqlite3'],
  minify: true,               // minifica agressivo
  keepNames: false,           // pode renomear tudo
  legalComments: 'none',
  banner: {
    js: `/* ${pkg.name} v${pkg.version} — CodeGus © ${new Date().getFullYear()} — Todos os direitos reservados. */`
      + `\n/* Este arquivo é gerado e minificado automaticamente. Não modifique. */`
      // Faz o CJS entender __dirname / __filename e o import.meta virar undefined
      + `\nvar require_meta_url = "file://" + __filename;`,
  },
  define: {
    'import.meta.url': 'require_meta_url',
  },
});
const bytes = readFileSync(`${DIST}/server.cjs`).length;
console.log(`  ✓ dist/server.cjs (${(bytes / 1024).toFixed(0)} KB minificado)`);

// ============= 2. Copiar assets =============
console.log('▸ Copiando assets estáticos…');
cpSync('./public', `${DIST}/public`, { recursive: true });
if (existsSync('./manual')) {
  mkdirSync(`${DIST}/manual`, { recursive: true });
  cpSync('./manual/manual.html', `${DIST}/manual/manual.html`);
  if (existsSync('./manual/imgs')) cpSync('./manual/imgs', `${DIST}/manual/imgs`, { recursive: true });
}
console.log('  ✓ dist/public/ + dist/manual/');

// ============= 3. version.json =============
writeFileSync(`${DIST}/version.json`, JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  built_at: new Date().toISOString(),
}, null, 2));
console.log(`  ✓ dist/version.json (v${pkg.version})`);

// ============= 4. Instalar better-sqlite3 no dist (native module) =============
// O launcher chama node.exe do dist/runtime/ apontando pra server.cjs.
// O server.cjs faz `require('better-sqlite3')`, que espera achar em node_modules.
writeFileSync(`${DIST}/package.json`, JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  main: 'server.cjs',
  dependencies: { 'better-sqlite3': pkg.dependencies['better-sqlite3'] },
}, null, 2));

console.log('▸ Instalando better-sqlite3 no dist/ (native module)…');
execSync('npm install --no-package-lock --loglevel=error --omit=dev', {
  cwd: DIST, stdio: 'inherit',
});
console.log('  ✓ dist/node_modules/better-sqlite3/');

// ============= 5. Launchers =============
console.log('▸ Gerando launchers…');

// Windows: launcher.bat auto-oculto.
//   Se foi chamado com janela visivel (primeira execucao), se relanca via
//   powershell -WindowStyle Hidden e sai — sem depender de .vbs (associacao
//   de arquivo .vbs em algumas maquinas do cliente aponta pro navegador e
//   quebra o atalho). Powershell existe em toda instalacao Windows moderna.
// Mata instancias velhas do runtime antes de subir nova (evita porta 3000 travada
// por node.exe fantasma quando o usuario fecha sem sair pelo tray). WMIC filtra
// pelo caminho do executavel pra nao matar outros node.exe do sistema.
const launcherBat = `@echo off
if not "%~1"=="hidden" (
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '%~f0' -ArgumentList 'hidden'"
  exit /b
)
cd /d "%~dp0"
if not exist "data" mkdir data
for /f "tokens=2 delims=," %%p in ('tasklist /fi "imagename eq node.exe" /fo csv /nh 2^^>NUL ^^| findstr /i /c:"node.exe"') do (
  wmic process where "ProcessId=%%~p and ExecutablePath like '%%%~dp0runtime%%'" call terminate >NUL 2>&1
)
timeout /t 1 /nobreak >NUL
"%~dp0runtime\\node.exe" "%~dp0server.cjs" >> "%~dp0data\\launcher.log" 2>&1
`;
writeFileSync(`${DIST}/launcher.bat`, launcherBat);

// VBS wrapper mantido como fallback (caso o cliente prefira o atalho antigo).
// Nao e mais o alvo dos atalhos criados pelo instalador — ver setup.iss.
const launcherVbs = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & WScript.ScriptFullName & "\\..\\launcher.bat" & Chr(34) & " hidden", 0
Set WshShell = Nothing
`;
writeFileSync(`${DIST}/launcher.vbs`, launcherVbs);

// Unix: launcher.sh
const launcherSh = `#!/usr/bin/env bash
cd "$(dirname "$0")"
mkdir -p data
./runtime/node server.cjs
`;
writeFileSync(`${DIST}/launcher.sh`, launcherSh);
chmodSync(`${DIST}/launcher.sh`, 0o755);

console.log('  ✓ launcher.bat / launcher.vbs / launcher.sh');

// ============= 6. Baixar Node.js portable =============
if (arg === 'sem-runtime') {
  console.log('▸ Pulando download de runtime (--sem-runtime)');
  console.log('\n✅ Build concluído (sem runtime). Copie um Node portable pra dist/runtime/');
  process.exit(0);
}

const runtimes = {
  win:   { url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`, extractCmd: 'unzip', platform: 'win' },
  linux: { url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz`, extractCmd: 'tar', platform: 'linux' },
  mac:   { url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-arm64.tar.gz`, extractCmd: 'tar', platform: 'mac' },
};
const runtime = runtimes[arg] || runtimes.win;

console.log(`▸ Baixando Node.js portable pra ${runtime.platform}…`);
console.log(`  ${runtime.url}`);

const runtimeDir = `${DIST}/runtime`;
const tmpDir = `${DIST}/.tmp-node`;
mkdirSync(tmpDir, { recursive: true });
const arquivo = runtime.url.split('/').pop();
const localArchive = `${tmpDir}/${arquivo}`;

// Usa curl (mais rápido que fetch pra binários grandes)
execSync(`curl -sSL -o "${localArchive}" "${runtime.url}"`, { stdio: 'inherit' });
console.log('  ✓ Baixado');

console.log('▸ Extraindo…');
if (runtime.extractCmd === 'unzip') {
  execSync(`unzip -q "${localArchive}" -d "${tmpDir}"`, { stdio: 'inherit' });
} else {
  execSync(`tar -xzf "${localArchive}" -C "${tmpDir}"`, { stdio: 'inherit' });
}

// Encontra a pasta extraída (ex: node-v20.18.1-win-x64)
const nomeExtraido = arquivo.replace(/\.(zip|tar\.gz)$/, '');
const pastaExtraida = `${tmpDir}/${nomeExtraido}`;

mkdirSync(runtimeDir, { recursive: true });
if (runtime.platform === 'win') {
  // Windows: só precisa do node.exe (não do npm, npx…)
  cpSync(`${pastaExtraida}/node.exe`, `${runtimeDir}/node.exe`);
} else {
  // Unix: bin/node
  cpSync(`${pastaExtraida}/bin/node`, `${runtimeDir}/node`);
  chmodSync(`${runtimeDir}/node`, 0o755);
}
rmSync(tmpDir, { recursive: true, force: true });
console.log(`  ✓ dist/runtime/${runtime.platform === 'win' ? 'node.exe' : 'node'}`);

// Tamanho total do dist
console.log('\n✅ Build concluído.');
try {
  const tamanho = execSync(`du -sh ${DIST}`).toString().trim();
  console.log(`   Tamanho total: ${tamanho.split('\t')[0]}`);
} catch {}
console.log(`\nPróximos passos:`);
console.log(`   • Testar: cd dist && ./launcher.sh (Unix) OU launcher.vbs (Windows)`);
console.log(`   • Empacotar em .exe: rodar Inno Setup em installer/setup.iss (no Windows)`);
