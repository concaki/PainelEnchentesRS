// Estações telemétricas da ANA/SGB (HidroWeb/SNIRH) com cota de inundação conhecida.
import { fetchComTimeout, enviarJson } from "./_util.js";

// cota: cota de inundação em metros (null = sem cota oficial).
// Conferidas com nivelguaiba.com.br: São Leopoldo, Feliz, Gravataí, Muçum, Lajeado e Dona Francisca.
// A CONFERIR: Gasômetro (fontes divergem entre 2,60 m e 3,60 m) e Taquara (fontes citam 6 m e 7 m).
const ESTACOES = [
  { id: "87450020", rio: "Lago Guaíba", local: "Porto Alegre - Usina do Gasômetro", cota: 3.60 },
  { id: "87382000", rio: "Rio dos Sinos", local: "São Leopoldo", cota: 4.50 },
  { id: "87376000", rio: "Rio Paranhana", local: "Taquara", cota: 5.00 },
  { id: "87165001", rio: "Rio Caí", local: "Feliz", cota: 9.00 },
  { id: "87399000", rio: "Rio Gravataí", local: "Gravataí", cota: 4.75 },
  { id: "86510000", rio: "Rio Taquari", local: "Muçum", cota: 18.00 },
  { id: "86879300", rio: "Rio Taquari", local: "Lajeado", cota: 19.00 },
  { id: "85400000", rio: "Rio Jacuí", local: "Dona Francisca", cota: 7.50 },
  { id: "87980000", rio: "Lagoa dos Patos", local: "Rio Grande", cota: 1.90 },
];

const BASE = "https://ows.snirh.gov.br/ords/servicos/hidro";

async function buscarEstacao(est) {
  try {
    const [rMapa, r24] = await Promise.all([
      fetchComTimeout(`${BASE}/mapa/${est.id}`, {}, 15000),
      fetchComTimeout(`${BASE}/estacao/24h/${est.id}`, {}, 15000),
    ]);
    if (!rMapa.ok || !r24.ok) throw new Error(`HTTP ${rMapa.status}/${r24.status}`);
    const mapa = (await rMapa.json())?.items?.[0] ?? {};
    const serie = ((await r24.json())?.items ?? [])
      .filter((i) => i?.data && i?.nivel !== null && i?.nivel !== undefined && !isNaN(parseFloat(i.nivel)))
      .sort((a, b) => String(b.data).localeCompare(String(a.data))); // mais recente primeiro

    const nivelCm = !isNaN(parseFloat(mapa.nivel_ult)) ? parseFloat(mapa.nivel_ult) : serie[0] ? parseFloat(serie[0].nivel) : NaN;
    const nivel = Number.isFinite(nivelCm) ? nivelCm / 100 : null;

    // Tendência em cm/h entre as duas leituras mais recentes da série
    let tendenciaCmH = null;
    if (serie.length >= 2) {
      const [a, b] = serie;
      const horas = (Date.parse(a.data) - Date.parse(b.data)) / 3600000;
      if (horas > 0) tendenciaCmH = (parseFloat(a.nivel) - parseFloat(b.nivel)) / horas;
    }

    const pctCota = nivel !== null && est.cota ? (nivel / est.cota) * 100 : null;
    const status = pctCota === null ? null : pctCota >= 100 ? "inundacao" : pctCota >= 85 ? "atencao" : "normal";
    const chuva = parseFloat(mapa.chuva_ult);

    return {
      ...est,
      ok: nivel !== null,
      nivel,
      pctCota,
      status,
      tendenciaCmH,
      chuvaUltima: Number.isFinite(chuva) ? chuva : null,
      // O HidroWeb devolve horário local marcado como UTC; exibir com timeZone "UTC".
      dataLeitura: serie[0]?.data ?? null,
    };
  } catch (err) {
    return { ...est, ok: false, erro: err.message };
  }
}

export default async function handler(req, res) {
  const estacoes = await Promise.all(ESTACOES.map(buscarEstacao));
  const falhas = estacoes.filter((e) => !e.ok).length;
  if (falhas === estacoes.length) {
    return enviarJson(res, 502, { erro: "Nenhuma estação da ANA respondeu.", estacoes });
  }
  enviarJson(res, 200, { atualizadoEm: new Date().toISOString(), estacoes }, 300);
}
