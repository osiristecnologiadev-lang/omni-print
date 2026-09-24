# OmniPrint Agent

Agente on-premise que roda na rede do cliente, coleta métricas de impressoras
via SNMP (Printer-MIB, RFC 3805) e envia para a API do OmniPrint.

## Requisitos

- Go 1.22+ (não detectado neste ambiente - instale antes de compilar)
- Opcional, para embutir metadados de versão no `.exe`:
  `go install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest`
- Opcional, para gerar o instalador Windows: [Inno Setup 6](https://jrsoftware.org/isdl.php)
  (`iscc` precisa estar no PATH)
- Opcional, para assinar os binários: `signtool` (vem com o Windows SDK) +
  um certificado de code signing - ver "Assinatura de código" abaixo

## Build

```
cd agent
go mod tidy      # resolve as dependências (gosnmp, kardianos/service, yaml.v3, x/sys)

# Windows - também gera dist/OmniPrintAgentSetup-<versão>.exe se o Inno
# Setup estiver instalado, e assina ambos se CODE_SIGN_CERT_THUMBPRINT
# estiver setado (ver "Assinatura de código")
./build/build.ps1

# Linux
./build/build.sh
```

O binário sai em `dist/`.

## Configuração

```
cp config.example.yaml config.yaml
```

Edite `tenant_id`, `agent_token`, `cloud_url`. Impressoras podem ser listadas
explicitamente em `devices`, encontradas automaticamente via `discovery`
(ver seção abaixo), ou os dois juntos.

## Instalar

**Windows, via instalador (recomendado para clientes reais)**: rode
`OmniPrintAgentSetup-<versão>.exe` (gerado pelo `build.ps1`, ver "Build"
acima). O wizard pede Tenant ID, token do agente e a URL da API, escreve o
`config.yaml` sozinho (com `discovery.enabled: true` e `auto_update.enabled:
true` por padrão) e já registra/inicia o serviço Windows. Precisa rodar como
administrador (instalar um serviço exige isso). O desinstalador para e
remove o serviço antes de apagar os arquivos.

**Manual (qualquer plataforma, ou para testar)**:

```
cp config.example.yaml config.yaml   # edite tenant_id/agent_token/cloud_url
omniprint-agent.exe -config config.yaml install
omniprint-agent.exe -config config.yaml start
```

Outras ações: `stop`, `uninstall`. Sem uma dessas ações, o binário roda em
primeiro plano (útil para testar).

## Atualização automática

Um agente já instalado se atualiza sozinho por padrão: a cada
`auto_update.check_interval` (padrão 6h) ele consulta a API por uma versão
mais nova, baixa, confere o SHA-256 contra o que a API informou e aplica -
sem precisar reinstalar manualmente em cada cliente. Publicar uma nova
versão é uma ação de operador OmniPrint (`/v1/platform/agent-releases`, ver
`api/`), não algo que o tenant faz.

- `auto_update.enabled: false` no `config.yaml` desliga a auto-aplicação
  **não-obrigatória** - o agente continua checando (isso também é o sinal de
  "última versão vista" que aparece no painel de operador), só não baixa/
  aplica sozinho. Uma release marcada `mandatory` (ex: correção de
  segurança) é aplicada mesmo assim.
- O binário baixado só é aplicado depois de bater o SHA-256 esperado -
  qualquer divergência (corrupção de rede, download incompleto) descarta o
  download. Isso **não substitui** verificação de assinatura Authenticode -
  ver "Assinatura de código" abaixo para o que ainda falta.
- **Como funciona por baixo dos panos** (`internal/updater/`): no Linux, o
  processo troca o próprio binário no lugar (o SO permite substituir um
  executável em uso) e reinicia o serviço via `systemctl`/kardianos. No
  Windows, que não deixa sobrescrever/apagar o próprio `.exe` em execução, o
  agente baixa a nova versão, sobe ela mesma como um processo "helper"
  desanexado com uma flag interna (`-apply-update`), e para o serviço via
  SCM - o helper espera o processo antigo encerrar de verdade, renomeia os
  arquivos (renomear o próprio `.exe` em execução é permitido no Windows,
  mesmo sem poder sobrescrevê-lo) e reinicia o serviço.
- **Ainda não validado contra um serviço Windows real instalado** - só
  compilado/testado em unidade nesta sessão (ver
  `internal/updater/updater_test.go`). Antes de confiar nisso em qualquer
  cliente real: instale o agente via installer numa máquina Windows de
  teste, publique uma versão fake mais nova pelo painel de operador,
  encurte temporariamente `check_interval` e confirme que o serviço
  instalado realmente termina rodando o binário novo.

## Dados coletados

Por dispositivo, a cada ciclo:

- **Identidade**: nome do sistema, nome/local/contato configurados, nome do
  produto, número de série, uptime
- **Status**: status do dispositivo e da impressora (idle/imprimindo/etc.),
  e todas as 15 flags de erro do `hrPrinterDetectedErrorState` (papel
  atolado, porta aberta, sem toner, bandeja faltando, manutenção atrasada...)
- **Contadores**: total de páginas impressas, horas ligado
- **Suprimentos**: cada toner/cartucho/drum/grampos com nível atual, nível
  máximo, classe (consumível vs. reservatório de resíduo) e cor (quando o
  dispositivo expõe a tabela de colorantes)
- **Bandejas de papel**: nome, mídia carregada, status, capacidade e nível
- **Alertas ativos**: tabela `prtAlertTable` (severidade, código, descrição)
  — captura problemas em tempo real, não só o snapshot de contadores
- **Raw** (opcional, ligado por padrão via `full_raw_capture`): todos os OIDs
  da subárvore Printer-MIB (`1.3.6.1.2.1.43`), sem filtro — funciona como
  rede de segurança para nada ficar de fora, mesmo campos que o parser
  estruturado acima não reconhece (extensões de fabricante, por exemplo).

**Aviso de precisão**: os mapeamentos de enum (status, classe de suprimento,
severidade de alerta, bits de erro) seguem a RFC 3805. Ao testar contra
hardware real, compare o campo `raw` com os campos estruturados pra
confirmar/corrigir qualquer coisa.

### Validado contra hardware real

Testado contra uma Samsung M4080FX real na rede (via `cmd/probe`):

- Identidade, uptime, status (idle/printing), contador de páginas e nível de
  toner confirmados corretos — o contador de páginas e o nível de toner
  mudaram entre duas consultas porque o equipamento realmente imprimiu algo
  no meio do teste.
- `console_display` bateu com o texto do painel físico ("Imprimindo").
- Achado: campos inteiros negativos (`-1`, `-2`) em vários lugares (ex.
  `power_on_count`, capacidade de mídia) são valores legítimos do
  Printer-MIB — `-1` = desconhecido, `-2` = não suportado por este
  equipamento. Não é erro de parsing.
- `supplies[].colorant` ficou vazio nesse teste porque o equipamento é
  monocromático (só toner preto) — sem ambiguidade de cor pra resolver, o
  firmware simplesmente não preenche o link `prtMarkerSuppliesColorantIndex`.
  Em impressoras coloridas isso deve vir populado; ainda não testamos uma pra
  confirmar.
- Ainda não validado: a tabela de alertas (`prtAlertTable`) — o equipamento
  testado não tinha nenhum alerta ativo no momento do teste.

### Utilitário de diagnóstico (`probe`)

```
go build -o dist/probe.exe ./cmd/probe
./dist/probe -host 192.168.1.50 -community public
```

Consulta um único dispositivo e imprime o `Metric` coletado em JSON — use pra
testar conectividade/community string antes de adicionar um device ao
`config.yaml`, ou pra comparar os campos estruturados com `raw` num
equipamento novo. Flags: `-port`, `-raw=false` (desliga a captura bruta),
`-timeout`.

## Descoberta automática de impressoras

Em vez de digitar o IP de cada impressora, ative `discovery` no
`config.yaml`:

```yaml
discovery:
  enabled: true
  # ranges: ["192.168.48.0/22"]   # opcional - se omitido, detecta sozinho
  #                                 a(s) sub-rede(s) das interfaces de rede
  #                                 reais da máquina onde o agente roda
  interval: 24h
  concurrency: 8
  probe_timeout: 800ms
```

Como funciona:

- **Sem `ranges` configurado**, o agente lê as próprias interfaces de rede da
  máquina onde está instalado e varre a(s) sub-rede(s) reais delas (a máscara
  de sub-rede de verdade, não um `/24` chutado) — ignora interfaces virtuais
  (Hyper-V, WSL, Docker, VPN), loopback e endereços link-local. Sub-redes
  maiores que `/20` (mais de ~4096 endereços) são ignoradas automaticamente
  nessa detecção — se você precisa varrer algo maior, configure `ranges`
  explicitamente (aí sim é decisão consciente do admin, sem limite).
- **Em servidor de impressão Windows**, o agente também lê as portas de
  impressora de rede já cadastradas no Windows (registro,
  `Control\Print\Monitors\*\Ports` — Standard TCP/IP, HP, LPR) e testa cada
  IP, **em qualquer sub-rede/VLAN**, sem precisar configurar `ranges`. Se a
  porta tem community SNMP própria, ela é usada no lugar da padrão.
- Cada host candidato recebe uma consulta SNMP leve testando se ele
  implementa a Printer-MIB — switch, roteador, nobreak com SNMP habilitado
  não respondem a isso, só impressoras de verdade respondem.
- Roda uma vez ao iniciar e depois a cada `interval` (padrão 24h) — não é
  contínuo, não é a cada ciclo de coleta (30min).
- Impressora nova encontrada entra direto no polling e fica registrada em
  `discovered.yaml` (ao lado do `config.yaml`), pra sobreviver a um restart
  sem precisar re-descobrir.

**Validado nesta sessão**: rodei contra a sub-rede real (`192.168.49.7/22`,
detectada automaticamente a partir da interface Wi-Fi, 1022 hosts) e o agente
encontrou 3 impressoras sozinho, sem eu informar nenhum IP. Achado no
processo: a primeira varredura (sem retry) **perdeu** a impressora
`192.168.48.158` que já sabíamos existir — ela respondeu normalmente a uma
consulta direta logo depois. SNMP roda sobre UDP, que não garante entrega, e
sob carga concorrente (12 workers simultâneos) um pacote se perdeu. Corrigido
adicionando 1 retry por host na varredura. Mesmo assim, **uma varredura
isolada não é garantia de inventário completo** — é por isso que ela roda
periodicamente (`interval`, padrão 24h) em vez de uma vez só.

## Sobre antivírus/EDR barrando o agente

Um executável compilado que roda em background e fala com muitos hosts na
rede tem o mesmo "formato" comportamental de malware aos olhos de engines
heurísticas. A descoberta automática reintroduz parte desse risco — a
diferença que importa é **escopo e transparência**, não "nunca varrer nada":

- **Escopo limitado por padrão**: só a(s) sub-rede(s) real(is) da própria
  máquina onde o agente está instalado, nunca uma faixa arbitrária — e capado
  em `/20` na detecção automática. Faixas maiores exigem configuração
  explícita do admin.
- **Não é contínuo**: roda 1x ao iniciar e depois no intervalo configurado
  (padrão 24h), não a cada poll (30min).
- **Throttling** (concorrência limitada + pausa entre requisições) tanto na
  descoberta quanto no polling normal — evita o padrão de rajada que
  IDS/EDR associam a port scan.
- **Teste específico de impressora**, não "responde SNMP" genérico — reduz
  o número de hosts tocados a quem realmente importa.
- **Sem packer/UPX, sem strip agressivo de símbolos** — binário "cru" do Go,
  sem os padrões que packers/malware costumam ter.
- **Metadados de versão embutidos** (empresa, descrição, versão) via
  `goversioninfo` — executável sem esses metadados parece mais suspeito.
- **Registrado como serviço via API oficial do SO** (kardianos/service), com
  nome/descrição claros — nada de persistência via truques de registro.
- **Logs locais em texto plano**, sem ofuscação.

Para o TI do cliente liberar o agente no antivírus/firewall corporativo, ele
vai precisar saber:

- Caminho do executável instalado: `C:\Program Files\OmniPrint\Agent\omniprint-agent.exe`
  (`{autopf}\OmniPrint\Agent`, gerado pelo instalador)
- Nome do serviço instalado: `OmniPrintAgent`
- Porta de saída UDP 161 (SNMP, para as impressoras configuradas)
- Porta de saída TCP 443 (HTTPS, para `cloud_url`)

Depois de assinar os binários com um certificado de code signing, inclua o
hash/thumbprint do certificado nessa lista.

### Caso real confirmado: FortiClient

Testado e confirmado em 2026-09-08: com o **FortiClient VPN** instalado e
seus serviços em execução (`FA_Scheduler` e afins), o agente rodando como
serviço Windows (`LocalSystem`) trava indefinidamente durante a descoberta
automática — nem uma varredura de 6 hosts termina em minutos, embora o
mesmo binário rodando em primeiro plano (sessão interativa do usuário)
funcione normalmente. Fechando o FortiClient, a mesma varredura de 510 hosts
completou em ~104s, idêntico ao tempo esperado — confirma que o driver de
rede do FortiClient (que fica carregado mesmo sem uma sessão VPN ativa) é a
causa, não um bug do agente.

Isso importa porque um cliente real vai ter o agente instalado numa máquina
com antivírus/EDR corporativo (FortiClient ou equivalente) rodando o tempo
todo - não dá pra depender de "peça pro cliente fechar o antivírus da
empresa dele". Até ter o executável assinado (ver "Assinatura de código"
abaixo, a mitigação mais efetiva pra esse tipo de bloqueio), se a descoberta
automática travar num cliente:

