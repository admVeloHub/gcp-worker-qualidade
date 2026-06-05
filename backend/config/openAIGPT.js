// VERSION: v2.0.0 | DATE: 2026-06-03 | AUTHOR: VeloHub Development Team
// CHANGELOG: v2.0.0 - OpenAI Responses API + file_search (2 VS); JSON LISTA criteriosDetalhados+palavrasCriticas+observacaoGPT
const OpenAI = require('openai');
const { getSecret } = require('./secrets');

const GPT_MODEL = process.env.GPT_MODEL || 'gpt-5-mini';
const OPENAI_VECTOR_STORE_PUBLIC =
  process.env.OPENAI_VECTOR_STORE_PUBLIC || 'vs_69fe281ef0f48191a5587521c18a18c1';
const OPENAI_VECTOR_STORE_INTERNAL =
  process.env.OPENAI_VECTOR_STORE_INTERNAL || 'vs_6a0b05c7fe34819186e4f6dab9f1bf56';

let openaiClient = null;
let openaiApiKey = null;

const GPT_AGENT_SYSTEM_PROMPT = `Você é o auditor técnico de qualidade de atendimento da Velotax. Sua função é avaliar exclusivamente o desempenho do AGENTE DE ATENDIMENTO em ligações de call center, com base na transcrição fornecida.

Você NÃO avalia tom emocional, empatia percebida no áudio nem postura vocal — isso já foi analisado por outro sistema.

Antes de concluir, use file_search nas bases anexadas:
(1) Base pública — informações gerais do produto e orientações que podem ser repassadas ao cliente.
(2) Base interna — instruções de trabalho e procedimentos operacionais corretos.

Para cada afirmação do agente sobre produto, prazos, direitos, quitação, portabilidade, negociação ou procedimento, confronte com as bases. Se o agente contradisser a base pública, omitir passo obrigatório da base interna ou inventar informação, reflita em procedimentoIncorreto e/ou resolucaoQuestao conforme o caso.

Seja objetivo. Não invente fatos que não estejam na transcrição nem nas bases recuperadas.`;

const buildGptUserPrompt = (transcricaoTexto) => `TRANSCRIÇÃO DA LIGAÇÃO (fiel, diálogo Agente/Cliente):

${transcricaoTexto}

---

TAREFA:
1. Analise tecnicamente o atendimento do AGENTE usando file_search nas duas vector stores.
2. Avalie: (a) correção e clareza das informações passadas; (b) alinhamento com a orientação pública disponível ao cliente; (c) respeito ao procedimento correto das instruções de trabalho.
3. Preencha os critérios booleanos de qualidade e palavrasCriticas conforme as regras abaixo.
4. NÃO avalie registroAtendimento, naoConsultouBot nem conformidadeTicket (serão definidos fora desta análise).

CRITÉRIOS (true/false, apenas os verificáveis pela transcrição + bases):
- saudacaoAdequada, escutaAtiva, clarezaObjetividade, resolucaoQuestao, dominioAssunto, empatiaCordialidade, direcionouPesquisa, procedimentoIncorreto, encerramentoBrusco
(Regras de pontuação VeloHub aplicadas pelo worker após sua resposta — não calcule pontuacaoCalculada.)

PALAVRAS CRÍTICAS (mesma política do worker legado):
Busque na transcrição e liste em palavrasCriticas apenas o que for encontrado (array de strings; [] se nenhuma):
- "procon" (ou "PROCON")
- "bacen" (ou "BACEN" ou "Banco Central")
- "processo" quando relacionado a processo judicial ou administrativo
- "acionar na justiça", "entrar na justiça", "ir para a justiça", "processar", "processo judicial", "ação judicial", "advogado", "entrar com ação"
- "denúncia", "denunciar", "fazer denúncia", "registrar denúncia"
Inclua sinônimos equivalentes detectados. Não invente ocorrências.

observacaoGPT: parecer técnico curto em 1 a 3 frases sobre conformidade da informação, base pública e procedimento interno. Objetivo e direto; sem repetir a transcrição.

Responda exclusivamente em JSON válido:
{
  "criteriosDetalhados": {
    "saudacaoAdequada": boolean,
    "escutaAtiva": boolean,
    "clarezaObjetividade": boolean,
    "resolucaoQuestao": boolean,
    "dominioAssunto": boolean,
    "empatiaCordialidade": boolean,
    "direcionouPesquisa": boolean,
    "procedimentoIncorreto": boolean,
    "encerramentoBrusco": boolean
  },
  "palavrasCriticas": [] ou ["termo1", "termo2"],
  "observacaoGPT": "..."
}
Sem texto fora do JSON.`;

