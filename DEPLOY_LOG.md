# DEPLOY LOG - Worker de Qualidade de Áudio

## GitHub Push — loop de fila ativa + drenagem backlog (sem observatório/Scheduler) — 2026-06-02

**Data/Hora:** 2026-06-02  
**Tipo:** Push GitHub  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  

### Descrição:
Fila parada dias e processada ao abrir observatório: o sweep/retry existia mas o processo no Cloud Run não executava timers nem pull Pub/Sub sem CPU (throttling). Correção em código: loop interno até zerar pendentes, processamento direto no sweep, drenagem no arranque; deploy alvo `worker-qualidade` com `min-instances 1` e `no-cpu-throttling`.

**Arquivos modificados:**
- `backend/worker/audioProcessor.js` (v3.9.0) — `signalPendingWork`, `ensurePendingWorkLoop`, `drainBacklogOnReady`
- `backend/worker/audioAutoRetrySweep.js` (v1.3.0) — `BACKLOG_IMMEDIATE`, processamento direto, `onPendingWork`
- `cloudbuild.yaml` (v1.4.0) — `gcloud run deploy worker-qualidade`
- `env.example` (v1.2.2)
- `DEPLOY_LOG.md`

**Impacto:**
- Worker processa backlog no arranque e mantém ciclo a cada 15s enquanto houver pendente; não depende de abrir `/observatorio` nem Cloud Scheduler

---

## GitHub Push — auto-retry autônomo (Cloud Run min-instances + no-cpu-throttling) — 2026-06-02

**Data/Hora:** 2026-06-02  
**Tipo:** Push GitHub  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  

### Descrição:
Correção do auto-retry que só executava com o observatório aberto: o sweep e o listener Pub/Sub dependiam de CPU alocada por requisições HTTP no Cloud Run (`min-instances 0` + CPU throttling). Worker passa a rodar sweep e retries em background sem browser.

**Arquivos modificados:**
- `cloudbuild.yaml` (v1.3.0) — `--min-instances 1` e `--no-cpu-throttling` para tarefas assíncronas
- `backend/worker/audioAutoRetrySweep.js` (v1.1.0) — tick imediato ao iniciar o sweep
- `backend/worker/audioProcessor.js` (v3.7.4) — arranque robusto do sweep; logs de dependências Mongo/PubSub
- `DEPLOY_LOG.md`

**Impacto:**
- Auto-retry e processamento Pub/Sub continuam com observatório fechado; deploy Cloud Run necessário para aplicar flags de infra

---

## Reescrita de histórico Git (URIs Mongo nos blobs) — 2026-04-23

**Data/Hora:** 2026-04-23  
**Tipo:** Manutenção repositório / segurança (histórico)  
**Ferramenta:** `py -m git_filter_repo --replace-text` (URIs Mongo → `REDACTED_*`)  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  
**Commit:** *(tip `main` = último em `origin/main`; `git log -1` após sincronizar)*  

### Descrição:
`git push --force --all` e `git push --force --tags` após filter-repo; tag `checkpoint-before-gpt` reenviada com novo objeto.

---

## Push GitHub — segurança Cloud Build / secrets — 2026-04-23

**Data/Hora:** 2026-04-23  
**Tipo:** Push GitHub  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  
**Commit (código, SHA após reescrita):** ca7c11e  

### Descrição:
`loadFonteVerdadeEnv` alinhado ao SKYNET; `cloudbuild.yaml` com `--update-secrets` para `MONGO_ENV` e `OPENAI_API_KEY`; env não sensível via `--update-env-vars`; `.gitignore` com `node_modules/`, `.env`, `.vscode/`.

**Arquivos modificados:**
- `.gitignore` (novo)
- `backend/config/loadFonteVerdadeEnv.js` (novo)
- `backend/worker/audioProcessor.js`
- `backend/models/QualidadeAvaliacao.js`
- `cloudbuild.yaml`
- `DEPLOY_LOG.md`

---

## GitHub Push — fila observatório alinhada ao done, retries TLS, BACKEND_API_URL Skynet — 2026-04-09

**Data/Hora:** 2026-04-09  
**Tipo:** GitHub Push  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  

### Descrição:
Correção da fila do observatório (entradas `scheduled` fantasma após `audioTreated: done`); classificação ampliada de erros recuperáveis (TLS/gRPC) para `nack`; documentação de `BACKEND_API_URL` como base URL do Skynet sem `/api`.

**Arquivos modificados:**
- `backend/worker/audioProcessor.js` (v3.7.1) — `removeAutoRetryQueueForAvaliacao` após sucesso; `isRecoverableError` com padrões ssl/tls/deadline/etc.; comentário da origem Skynet para notificações
- `env.example` (v1.2.1) — `BACKEND_API_URL` documentada; exemplo Cloud Run do backend Skynet
- `backend/worker/observatorio.js` — título da secção de logs alterado para «Log de Atividades»