1. Confirme que é isso mesmo: veja se `omniprint-agent.log` para de progredir
   logo após `discovery: scanning ...` (varredura completa) sem nunca listar
   nenhuma impressora encontrada, mesmo em redes onde se sabe que existem
   impressoras respondendo.
2. Peça ao TI do cliente pra abrir o console do EDR/antivírus da empresa
   (FortiClient EMS, ou equivalente de CrowdStrike/SentinelOne/outro) e
   adicionar uma exceção pelo caminho do executável e/ou nome do serviço
   acima - isso normalmente é feito de forma centralizada pela política do
   EDR, não localmente em cada máquina.
3. Como contorno temporário enquanto a exceção não é aplicada: desabilitar
   `discovery.enabled` no `config.yaml` e listar os IPs das impressoras
   manualmente em `devices` continua funcionando normalmente (coleta e
   envio de métricas não dependem da varredura automática).

## Assinatura de código

A única peça deste item que **não** dá pra resolver só em código: precisa
comprar um certificado de code signing de uma autoridade certificadora.
Isso não foi feito ainda - o que já está pronto é o lado do build
(`build.ps1` chama `signtool` automaticamente se `CODE_SIGN_CERT_THUMBPRINT`
estiver setado, tanto no `.exe` quanto no instalador), só falta o
certificado em si.

