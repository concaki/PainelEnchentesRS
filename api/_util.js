// Funções compartilhadas pelas rotas /api (arquivos com "_" não viram rota na Vercel).

// Alguns servidores do governo derrubam conexões sem User-Agent identificável.
const CABECALHOS_PADRAO = {
  "User-Agent": "Mozilla/5.0 (compatible; PainelEnchentesRS/1.0; +https://painelenchentesrs.vercel.app)",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

// fetch com tempo limite e uma nova tentativa em caso de falha de rede
export async function fetchComTimeout(url, opcoes = {}, ms = 20000, tentativas = 2) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...opcoes, headers: { ...CABECALHOS_PADRAO, ...(opcoes.headers || {}) }, signal: controller.signal });
    } catch (err) {
      ultimoErro = err;
      if (i < tentativas - 1) await new Promise((r) => setTimeout(r, 800));
    } finally {
      clearTimeout(timer);
    }
  }
  throw ultimoErro;
}

// "fetch failed" esconde o motivo real; ele fica em err.cause (DNS, certificado, conexão recusada...)
export function descreverErro(err) {
  if (err?.name === "AbortError") return "tempo esgotado";
  const causa = err?.cause;
  const detalhe = causa ? [causa.code, causa.message].filter(Boolean).join(": ") : "";
  return detalhe && detalhe !== err.message ? `${err.message} (${detalhe})` : String(err?.message ?? err);
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
