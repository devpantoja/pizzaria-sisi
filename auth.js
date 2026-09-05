// auth.js — login simples com 2 senhas (atendente/admin) + cookie assinado HMAC.
// Nao usa jwt/bcrypt (dependencia zero, so crypto do node).
//
// Env vars obrigatorias:
//   SENHA_ATENDENTE  — senha da tela do atendente / painel
//   SENHA_ADMIN      — senha do admin (cardápio, backup, zerar)
//   SESSION_SECRET   — segredo pra assinar o cookie (rode: openssl rand -hex 32)
//
// Sem essas vars o servidor mesmo assim sobe (modo aberto), mas emite warning.
// Isso mantem retro-compat com quem roda local sem env.

import { createHmac, timingSafeEqual } from 'node:crypto';

const SENHA_ATENDENTE = process.env.SENHA_ATENDENTE || '';
const SENHA_ADMIN = process.env.SENHA_ADMIN || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const AUTH_HABILITADO = !!(SENHA_ADMIN && SESSION_SECRET);
const COOKIE_NOME = 'sisi_sessao';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 dias

if (!AUTH_HABILITADO) {
  console.warn('[auth] SENHA_ADMIN ou SESSION_SECRET nao definidos — modo ABERTO (sem login).');
} else if (!SENHA_ATENDENTE) {
  console.warn('[auth] SENHA_ATENDENTE nao definido — atendente usara a senha admin.');
}

function assinar(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SESSION_SECRET).update(b).digest('base64url');
  return `${b}.${sig}`;
}

function verificar(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b, sig] = token.split('.');
  const esperada = createHmac('sha256', SESSION_SECRET).update(b).digest('base64url');
  const a = Buffer.from(sig || '');
  const e = Buffer.from(esperada);
  if (a.length !== e.length || !timingSafeEqual(a, e)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

export function sessaoDoReq(req) {
  if (!AUTH_HABILITADO) return { papel: 'admin', anonimo: true };
  const cookies = parseCookies(req.headers.cookie);
  return verificar(cookies[COOKIE_NOME]);
}

// Middleware: exige atendente OU admin
export function requireAtendente(req, res, next) {
  if (!AUTH_HABILITADO) return next();
  const s = sessaoDoReq(req);
  if (!s) return responderNaoAutorizado(req, res);
  return next();
}

// Middleware: exige admin
export function requireAdmin(req, res, next) {
  if (!AUTH_HABILITADO) return next();
  const s = sessaoDoReq(req);
  if (!s || s.papel !== 'admin') return responderNaoAutorizado(req, res);
  return next();
}

function responderNaoAutorizado(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ erro: 'nao autorizado — faca login em /login' });
  }
  return res.redirect(`/login?voltar=${encodeURIComponent(req.originalUrl)}`);
}

// ============= Handlers de login/logout =============

// POST /api/login  { senha }  →  seta cookie, retorna { papel }
export function loginHandler(req, res) {
  if (!AUTH_HABILITADO) {
    return res.json({ papel: 'admin', modo: 'aberto' });
  }
  const senha = String(req.body?.senha || '');
  if (!senha) return res.status(400).json({ erro: 'senha obrigatoria' });

  let papel = null;
  // Comparacao constant-time pra nao vazar timing
  if (SENHA_ADMIN && senha.length === SENHA_ADMIN.length &&
      timingSafeEqual(Buffer.from(senha), Buffer.from(SENHA_ADMIN))) {
    papel = 'admin';
  } else if (SENHA_ATENDENTE && senha.length === SENHA_ATENDENTE.length &&
      timingSafeEqual(Buffer.from(senha), Buffer.from(SENHA_ATENDENTE))) {
    papel = 'atendente';
  }

  if (!papel) return res.status(401).json({ erro: 'senha invalida' });

  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_S;
  const token = assinar({ papel, exp });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE_NOME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_S}` +
    (secure ? '; Secure' : ''));
  return res.json({ papel });
}

// POST /api/logout  →  limpa cookie
export function logoutHandler(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE_NOME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res.json({ ok: true });
}

// GET /api/sessao  →  info da sessao atual (pra UI mostrar "Sair", esconder botao Admin, etc)
export function sessaoHandler(req, res) {
  const s = sessaoDoReq(req);
  if (!s) return res.json({ autenticado: false, auth_habilitado: AUTH_HABILITADO });
  return res.json({ autenticado: true, papel: s.papel, anonimo: !!s.anonimo, auth_habilitado: AUTH_HABILITADO });
}

export { AUTH_HABILITADO };