O que comprar, na prática:

- **OV (Organization Validation)** - mais barato (~US$70-250/ano em
  fornecedores como Certum, SSL.com, DigiCert), mas o SmartScreen do Windows
  só passa a confiar automaticamente depois de um volume razoável de
  downloads/execuções acumulados sob esse certificado - nos primeiros dias/
  semanas ainda pode aparecer o aviso "Windows protegeu seu PC".
- **EV (Extended Validation)** - mais caro, exige mais burocracia de
  verificação da empresa (e geralmente um token de hardware/HSM para
  guardar a chave), mas o SmartScreen confia de imediato, sem período de
  "aquecimento".

Pra um produto ainda em fase de poucos clientes, OV é o ponto de partida
mais razoável - dá pra migrar para EV depois se o aviso do SmartScreen virar
um problema real de adoção. Depois de comprar:

1. Instale o certificado no repositório de certificados do Windows (ou
   configure o token HSM, no caso de EV).
2. Pegue o thumbprint (`certutil -store My` ou o Gerenciador de
   Certificados).
3. Sete `$env:CODE_SIGN_CERT_THUMBPRINT` antes de rodar `build.ps1` -
   `signtool` assina o `.exe` e o instalador automaticamente.
4. Inclua o thumbprint na lista que o TI do cliente recebe (seção acima).

## Estrutura

```
cmd/agent/          ponto de entrada (CLI + wiring)
internal/config/    carregamento e validação do config.yaml
internal/collector/ polling SNMP (Printer-MIB)
internal/transport/ envio HTTPS pra API do OmniPrint, com retry/backoff
internal/svc/       wrapper de serviço (Windows Service / systemd)
internal/updater/   checagem/aplicação de atualização automática
build/               scripts de build, assinatura e metadados de versão do Windows
installer/          script do instalador Windows (Inno Setup)
```