const initializeOpenAI = async () => {
  try {
    if (!openaiApiKey) {
      if (process.env.OPENAI_API_KEY) {
        openaiApiKey = process.env.OPENAI_API_KEY;
        console.log('✅ OPENAI_API_KEY encontrada em variáveis de ambiente');
      } else {
        openaiApiKey = await getSecret('OPENAI_API_KEY');
      }
    }

    if (!openaiClient && openaiApiKey) {
      openaiClient = new OpenAI({ apiKey: openaiApiKey });
    } else if (!openaiClient) {
      throw new Error('OPENAI_API_KEY deve estar configurada');
    }

    console.log('✅ OpenAI inicializado');
    return openaiClient;
  } catch (error) {
    console.error('❌ Erro ao inicializar OpenAI:', error);
    throw error;
  }
};

const parseJsonFromModelText = (text) => {
  if (!text || typeof text !== 'string') {
    throw new Error('Resposta do GPT vazia');
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_e) {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Resposta do GPT não contém JSON válido');
    }
    return JSON.parse(jsonMatch[0]);
  }
};

const extractResponseText = (response) => {
  if (response.output_text) {
    return response.output_text;
  }
  if (Array.isArray(response.output)) {
    const parts = [];
    for (const item of response.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === 'output_text' && block.text) {
            parts.push(block.text);
          }
        }
      }
    }
    if (parts.length > 0) {
      return parts.join('\n');
    }
  }
  throw new Error('Não foi possível extrair texto da resposta OpenAI');
};

/**
 * Auditoria técnica com RAG (transcrição em texto)
 * @param {string} transcricaoTexto
 * @returns {Promise<{criteriosDetalhados: object, palavrasCriticas: string[], observacaoGPT: string}>}
 */
const analyzeWithGPT = async (transcricaoTexto) => {
  if (!openaiClient) {
    await initializeOpenAI();
  }

  if (!transcricaoTexto || transcricaoTexto.trim().length === 0) {
    throw new Error('Transcrição vazia para análise GPT');
  }

  const userPrompt = buildGptUserPrompt(transcricaoTexto);

  const response = await openaiClient.responses.create({
    model: GPT_MODEL,
    instructions: GPT_AGENT_SYSTEM_PROMPT,
    input: userPrompt,
    tools: [
      {
        type: 'file_search',
        vector_store_ids: [OPENAI_VECTOR_STORE_PUBLIC, OPENAI_VECTOR_STORE_INTERNAL]
      }
    ],
    text: {
      format: { type: 'json_object' }
    }
  });

  const analysisText = extractResponseText(response);
  const analysis = parseJsonFromModelText(analysisText);

  const criteriosDetalhados = analysis.criteriosDetalhados || {};
  const palavrasCriticas = Array.isArray(analysis.palavrasCriticas) ? analysis.palavrasCriticas : [];
  const observacaoGPT =
    typeof analysis.observacaoGPT === 'string' ? analysis.observacaoGPT.trim() : '';

  console.log('✅ Análise GPT (RAG) concluída');

  return {
    criteriosDetalhados,
    palavrasCriticas,
    observacaoGPT
  };
};

module.exports = {
  initializeOpenAI,
  analyzeWithGPT,
  buildGptUserPrompt,
  GPT_AGENT_SYSTEM_PROMPT
};
