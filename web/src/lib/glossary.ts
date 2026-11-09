// Plain-language definitions of the panel's own terms - one place, so the
// "?" tips (components/HelpTip.tsx) say the same thing on every screen.
export const GLOSSARY = {
  foraDoContrato:
    'A impressora continua monitorada (contador, toner, alertas), mas não entra na fatura. Use para impressoras do cliente que não fazem parte do contrato.',
  entraNoContrato: 'A impressora entra na fatura do cliente, de acordo com o contrato dele.',
  revisar:
    'Impressora nova que o agente encontrou fora da rede dele ou sem contador. Fica fora da cobrança até alguém abrir a página dela e confirmar se é deste cliente.',
  paginasImpressas:
    'Páginas que a impressora realmente imprimiu. É o número usado na cobrança quando a impressora informa esse contador.',
  contadorMecanismo:
    'Contador total do mecanismo da impressora. Em algumas marcas ele também soma cópias, faxes ou digitalizações - por isso pode ser maior que as páginas impressas.',
  leituraInicialManual:
    'Contador que a impressora tinha numa data antes de o agente começar a monitorar (tirado de um relatório ou do painel da impressora). Serve de ponto de partida para cobrar o primeiro período.',
  diaFechamento:
    'Dia do mês em que o período de leitura fecha. Ex.: dia 28 → a fatura de novembro cobre de 28/10 a 27/11. Dia 1 = mês fechado.',
  franquia: 'Quantidade de páginas que a mensalidade já inclui. Só o que passar disso é cobrado à parte.',
  excedente: 'Preço de cada página impressa além da franquia.',
  minimoPorImpressora:
    'Valor mínimo que cada impressora paga no mês. Se as páginas × preço dela derem menos, ela paga o mínimo; se derem mais, paga o uso.',
  minimoPaginas: 'Quantidade mínima de páginas cobrada no mês, mesmo que o cliente imprima menos.',
  periodoAtual:
    'O que a fatura daria se fechasse hoje. Só cresce até o dia de fechamento, quando a fatura é gerada de verdade.',
  receitaEstimada:
    'Quanto desta impressora entra na fatura do período, pelo contrato. Em contratos com franquia, é uma divisão proporcional do total.',
  cobrarPeloMecanismo:
    'Cobra pelo contador do mecanismo mesmo quando a impressora informa as páginas impressas. Use só quando o contrato for pelo contador total.',
  precoCorProprio:
    'Preço da página colorida só desta impressora. Vazio = usa o preço colorido do contrato do cliente.',
  minimoProprio: 'Mínimo só desta impressora. Vazio = usa o mínimo por impressora do contrato.',
  agente:
    'Programa instalado num computador da rede do cliente que encontra as impressoras e envia as leituras para o OmniPrint.',
  codigoInstalacao:
    'Código curto que o instalador do agente pede. Ele liga aquela instalação a este cliente - não precisa copiar nenhuma chave.',
  semLeitura:
    'Impressora cobrada que não informa o contador há 3 dias ou mais (computador do agente desligado, impressora desligada ou fora da rede). Na fatura entra a última leitura que existir.',
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
