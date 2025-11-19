# ⚙️ Worker de Processamento de Áudio - VeloHub

<!-- VERSION: v1.0.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team -->

Worker assíncrono para processamento de análise de qualidade de áudio usando Vertex AI (Speech-to-Text + Gemini).

## 📋 Descrição

Este worker escuta mensagens do Pub/Sub quando arquivos de áudio são enviados para o GCS, processa os áudios usando Vertex AI e salva os resultados no MongoDB.

## 🏗️ Arquitetura

- **Pub/Sub**: Recebe notificações quando arquivos são enviados ao GCS
- **Vertex AI Speech-to-Text**: Transcreve áudio com timestamps
- **Gemini AI**: Analisa emoção, nuance e qualidade do atendimento
- **MongoDB**: Armazena resultados da análise
- **Cloud Run**: Hospeda o worker como serviço serverless

## 📁 Estrutura

```
worker-qualidade/
├── backend/
│   ├── worker/
│   │   └── audioProcessor.js    # Worker principal
│   ├── config/
│   │   └── vertexAI.js          # Configuração Vertex AI
│   └── models/
│       ├── AudioAnaliseStatus.js
│       └── AudioAnaliseResult.js
├── scripts/
│   └── setup-gcs-notification.ps1
├── Dockerfile
├── cloudbuild.yaml
├── package.json
└── env.example
```

## 🚀 Deploy

### Pré-requisitos

1. Google Cloud Project configurado
2. Pub/Sub topic e subscription criados
3. GCS bucket configurado com notificação para Pub/Sub
4. Service Account com permissões adequadas

### Deploy via Cloud Build

```bash
gcloud builds submit --config=cloudbuild.yaml
```

## 🔧 Configuração

Copie `env.example` para `.env` e configure as variáveis:

- `MONGODB_URI`: URI de conexão MongoDB
- `GCP_PROJECT_ID`: ID do projeto GCP
- `GCS_BUCKET_NAME`: Nome do bucket GCS
- `PUBSUB_SUBSCRIPTION_NAME`: Nome da subscription Pub/Sub
- `GEMINI_API_KEY`: Chave da API Gemini
- `BACKEND_API_URL`: URL do backend API para notificações

## 📝 Fluxo de Processamento

1. Arquivo enviado ao GCS → Notificação Pub/Sub
2. Worker recebe mensagem do Pub/Sub
3. Worker busca registro no MongoDB
4. Worker transcreve áudio (Speech-to-Text)
5. Worker analisa emoção/nuance (Gemini)
6. Worker cruza outputs e calcula qualidade
7. Worker salva resultado no MongoDB
8. Worker atualiza status (treated=true)
9. Worker notifica backend API (dispara SSE)

## 🔗 Links

- **Repositório:** [https://github.com/admVeloHub/gcp-worker-qualidade](https://github.com/admVeloHub/gcp-worker-qualidade)
- **Backend API:** [https://github.com/admVeloHub/Backend-GCP](https://github.com/admVeloHub/Backend-GCP)

