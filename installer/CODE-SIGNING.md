# Guia de Assinatura de Código (Code Signing) — Windows

**Quando fazer**: quando o número de instalações for grande e você começar a receber reclamações de aviso "Windows protegeu seu PC" (SmartScreen).

**Custo**: US$ 200-500/ano por certificado.

**Benefício**:

- Elimina aviso "Editor desconhecido" no SmartScreen (a partir de umas dezenas de instalações — Microsoft calcula "reputação")
- Elimina aviso vermelho do Chrome/Edge ao baixar o instalador
- Instalador mostra "CodeGus" como publisher em vez de "Desconhecido"

---

## 1. Escolha um Certificado

Duas opções:

### a) Certificado OV (Organization Validation) — Recomendado

- **Custo**: ~US$ 200-300/ano
- **Reputação SmartScreen**: acumula gradualmente conforme instalações
- **Validação**: precisa comprovar que a CodeGus existe como empresa (CNPJ + comprovante de endereço)
- **Fornecedores**: [Sectigo](https://sectigo.com/), [SSL.com](https://ssl.com/certificates/code-signing/), [DigiCert](https://www.digicert.com/signing/code-signing-certificates), [Certum](https://shop.certum.eu/) (mais barato)

### b) Certificado EV (Extended Validation)

- **Custo**: ~US$ 400-600/ano
- **Reputação SmartScreen**: **instantânea** (dispensa acúmulo de reputação)
- **Validação**: mais rigorosa (documentos + verificação de vídeo/telefone)
- **Fornecedores**: mesmos acima
- **Diferença técnica**: vem em um **token USB HSM** — você precisa plugar o pendrive pra assinar

Para CodeGus começando, o **OV da Certum** é o melhor custo-benefício.

---

## 2. Instale o Certificado

O fornecedor entrega um arquivo `.pfx` ou `.p12` (contém chave privada + certificado). Instale no PC Windows onde você faz builds:

```
Botão direito no .pfx → Instalar → Usuário atual → digite a senha
```

O certificado fica no Windows Certificate Store.

---

## 3. Instale a ferramenta `signtool`

Já vem com o **Windows SDK**: https://developer.microsoft.com/pt-br/windows/downloads/windows-sdk/

Após instalar, `signtool.exe` fica em:

```
C:\Program Files (x86)\Windows Kits\10\bin\<versão>\x64\signtool.exe
```

---

## 4. Assine o Instalador

Depois de gerar `SisiPizzeria-Setup-v0.X.X.exe` pelo Inno Setup, rode:

```powershell
signtool sign /a /tr http://timestamp.digicert.com /td sha256 /fd sha256 ^
    "dist\installer\SisiPizzeria-Setup-v0.2.0.exe"
```

Explicando os parâmetros:

- `/a` — usa automaticamente o melhor certificado no Store
- `/tr http://timestamp.digicert.com` — timestamp server (importante: sem isso, a assinatura expira quando o cert expirar)
- `/td sha256` — algoritmo do timestamp
- `/fd sha256` — algoritmo da assinatura

Confirme com:

```powershell
signtool verify /pa "dist\installer\SisiPizzeria-Setup-v0.2.0.exe"
```

Deve mostrar "Successfully verified" e o nome CodeGus.

---

## 5. Automatize no Inno Setup (opcional)

Adicione no `setup.iss`, na seção `[Setup]`:

```
SignTool=signtool
```

E registra o comando de assinatura no Inno Setup Compiler:

```
Tools → Configure Sign Tools → Add:
    Name: signtool
    Command: "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /a /tr http://timestamp.digicert.com /td sha256 /fd sha256 $f
```

Agora todo build no Inno Setup já sai assinado.

---

## 6. Assine também o binário interno (opcional)

Se quiser assinar o `node.exe` empacotado também (não é obrigatório mas melhora reputação):

```powershell
signtool sign /a /tr http://timestamp.digicert.com /td sha256 /fd sha256 ^
    "dist\runtime\node.exe"
```

---

## Custo-benefício

| Situação | Recomendação |
|---|---|
| **< 10 instalações** | Não precisa. SmartScreen só chateia, mas usuário pode "Executar assim mesmo". |
| **10-50 instalações** | Vale a pena OV (~US$ 250/ano) |
| **50+ instalações ou clientes exigentes** | EV (~US$ 500/ano) — sem espera de reputação |

---

## Alternativas se você não quer pagar cert

1. **Distribuir via Microsoft Store**: gratuito, mas exige app UWP/MSIX. Muito trabalho pra reformatar.
2. **Documentar o "aviso" no manual**: instruir cliente a clicar em "Mais informações → Executar assim mesmo". Funciona mas fica amador.
3. **Instalador Chocolatey / winget**: pra usuários técnicos. Não serve pra pizzaria.

Recomendo começar sem cert e comprar quando começar a incomodar. O sistema já foi feito pra funcionar em qualquer cenário.
