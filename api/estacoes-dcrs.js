// Rede Hidrometeorológica da Defesa Civil RS (API GraphQL, dados via MKS).
// Documentação: https://sistemas.defesacivil.rs.gov.br/api-redehidrometeorologica
import { fetchComTimeout, descreverErro, enviarJson, numeroOuNulo } from "./_util.js";

const ENDPOINT = "https://redehidrometeorologica.defesacivil.rs.gov.br/graphql";
const CLIENT = "casa-militar-defesa-civil-rs";
const FILTRO = `clients: ["${CLIENT}"] filters: { localizacao: [{ codigos: ["43"], tipo: UNIDADE_FEDERATIVA }] }`;

// Consulta principal: campos já testados com sucesso (nível, chuva, posição).
const QUERY_BASE = `query EstacoesBase {
  tags_data(${FILTRO}) {
    qualle_meteorologia {
      codigo
      name { prefix general local }
      timestamp
      position { bacia latitude longitude regiao altitude }
      data {
        rio { rio_nivel { value } rio_nivel_tendencia { value } }
        chuva { acumulado { h001 { value } h024 { value } } }
      }
      filter { relacao { tem_nivel_do_rio tem_chuva_acumulada } }
    }
  }
}`;

// Consulta complementar: clima e mais acumulados de chuva.
// Fica separada para que, se algum campo falhar, os níveis continuem aparecendo.
const QUERY_EXTRA = `query EstacoesExtra {
  tags_data(${FILTRO}) {
    qualle_meteorologia {
      codigo
      data {
        chuva { acumulado { h003 { value } h012 { value } h168 { value } } }
        temperatura { atual { value } }
        senstermica { atual { value } }
        umidade { atual { value } }
        pressaoatmos { atual { value } }
        vento { velocidade_media { value } velocidade_maxima { value } direcao { value } }
      }
    }
  }
}`;

async function consultar(query) {
  const res = await fetchComTimeout(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.data && json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  const bruto = json.data?.tags_data;
  return (Array.isArray(bruto) ? bruto : [bruto]).flatMap((b) => b?.qualle_meteorologia ?? []);
}

const v = (campo, limite) => numeroOuNulo(campo?.value, limite);
const limpar = (texto) => String(texto ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const TRES_HORAS = 3 * 60 * 60 * 1000;

export default async function handler(req, res) {
  const avisos = [];
  let base;
  try {
    base = await consultar(QUERY_BASE);
  } catch (err) {
    console.error(err);
    return enviarJson(res, 502, { erro: `Falha ao consultar a Defesa Civil RS: ${descreverErro(err)}` });
  }

  const extras = new Map();
  try {
    for (const e of await consultar(QUERY_EXTRA)) extras.set(e.codigo, e);
  } catch (err) {
    console.error(err);
    avisos.push(`Dados de clima indisponíveis: ${descreverErro(err)}`);
  }

  const agora = Date.now();
  const estacoes = base.map((e) => {
    const x = extras.get(e.codigo)?.data ?? {};
    const nome = [e.name?.general, e.name?.local].map(limpar).filter(Boolean).join(" - ") || limpar(e.name?.prefix) || e.codigo;
    const nivelBruto = e.data?.rio?.rio_nivel?.value;
    const nivel = v(e.data?.rio?.rio_nivel);
    const temRio = Boolean(e.filter?.relacao?.tem_nivel_do_rio) || nivelBruto != null;
    const leitura = e.timestamp ? Date.parse(e.timestamp) : NaN;

    return {
      codigo: e.codigo,
      nome,
      bacia: limpar(e.position?.bacia).replace(/^RS\s*-\s*/, "") || null,
      regiao: limpar(e.position?.regiao) || null,
      latitude: numeroOuNulo(e.position?.latitude),
      longitude: numeroOuNulo(e.position?.longitude),
      ultimaLeitura: e.timestamp ?? null,
      desatualizada: Number.isFinite(leitura) ? agora - leitura > TRES_HORAS : true,
      temRio,
      nivel,
      sensorComDefeito: temRio && nivelBruto != null && nivel === null,
      // Unidade inferida: metros por hora (confirmar com a Defesa Civil)
      tendenciaMh: v(e.data?.rio?.rio_nivel_tendencia, 100),
      chuva: {
        h1: v(e.data?.chuva?.acumulado?.h001, 2000),
        h3: v(x.chuva?.acumulado?.h003, 2000),
        h12: v(x.chuva?.acumulado?.h012, 2000),
        h24: v(e.data?.chuva?.acumulado?.h024, 2000),
        h168: v(x.chuva?.acumulado?.h168, 5000),
      },
      clima: {
        temperatura: v(x.temperatura?.atual, 70),
        sensacao: v(x.senstermica?.atual, 80),
        umidade: v(x.umidade?.atual, 100),
        pressao: v(x.pressaoatmos?.atual, 1200),
        ventoMedio: v(x.vento?.velocidade_media, 400),
        ventoMaximo: v(x.vento?.velocidade_maxima, 400),
        ventoDirecao: v(x.vento?.direcao, 360),
      },
    };
  });

  enviarJson(res, 200, { atualizadoEm: new Date().toISOString(), total: estacoes.length, avisos, estacoes }, 120);
}
