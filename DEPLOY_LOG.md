# DEPLOY LOG - Worker de Qualidade de Áudio

## GitHub Push - GPT opcional, buffer de logs 50 linhas, observatório - 2026-03-23

**Data/Hora:** 2026-03-23  
**Tipo:** GitHub Push  
**Repositório:** admVeloHub/gcp-worker-qualidade  
**Branch:** main  
**Commit:** PLACEHOLDER_COMMIT_HASH  

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
