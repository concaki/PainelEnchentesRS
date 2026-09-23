// Alertas da Defesa Civil publicados na IDAP (Interface de Divulgação de Alertas Públicos - MIDR),
// no formato CAP. São os mesmos alertas enviados por SMS 40199, WhatsApp, Telegram e Cell Broadcast.
import { fetchComTimeout, descreverErro, enviarJson, IBGE_PORTO_ALEGRE } from "./_util.js";

const FEED = "https://idapfile.mdr.gov.br/idap/api/rss/cap";

// ---- Leitura simples de XML (sem dependências), tolerante a prefixos como "cap:" ou "ns2:" ----
const decodificar = (s) =>
  String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();

function blocos(xml, tag) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "gi");
  return [...String(xml).matchAll(re)].map((m) => m[1]);
}
const primeiro = (xml, tag) => { const b = blocos(xml, tag); return b.length ? decodificar(b[0]) : null; };

const SEVERIDADE = { Extreme: "Extrema", Severe: "Severa", Moderate: "Moderada", Minor: "Baixa", Unknown: "Desconhecida" };
const ORDEM_SEV = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
const URGENCIA = { Immediate: "Imediata", Expected: "Esperada", Future: "Futura", Past: "Passada", Unknown: "Desconhecida" };

export function interpretarAlertas(xml, agora = Date.now()) {
  const porId = new Map();

  for (const alerta of blocos(xml, "alert")) {
    const status = primeiro(alerta, "status");
    const msgType = primeiro(alerta, "msgType");
    if (status && status !== "Actual") continue;
    if (msgType === "Cancel") continue;

    const infos = blocos(alerta, "info");
    const info = infos.find((i) => /pt/i.test(primeiro(i, "language") ?? "")) ?? infos[0];
    if (!info) continue;

    const expira = primeiro(info, "expires");
    if (expira && Date.parse(expira) < agora) continue; // já expirou

    const areas = blocos(info, "area");
    const descricoesArea = areas.map((a) => primeiro(a, "areaDesc")).filter(Boolean);
    const ibge = areas.flatMap((a) =>
      blocos(a, "geocode")
        .filter((g) => /ibge/i.test(primeiro(g, "valueName") ?? ""))
        .flatMap((g) => (primeiro(g, "value") ?? "").split(/[\s,;]+/))
    ).filter(Boolean);

    const emissor = primeiro(info, "senderName") ?? "";
    const titulo = primeiro(info, "headline") ?? "";
    const ehRS =
      ibge.some((c) => c.startsWith("43")) ||
      descricoesArea.some((d) => /\/\s*RS\b|rio grande do sul/i.test(d)) ||
      /rio grande do sul/i.test(emissor) ||
      /\(RS\)/.test(titulo);
    if (!ehRS) continue;

    // Municípios citados na área, no formato "CIDADE/RS"
    const municipios = [...new Set(
      descricoesArea.flatMap((d) => d.split(/[,;]/)).map((d) => d.trim())
        .filter((d) => /\/\s*RS$/i.test(d)).map((d) => d.replace(/\s*\/\s*RS$/i, ""))
    )];
    const todoEstado = municipios.some((m) => /^rio grande do sul$/i.test(m));
    const listaMunicipios = municipios.filter((m) => !/^rio grande do sul$/i.test(m));

    const sevIngles = primeiro(info, "severity") ?? "Unknown";
    const id = primeiro(alerta, "identifier") ?? `${titulo}|${primeiro(alerta, "sent")}`;
    const item = {
      id,
      evento: primeiro(info, "event"),
      titulo,
      descricao: primeiro(info, "description"),
      instrucao: primeiro(info, "instruction"),
      emissor,
      severidade: SEVERIDADE[sevIngles] ?? sevIngles,
      ordemSeveridade: ORDEM_SEV[sevIngles] ?? 5,
      urgencia: URGENCIA[primeiro(info, "urgency")] ?? primeiro(info, "urgency"),
      enviado: primeiro(alerta, "sent"),
      inicio: primeiro(info, "onset") ?? primeiro(info, "effective") ?? primeiro(alerta, "sent"),
      expira,
      municipios: listaMunicipios.slice(0, 60),
      totalMunicipios: Math.max(listaMunicipios.length, ibge.filter((c) => c.startsWith("43")).length),
      todoEstado,
      incluiPOA: ibge.includes(IBGE_PORTO_ALEGRE) || municipios.some((m) => /^porto alegre$/i.test(m)),
      link: primeiro(info, "web"),
    };

    // Atualizações repetem o identificador: fica a versão mais recente
    const anterior = porId.get(id);
    if (!anterior || String(item.enviado) > String(anterior.enviado)) porId.set(id, item);
  }

  return [...porId.values()].sort(
    (a, b) => Number(b.incluiPOA) - Number(a.incluiPOA) || a.ordemSeveridade - b.ordemSeveridade || String(b.enviado).localeCompare(String(a.enviado))
  );
}

export default async function handler(req, res) {
  try {
    const r = await fetchComTimeout(FEED, { headers: { Accept: "application/atom+xml, application/xml, text/xml" } }, 25000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const alertas = interpretarAlertas(await r.text());
    enviarJson(res, 200, { atualizadoEm: new Date().toISOString(), alertas }, 120);
  } catch (err) {
    console.error(err);
    enviarJson(res, 502, { erro: `Falha ao consultar a IDAP: ${descreverErro(err)}` });
  }
}
