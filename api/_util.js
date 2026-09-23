import https from "node:https";
import crypto from "node:crypto";

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

// Busca texto via https nativo aceitando servidores com TLS antigo.
// A verificação do certificado continua ativa; só se amplia a compatibilidade de protocolo e cifras.
export function buscarTextoCompativel(url, ms = 25000, redirecionamentos = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: CABECALHOS_PADRAO,
      minVersion: "TLSv1",
      ciphers: "DEFAULT@SECLEVEL=0",
      secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
      timeout: ms,
    }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location && redirecionamentos > 0) {
        res.resume();
        return resolve(buscarTextoCompativel(new URL(headers.location, url).toString(), ms, redirecionamentos - 1));
      }
      if (statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${statusCode}`)); }
      res.setEncoding("utf8");
      let dados = "";
      res.on("data", (c) => { dados += c; });
      res.on("end", () => resolve(dados));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("tempo esgotado"), { name: "AbortError" })));
    req.on("error", reject);
  });
}

// "fetch failed" esconde o motivo real; ele fica em err.cause (DNS, certificado, conexão recusada...)
export function descreverErro(err) {
  if (err?.name === "AbortError") return "tempo esgotado";
  const causa = err?.cause ?? (err?.code ? err : null);
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

// Converte entidades HTML (&ccedil;, &atilde;, &#231;, &#xE7;...) em caracteres
const ENTIDADES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ordm: "º", ordf: "ª", deg: "°", ndash: "–", mdash: "—", hellip: "…",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", middot: "·", bull: "•",
};
const ACENTOS = { acute: "\u0301", grave: "\u0300", circ: "\u0302", tilde: "\u0303", uml: "\u0308", cedil: "\u0327" };

export function decodificarEntidades(texto) {
  return String(texto ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z])(acute|grave|circ|tilde|uml|cedil);/g, (_, letra, acento) => (letra + ACENTOS[acento]).normalize("NFC"))
    .replace(/&([a-zA-Z]+);/g, (orig, nome) => ENTIDADES[nome] ?? ENTIDADES[nome.toLowerCase()] ?? orig);
}
