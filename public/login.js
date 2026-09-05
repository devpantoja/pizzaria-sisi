const $ = (id) => document.getElementById(id);
const form = $('formLogin');
const inputSenha = $('senha');
const btn = $('btnEntrar');
const erro = $('msgErro');

const params = new URLSearchParams(location.search);
const voltar = params.get('voltar') || '/atendente';

function mostrarErro(msg) {
  erro.textContent = msg;
  erro.classList.add('mostrar');
}
function limparErro() {
  erro.classList.remove('mostrar');
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  limparErro();
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: inputSenha.value }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.erro || `HTTP ${r.status}`);
    }
    const { papel } = await r.json();
    // Se atendente tentou ir pra /admin, redireciona pra /atendente
    const destino = (papel === 'atendente' && voltar.startsWith('/admin'))
      ? '/atendente'
      : voltar;
    location.href = destino;
  } catch (e) {
    mostrarErro(e.message);
    btn.disabled = false;
    btn.textContent = 'Entrar';
    inputSenha.select();
  }
});
