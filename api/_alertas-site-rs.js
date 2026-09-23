// Alertas publicados no site da Defesa Civil do RS (defesacivil.rs.gov.br).
// Todas as páginas do site trazem um bloco "Avisos e Alertas" com as publicações mais recentes;
// o painel lê esse bloco e depois abre cada publicação para pegar descrição e validade.
import { fetchComTimeout, decodificarEntidades, IBGE_PORTO_ALEGRE } from "./_util.js";

const SITE = "https://www.defesacivil.rs.gov.br";
const PAGINAS_LISTA = [`${SITE}/avisos-e-alertas`, `${SITE}/inicial`, `${SITE}/links-uteis-64d674c5112fe`];
const MAX_ITENS = 8;
const JANELA_BOLETIM_MS = 48 * 3600000; // boletins sem validade explícita valem por 48h

const MESES = { janeiro: 1, fevereiro: 2, marco: 3, "março": 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

const semTags = (s) => decodificarEntidades(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Horário de Brasília (UTC-3, sem horário de verão)
const dataBrasilia = (ano, mes, dia, h = 0, min = 0) => Date.UTC(ano, mes - 1, dia, h + 3, min);

// Lista de publicações: data "DD/MM/AAAA - HHhMMmin" seguida do link com o título
export function extrairLista(html) {
  const itens = [];
  const reData = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2})h(\d{2})\s*min/g;
  let m;
  while ((m = reData.exec(html))) {
    const trecho = html.slice(m.index, m.index + 1500);
    const reLink = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let l;
    while ((l = reLink.exec(trecho))) {
      const titulo = semTags(l[2]);
      if (titulo.length < 20) continue;
      const url = new URL(l[1], SITE).toString();
      if (!url.startsWith(SITE)) break;
      const [, dd, mm, aaaa, hh, mi] = m.map(Number);
      itens.push({ url, titulo, publicado: dataBrasilia(aaaa, mm, dd, hh, mi) });
      break;
    }
  }
  return itens;
}

const ehAlertaOuAviso = (t) => /alerta|aviso|condi[cç][õo]es (hidrol|meteorol)|progn[óo]stico|risco/i.test(t);

// "Válido até às 14h30 do dia 23 de setembro", "Validade até 17h do dia 29 de julho", "... do dia 29/07/2026"
export function extrairValidade(texto, publicado) {
  const m = String(texto).normalize("NFC").match(
    /v[áa]lid(?:o|a|ade)\s+at[ée]\s+(?:[àa]s\s+)?(\d{1,2})\s*h\s*(\d{2})?\s*(?:min)?\s*(?:do\s+dia|de)\s+(\d{1,2})(?:\s+de\s+([a-zçã]+)|\/(\d{1,2})(?:\/(\d{4}))?)/i
  );
  if (!m) return null;
  const [, h, min, dia, mesNome, mesNum, anoTxt] = m;
  const mes = mesNum ? Number(mesNum) : MESES[mesNome?.toLowerCase()];
  if (!mes) return null;
  const pub = new Date(publicado - 3 * 3600000); // data de publicação no horário de Brasília
  let ano = anoTxt ? Number(anoTxt) : pub.getUTCFullYear();
  if (!anoTxt && pub.getUTCMonth() + 1 - mes > 6) ano += 1; // virada de ano (publicado em dezembro, válido em janeiro)
  return dataBrasilia(ano, mes, Number(dia), Number(h), Number(min || 0));
}

function classificar(texto) {
  if (/muito alto|vermelh/i.test(texto)) return { severidade: "Risco muito alto", ordem: 0 };
  if (/risco alto|\balto\b|laranja/i.test(texto)) return { severidade: "Risco alto", ordem: 1 };
  if (/moderad|amarel|aten[cç][ãa]o/i.test(texto)) return { severidade: "Risco moderado", ordem: 2 };
  if (/baixo/i.test(texto)) return { severidade: "Risco baixo", ordem: 3 };
  return { severidade: null, ordem: 4 };
}

const meta = (html, nome) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]*content=["']([^"']*)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${nome}["']`, "i"));
  return m ? semTags(m[1]) : null;
};

async function baixarHtml(url) {
  const r = await fetchComTimeout(url, { headers: { Accept: "text/html" } }, 15000);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export async function alertasDoSite(agora = Date.now()) {
  const paginas = await Promise.allSettled(PAGINAS_LISTA.map(baixarHtml));
  const ok = paginas.filter((p) => p.status === "fulfilled").map((p) => p.value);
  if (!ok.length) throw paginas[0].reason;

  const porUrl = new Map();
  for (const html of ok) for (const item of extrairLista(html)) if (ehAlertaOuAviso(item.titulo)) porUrl.set(item.url, item);
  const recentes = [...porUrl.values()].sort((a, b) => b.publicado - a.publicado).slice(0, MAX_ITENS);

  const detalhes = await Promise.allSettled(recentes.map((i) => baixarHtml(i.url)));
  const alertas = [];
  recentes.forEach((item, i) => {
    const html = detalhes[i].status === "fulfilled" ? detalhes[i].value : "";
    const descricao = (html && (meta(html, "og:description") || meta(html, "description"))) || null;
    const texto = `${item.titulo} ${descricao ?? ""}`;
    const expira = extrairValidade(texto, item.publicado);
    const ehAlerta = /alerta/i.test(item.titulo);

    if (expira && expira < agora) return; // alerta já vencido
    if (!expira && agora - item.publicado > JANELA_BOLETIM_MS) return; // boletim antigo

    const { severidade, ordem } = ehAlerta ? classificar(item.titulo) : { severidade: null, ordem: 5 };
    const evento = ehAlerta
      ? (item.titulo.match(/alerta:\s*(?:alerta\s+\w+:\s*)?([^.]+)/i)?.[1] ?? "Alerta").trim()
      : "Boletim";
    alertas.push({
      id: item.url,
      evento,
      titulo: item.titulo,
      descricao,
      instrucao: null,
      emissor: "Defesa Civil RS",
      severidade,
      ordemSeveridade: ordem,
      enviado: new Date(item.publicado).toISOString(),
      inicio: new Date(item.publicado).toISOString(),
      expira: expira ? new Date(expira).toISOString() : null,
      municipios: [],
      totalMunicipios: 0,
      todoEstado: false,
      incluiPOA: /porto alegre|guaíba|guaiba/i.test(texto) || texto.includes(IBGE_PORTO_ALEGRE),
      link: item.url,
      origem: "site",
    });
  });
  return alertas;
}
