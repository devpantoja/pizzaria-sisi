# Guia de Release — Sisi Pizzeria

Passo a passo pra gerar uma nova versão e publicar no GitHub Releases (que alimenta o auto-update).

---

## 1. Atualize a versão no `package.json`

```json
{
  "version": "0.2.0"
}
```

Regra: aumente `patch` (0.1.0 → 0.1.1) pra correções, `minor` (0.1.0 → 0.2.0) pra features novas, `major` pra mudanças que quebram compatibilidade.

## 2. Rode o build

**No Mac** (gera pasta com Node macOS):

```bash
node build.js mac
```

**No Windows** (gera pasta com Node Windows):

```bash
node build.js win
```

**No Linux**:

```bash
node build.js linux
```

Cada build gera `dist/` com ~130 MB (Node.js portable + código minificado + assets).

## 3. Gere o instalador Windows (.exe)

**PRÉ-REQUISITO**: instale [Inno Setup](https://jrsoftware.org/isinfo.php) num PC Windows.

1. Copie a pasta do projeto pro PC Windows (ou clone o repo lá)
2. Rode `node build.js win` no PC Windows
3. Abra `installer/setup.iss` no Inno Setup Compiler
4. Menu **Build > Compile** (F9)
5. Sai `dist/installer/SisiPizzeria-Setup-v0.2.0.exe`

## 4. Publique no GitHub Releases

```bash
# Cria tag da versão
git tag v0.2.0
git push origin v0.2.0

# Cria a release com o binário
gh release create v0.2.0 \
  --title "v0.2.0 — <descrição curta>" \
  --notes "## Novidades

- Feature X
- Corrige bug Y

## Como atualizar
Vá em Admin > Sistema > Verificar atualizações." \
  ./dist/installer/SisiPizzeria-Setup-v0.2.0.exe#SisiPizzeria-Setup-win.exe
```

O sufixo `#SisiPizzeria-Setup-win.exe` renomeia o asset no GitHub — importante porque o `updater.js` procura por asset que contenha `win`/`linux`/`macos` no nome.

## 5. Auto-update em ação

Assim que a release for pública:

- **Todo cliente instalado** vai detectar em até 6h (ou imediatamente se ele clicar "Verificar atualizações" no /admin > Sistema)
- Cliente clica **"Atualizar agora"** → baixa o novo `.exe`, substitui, reinicia
- **Sem intervenção da CodeGus**

## Config do repo

O `updater.js` lê a variável de ambiente `UPDATE_REPO` (default: `devpantoja/pizzaria-sisi`).

Se quiser mudar o repositório de releases, edite no topo de `updater.js` ou passe no launcher.

## Testando o auto-update localmente

1. Suba uma versão fake no GitHub (ex: v99.0.0)
2. Rode o sistema local com versão baixa (0.0.1 no package.json)
3. Acesse `/admin > Sistema > Verificar atualizações`
4. Confirme que aparece "Nova versão disponível"
5. Clique "Atualizar agora" — o binário local vai ser substituído

**Não faça isso em produção do cliente!** Sempre teste com uma release de rascunho primeiro.

## Rollback

Se um release der problema:

```bash
# Deleta a release problema (ou marca como pre-release)
gh release delete v0.2.0 --yes

# Ou re-publica com nome sinalizando
gh release edit v0.2.0 --prerelease
```

Instalações que já baixaram continuam funcionando. O auto-update para de oferecer a versão retirada.
