// Funções compartilhadas pelas rotas /api (arquivos com "_" não viram rota na Vercel).

export async function fetchComTimeout(url, opcoes = {}, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opcoes, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Envia JSON com cache na CDN da Vercel. Em erro, não guarda cache.
export function enviarJson(res, status, dados, cacheSegundos = 120) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (status === 200 && cacheSegundos > 0) {
    res.setHeader("Cache-Control", `s-maxage=${cacheSegundos}, stale-while-revalidate=${cacheSegundos * 5}`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.status(status).json(dados);
}

export const IBGE_PORTO_ALEGRE = "4314902";

export function numeroOuNulo(valor, limite = 10000) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : parseFloat(String(valor).replace(",", "."));
  if (!Number.isFinite(n) || Math.abs(n) > limite) return null; // descarta leituras de sensor com defeito
  return n;
}
