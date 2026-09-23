// Alertas da Defesa Civil publicados na IDAP (Interface de Divulgação de Alertas Públicos - MIDR),
// no formato CAP. São os mesmos alertas enviados por SMS 40199, WhatsApp, Telegram e Cell Broadcast.
import { alertasDoSite } from "./_alertas-site-rs.js";
import { fetchComTimeout, buscarTextoCompativel, descreverErro, enviarJson, decodificarEntidades, IBGE_PORTO_ALEGRE } from "./_util.js";

const FEED = "https://idapfile.mdr.gov.br/idap/api/rss/cap";
// Plano B: diretório público com um arquivo CAP por alerta, nomeado <id><DDMMAAAA>-<UF>.xml
const DIRETORIO_CAP = "https://idapcap.mdr.gov.br/";
const MAX_ARQUIVOS = 40;   // alertas mais recentes do RS a baixar do diretório
const DIAS_JANELA = 3;     // considera arquivos dos últimos N dias

// ---- Leitura simples de XML (sem dependências), tolerante a prefixos como "cap:" ou "ns2:" ----
const decodificar = (s) =>
  decodificarEntidades(String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();

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

// Lê a listagem do diretório e retorna os arquivos do RS dos últimos dias, do mais novo ao mais antigo
export function arquivosRecentesRS(html, agora = Date.now()) {
  const limite = agora - DIAS_JANELA * 86400000;
  const nomes = new Set([...String(html).matchAll(/href="([^"]*?(\d+)-RS\.xml)"/gi)].map((m) => m[1]));
  return [...nomes]
    .map((nome) => {
      const m = nome.match(/(\d+)(\d{2})(\d{2})(\d{4})-RS\.xml$/i);
      if (!m) return null;
      const [, id, dd, mm, aaaa] = m;
      const data = Date.parse(`${aaaa}-${mm}-${dd}T23:59:59-03:00`);
      return { nome, id: Number(id), data };
    })
    .filter((a) => a && a.data >= limite)
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_ARQUIVOS);
}

// Tenta primeiro o fetch padrão; se a conexão cair, tenta com TLS compatível
async function baixarTexto(url, ms) {
  try {
    const r = await fetchComTimeout(url, { headers: { Accept: "application/atom+xml, application/xml, text/xml, text/html" } }, ms);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (err) {
    if (/HTTP \d/.test(err.message)) throw err;
    try {
      return await buscarTextoCompativel(url, ms);
    } catch (err2) {
      throw new Error(`${descreverErro(err)} / TLS compatível: ${descreverErro(err2)}`);
    }
  }
}

async function viaFeed() {
  return interpretarAlertas(await baixarTexto(FEED, 25000));
}

async function viaDiretorio() {
  const listagem = await baixarTexto(DIRETORIO_CAP, 25000);
  const arquivos = arquivosRecentesRS(listagem);
  const alertas = [];
  for (let i = 0; i < arquivos.length; i += 5) {
    const lote = await Promise.allSettled(
      arquivos.slice(i, i + 5).map((a) => baixarTexto(new URL(a.nome, DIRETORIO_CAP).toString(), 15000))
    );
    for (const r of lote) if (r.status === "fulfilled") alertas.push(...interpretarAlertas(r.value));
  }
  // Reaplica a ordenação e a remoção de duplicados
  const porId = new Map();
  for (const a of alertas) {
    const ant = porId.get(a.id);
    if (!ant || String(a.enviado) > String(ant.enviado)) porId.set(a.id, a);
  }
  return [...porId.values()].sort(
    (a, b) => Number(b.incluiPOA) - Number(a.incluiPOA) || a.ordemSeveridade - b.ordemSeveridade || String(b.enviado).localeCompare(String(a.enviado))
  );
}

async function viaIdap() {
  const falhas = [];
  for (const [fonte, buscar] of [["feed IDAP", viaFeed], ["diretório CAP", viaDiretorio]]) {
    try {
      return { alertas: await buscar(), falhas };
    } catch (err) {
      console.error(`Falha em ${fonte}:`, err);
      falhas.push(`${fonte}: ${descreverErro(err)}`);
    }
  }
  throw new Error(falhas.join(" | "));
}

const ordenar = (lista) => lista.sort(
  (a, b) => Number(b.incluiPOA) - Number(a.incluiPOA) || a.ordemSeveridade - b.ordemSeveridade || String(b.enviado).localeCompare(String(a.enviado))
);

// Junta as duas fontes: IDAP (alertas estaduais e municipais em CAP) e o site da Defesa Civil RS.
// Basta uma delas responder para o painel mostrar os alertas.
export default async function handler(req, res) {
  const [idap, site] = await Promise.allSettled([viaIdap(), alertasDoSite()]);
  const fontes = [];
  const falhas = [];
  let alertas = [];

  if (idap.status === "fulfilled") { fontes.push("IDAP"); alertas.push(...idap.value.alertas.map((a) => ({ ...a, origem: "idap" }))); }
  else falhas.push(`IDAP: ${descreverErro(idap.reason)}`);

  if (site.status === "fulfilled") { fontes.push("site Defesa Civil RS"); alertas.push(...site.value); }
  else { console.error("Falha no site da Defesa Civil RS:", site.reason); falhas.push(`site Defesa Civil RS: ${descreverErro(site.reason)}`); }

  if (!fontes.length) return enviarJson(res, 502, { erro: `Nenhuma fonte de alertas respondeu. ${falhas.join(" || ")}` });
  enviarJson(res, 200, { atualizadoEm: new Date().toISOString(), fontes, falhas, alertas: ordenar(alertas) }, 120);
}
