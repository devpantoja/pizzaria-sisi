# Setup do GitHub — Pipeline de Build Automático

Instruções pra configurar o repositório e ativar o pipeline que compila o instalador Windows automaticamente.

---

## 1. Criar o repositório

```bash
cd /Users/gustavopantoja/Downloads/pizzaria

# Se ainda não é um repo git
git init
git add .
git commit -m "Initial commit"

# Cria repo no GitHub e faz push (com gh CLI)
gh repo create devpantoja/pizzaria-sisi --private --source=. --push
```

> Pode ser **privado** — o pipeline funciona igual. Recomendo privado pra não expor o código.

---

## 2. Ajustar o nome do repo no updater

Se o repo não for `devpantoja/pizzaria-sisi`, edite `updater.js`:

```js
const REPO = process.env.UPDATE_REPO || 'seu-user/seu-repo';
```

---

## 3. Verificar as permissões do workflow

No GitHub, vá em:

**Settings → Actions → General → Workflow permissions**

Marque:
- [x] **Read and write permissions**  ← necessário pra publicar releases
- [x] Allow GitHub Actions to create and approve pull requests

Salve.

---

## 4. Primeiro build

**Push em main** (gera build "dev-latest"):

```bash
git push origin main
```

Acesse **Actions** no GitHub — deve ver o workflow "Build Windows Installer" rodando.
Leva ~5-8 min (baixar deps + Node runtime + Inno Setup + compilar).

Ao final, aparece uma **release "dev-latest"** marcada como pre-release em:
`https://github.com/devpantoja/pizzaria-sisi/releases`

Pode baixar o `.exe` de lá pra testar. Auto-update **não** aponta pra essa release (é ignorada por ser prerelease).

---

## 5. Primeiro release oficial

Quando estiver pronto pra os clientes:

```bash
# Atualize versão no package.json
# (ex: "version": "0.1.0")

git add package.json
git commit -m "chore: bump v0.1.0"

# Cria e faz push da tag
git tag v0.1.0
git push origin v0.1.0
```

O pipeline dispara e cria uma **release oficial `v0.1.0`** no GitHub.
A partir desse momento, todos os clientes instalados vão detectar (em até 6h) e podem clicar "Atualizar agora" no admin.

---

## 6. Como fazer uma nova release depois

```bash
# 1. Bump da versão
npm version patch    # 0.1.0 → 0.1.1
# ou:
npm version minor    # 0.1.0 → 0.2.0
# ou:
npm version major    # 0.1.0 → 1.0.0

# 2. Push (o npm version já criou a tag)
git push origin main --tags
```

Pipeline dispara sozinho, gera .exe, publica no Releases. Cliente atualiza no próximo boot ou clicando "Verificar atualizações".

---

## 7. Como testar sem afetar clientes

Ao push em `main`, sai uma release `dev-latest` (prerelease).

- Baixe o `.exe` da release `dev-latest`
- Instale numa VM Windows
- Teste
- Se estiver ok, cria a tag `vX.Y.Z` pra virar oficial

Se der algum problema em `dev-latest`, nenhum cliente é afetado — a versão oficial anterior continua sendo servida pelo updater.

---

## Custos

- **Repo público**: GitHub Actions grátis, sem limite de minutos
- **Repo privado**: 2.000 min/mês grátis. Cada build leva ~6 min → dá pra ~330 builds/mês
- **Storage de releases**: ilimitado no GitHub

---

## Troubleshooting

### "Resource not accessible by integration"

Você esqueceu de habilitar **Read and write permissions** no passo 3.

### "Tag already exists"

Você tentou publicar duas releases com a mesma tag. Delete a tag e reenvie:

```bash
git tag -d v0.1.0
git push --delete origin v0.1.0
git tag v0.1.0
git push origin v0.1.0
```

### `npm ci` falhou no workflow

Rode `npm install` local e faça commit do `package-lock.json` atualizado.

### Cliente diz "não achou versão" no updater

Verifique:
1. Existe uma release **não-prerelease** no GitHub?
2. O asset da release tem `win` no nome? (ex: `SisiPizzeria-Setup-win.exe`)
3. O `REPO` no `updater.js` bate com o nome real do repositório?
