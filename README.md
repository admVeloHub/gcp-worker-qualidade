# Worker de Processamento de Áudio — VeloHub

<!-- VERSION: v1.1.0 | DATE: 2026-06-03 | AUTHOR: VeloHub Development Team -->
<!-- CHANGELOG: v1.1.0 - Gemini Enterprise + GPT RAG; schema LISTA audio_analise_results -->

Worker assíncrono para análise de qualidade de áudio em ligações do call center Velotax.

## Descrição

O worker escuta o Pub/Sub quando áudios chegam ao GCS, processa cada ligação com dois agentes de IA e persiste o resultado em `console_analises.audio_analise_results` (formato LISTA).

## Arquitetura

| Etapa | Agente | Saída |
|-------|--------|--------|
| 1 | **Gemini 3.5 Flash** (ADC, `@google/genai`, áudio `gs://`) | `transcricao[]`, `analiseDialogo` |
| 2 | **GPT + RAG** (OpenAI Responses, 2 vector stores) | `criteriosDetalhados`, `palavrasCriticas`, `observacaoGPT` |
| 3 | Worker | merge critérios manuais → `pontuacaoCalculada` → `avaliacaoIA` |

- **Pub/Sub + GCS**: inalterados
- **MongoDB**: `audio_analise_results` + `qualidade_avaliacoes`
- **Cloud Run**: serviço `worker-qualidade`

## Estrutura

```
worker-qualidade/
├── backend/
│   ├── worker/
│   │   ├── audioProcessor.js
│   │   ├── healthCheck.js
│   │   └── observatorio.js
│   ├── config/
│   │   ├── vertexAI.js      # Gemini Enterprise
│   │   └── openAIGPT.js     # GPT + file_search
│   └── models/
│       ├── AudioAnaliseResult.js
│       └── QualidadeAvaliacao.js
├── Dockerfile
├── cloudbuild.yaml
├── env.example
└── package.json
```

## Configuração

Variáveis em `env.example`. Produção: ADC para Gemini (sem `GEMINI_API_KEY` no container); `OPENAI_API_KEY` e `MONGO_ENV` via Secret Manager no Cloud Run.

## Fluxo

1. Áudio no GCS → Pub/Sub
2. Gemini: transcrição em diálogo + análise vocal (foco no agente)
3. GPT: auditoria técnica com bases pública e interna (RAG)
4. Worker copia critérios manuais da avaliação e calcula pontuação
5. Grava documento LISTA e atualiza `avaliacaoIA` / `audioTreated=done`
6. Notifica backend Skynet (SSE)

## Deploy

```bash
gcloud builds submit --config=cloudbuild.yaml
```

Repositório: [admVeloHub/gcp-worker-qualidade](https://github.com/admVeloHub/gcp-worker-qualidade)
