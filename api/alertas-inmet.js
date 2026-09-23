// Avisos meteorológicos ativos do INMET, filtrados para o RS.
import { fetchComTimeout, enviarJson, IBGE_PORTO_ALEGRE } from "./_util.js";

const API = "https://apiprevmet3.inmet.gov.br/avisos/ativos";

const listaGeocodes = (g) =>
  !g ? [] : Array.isArray(g) ? g.map(String) : String(g).split(/[\s,;]+/).filter(Boolean);

export function interpretarInmet(data) {
  const vistos = new Set();
  const todos = [...(data?.hoje ?? []), ...(data?.futuro ?? [])].filter((a) => {
    const chave = a.id ?? `${a.descricao}|${a.inicio}|${a.fim}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  return todos
    .map((a) => {
      const codigos = listaGeocodes(a.geocodes);
      const rs = codigos.filter((c) => c.startsWith("43"));
      return {
        id: a.id ?? null,
        evento: a.descricao ?? "Aviso",
        severidade: a.severidade ?? null,
        cor: a.aviso_cor ?? null,
        inicio: a.inicio ?? null,
        fim: a.fim ?? null,
        riscos: a.riscos ?? null,
        instrucoes: a.instrucoes ?? null,
        totalMunicipiosRS: rs.length,
        incluiPOA: codigos.includes(IBGE_PORTO_ALEGRE),
        link: a.id ? `https://alertas2.inmet.gov.br/${a.id}` : "https://alertas2.inmet.gov.br",
      };
    })
    .filter((a) => a.totalMunicipiosRS > 0)
    .sort((a, b) => Number(b.incluiPOA) - Number(a.incluiPOA) || b.totalMunicipiosRS - a.totalMunicipiosRS);
}

export default async function handler(req, res) {
  try {
    const r = await fetchComTimeout(API, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const alertas = interpretarInmet(await r.json());
    enviarJson(res, 200, { atualizadoEm: new Date().toISOString(), alertas }, 300);
  } catch (err) {
    enviarJson(res, 502, { erro: `Falha ao consultar o INMET: ${err.message}` });
  }
}