**Impacto:**
- Painel «Fila» coerente com Mongo/portal após processamento; menos dependência só do sweep para falhas transitórias de API Google; deploy Cloud Run deve definir `BACKEND_API_URL` para o host Skynet

---

## GitHub Push — observatório UI (painel duplo, fila unificada, log path) — 2026-04-08

**Data/Hora:** 2026-04-08  
**Tipo:** GitHub Push  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  

### Descrição:
Melhorias no painel `/observatorio` e diagnóstico de arranque:

**Arquivos modificados:**
- `backend/worker/observatorio.js` — Dois subpainéis lado a lado (métricas e conexões), largura ao conteúdo, sem títulos internos; secção **Fila** única (processamento + itens em auto-retry com texto amarelo e sufixo `(MMm - n/3)`); removido bloco “Histórico de Mensagens”; cabeçalho HTML sem semver incremental (release worker v2.0.0 quando aprovado)
- `backend/worker/audioProcessor.js` — Log ao carregar módulo com caminho absoluto de `./observatorio` (`require.resolve`) para evitar confusão entre cópias do projeto

**Impacto:**
- Observatório mais compacto e alinhado à política de retry; facilita confirmar qual ficheiro de dashboard está em uso ao subir o processo

---

## GitHub Push — auto-retry áudio IA (pending/done/failed), sweep Pub/Sub, observatório — 2026-04-08

**Data/Hora:** 2026-04-08  
**Tipo:** GitHub Push  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  

### Descrição:
Pipeline de tratamento de áudio com estados explícitos, retry autónomo sem browser e painel de fila:

**Arquivos modificados ou adicionados:**
- `backend/models/QualidadeAvaliacao.js` (v1.2.0) — `audioTreated` como Mixed (strings `pending`|`done`|`failed` e legado boolean); `audioAutoRepublishAttempts`, `audioLastAutoRepublishAt`, `audioManualReenvioDisponivelEm`
- `backend/worker/audioAutoRetrySweep.js` (v1.0.0) — sweep ~60s; republicação Pub/Sub; após 3 tentativas com tick seguinte ainda pendente → `failed` e desbloqueio manual (+15 min)
- `backend/worker/audioProcessor.js` (v3.7.0) — sucesso → `audioTreated: 'done'`; integração com fila de auto-retry; logs/histórico com unbuffer newest-first
- `backend/worker/observatorio.js` (v1.2.0) — secção fila auto-retry (amarelo + timer); alinhamento de exibição de logs/histórico

**Impacto:**
- Worker pode recuperar mensagens pendentes sem reenvio manual até política de retries; falhas transitórias documentadas no observatório; compatível com documentos legado `audioTreated: false` onde aplicável

---

## GitHub Push - GPT opcional, buffer de logs 50 linhas, observatório - 2026-03-23

**Data/Hora:** 2026-03-23  
**Tipo:** GitHub Push  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  
**Commit:** 8ef634d  

### Descrição:
Ajustes de comportamento e documentação do worker de processamento de áudio:

**Arquivos modificados:**
- `backend/worker/audioProcessor.js` (v3.6.0) — `ENABLE_GPT_ANALYSIS` só ativa GPT quando `=true` (padrão desligado); buffer de logs recentes reduzido para 50 linhas (alinhado ao observatório)
- `backend/worker/observatorio.js` (v1.1.0) — API `/observatorio/data` retorna até 50 logs; UI exibe mais recentes primeiro
- `env.example` (v1.2.0) — Documentação e exemplo `ENABLE_GPT_ANALYSIS=false` alinhados ao padrão off

**Impacto:**
- Ambientes sem variável explícita deixam de enviar análise para OpenAI até configurar `ENABLE_GPT_ANALYSIS=true`
- Painel do observatório coerente com o buffer do worker

---

## GitHub Push - 2025-03-03

**Data/Hora:** 2025-03-03  
**Tipo:** GitHub Push  
**Versão:** Atualizações nos modelos e configurações  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  
**Commit:** 5af4f6e  

### Descrição:
Atualizações nos modelos e configurações do worker de processamento de áudio:

**Arquivos Modificados:**
- `backend/models/AudioAnaliseResult.js` - Atualizações no modelo
- `backend/models/QualidadeAvaliacao.js` - Atualizações no modelo
- `backend/config/openAIGPT.js` - Atualizações de configuração
- `backend/config/vertexAI.js` - Atualizações de configuração
- `backend/worker/audioProcessor.js` - Melhorias no processamento
- `package.json` e `package-lock.json` - Atualizações de dependências

**Impacto:**
- ✅ Modelos atualizados para compatibilidade com backend
- ✅ Configurações ajustadas para melhor funcionamento

---
