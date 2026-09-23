# PainelEnchentesRS

Painel de monitoramento de enchentes no Rio Grande do Sul: alertas da Defesa Civil e do INMET,
nível dos rios (ANA/SGB e rede da Defesa Civil RS), chuva acumulada e tempo agora.

## Estrutura

```
index.html                    página do painel
api/alertas-defesa-civil.js   alertas da IDAP (Defesa Civil Nacional, formato CAP), filtrados para o RS
api/alertas-inmet.js          avisos ativos do INMET, filtrados para o RS
api/estacoes-dcrs.js          Rede Hidrometeorológica da Defesa Civil RS (API GraphQL)
api/estacoes-ana.js           estações da ANA/SGB com cota de inundação
api/_util.js                  funções compartilhadas (não vira rota)
vercel.json                   funções rodando em São Paulo (gru1)
package.json
```

As funções em `/api` rodam na Vercel e buscam os dados no servidor. Assim o navegador não esbarra
em bloqueios de CORS, nenhuma chave fica exposta e as respostas ficam em cache por 2 a 5 minutos.

## Publicar

Basta enviar estes arquivos para o repositório ligado à Vercel. Não há build nem dependências.
Para testar localmente: `npx vercel dev`.

## Pontos a conferir

- Cotas do Gasômetro e de Taquara em `api/estacoes-ana.js` (fontes divergem).
- A unidade da tendência da rede da Defesa Civil foi inferida como metros por hora.
- A documentação da API da Defesa Civil RS pede para consultar as condições de uso antes de
  usar os dados em produções públicas.

## Fontes

Defesa Civil RS (Rede Hidrometeorológica, dados MKS), Defesa Civil Nacional (IDAP/MIDR),
INMET e ANA/SGB. Este painel não emite alertas oficiais.
