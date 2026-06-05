# Impacto no portal / Console — migração agentes IA

<!-- VERSION: v1.0.0 | DATE: 2026-06-03 | AUTHOR: VeloHub Development Team -->

Documento de inventário (fora do escopo deste worker). **Não alterar portal nesta entrega.**

## Campos removidos em `audio_analise_results`

| Campo legado | Substituto LISTA |
|--------------|------------------|
| `transcription` (string) | `transcricao[]` com `{ role, fala }` |
| `emotion`, `nuance` | `analiseDialogo` (Gemini) |
| `qualityAnalysis` | `criteriosDetalhados`, `pontuacaoCalculada`, `palavrasCriticas` |
| `gptAnalysis` | `observacaoGPT` + critérios GPT no bloco único |
| `pontuacaoConsensual` | `pontuacaoCalculada` |
| `avaliacaoMonitorId` | `avaliacao_id` |
| `nomeArquivo` | `nomeArquivoAudio` |
| `analiseCompleta` | removido |
| `gcsUri`, `processingTime` | não fazem parte do schema LISTA v4.36 |

## Leitores a revisar (tarefa separada com autorização)

- Telas de detalhe de avaliação de qualidade que exibem transcrição ou nota IA
- APIs do Backend-GCP que serializam `audio_analise_results` para o Console
- Relatórios/exportações que usam `qualityAnalysis.criterios`

## Inalterado

- `qualidade_avaliacoes.avaliacaoIA` — continua atualizado com `pontuacaoCalculada`
- Pub/Sub, GCS, fluxo `audioTreated`
