// VERSION: v2.1.0 | DATE: 2026-06-05 | AUTHOR: VeloHub Development Team
// CHANGELOG: v2.1.0 - Timeout configurável GEMINI_AUDIO_TIMEOUT_MS (default 10 min) para ligações longas
// CHANGELOG: v2.0.0 - Gemini Enterprise @google/genai ADC; transcricao+analiseDialogo via gs://; remove Speech/Vertex SDK legado
const { GoogleGenAI } = require('@google/genai');

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_LOCATION || 'global';
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || 'gemini-3.5-flash';
const GEMINI_AUDIO_TIMEOUT_MS = parseInt(process.env.GEMINI_AUDIO_TIMEOUT_MS || '600000', 10);

let genAIClient;

const withTimeout = async (promise, ms, label) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} excedeu timeout de ${Math.round(ms / 1000)}s`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
};

const GEMINI_AGENT_PROMPT = `Gere uma transcrição do áudio. Extraia apenas a fala e ignore os ruídos ambientes. O arquivo de áudio fornecido contém uma ligação telefônica ocorrida em nosso call center de atendimento ao cliente do Velotax. Eu preciso da transcrição dessa ligação em forma de diálogo, com agente de atendimento e cliente identificados. A conversa acontece em portugues do Brasil e deve ser mantida dessa forma. Palavrões, insultos, gírias e outros desvios da forma educada ou esperada de relacionamento deverão ser conservados e transcritos sem censura ou substituição para que haja conhecimento desses desvios em suas ocorrências. A transcrição deve se manter extremamente fiel ao diálogo ocorrido.

Após a transcrição você deverá fornecer uma análise da temperatura, tensão, inflexões vocais e demais percepções possíveis de inferir a partir do áudio. Para cada categoria atribua uma nota de 0 a 10, e uma classificação (como por exemplo "Fria", "Confusa", "Agressiva", "Empática", "Interessada", "Empenhado", "Tranquilo" e outras avaliações cabíveis a cada caso. Não devem haver análises separadas para cliente e agente. O foco da avaliação é o/a agente de atendimento, e observações sobre o cliente podem ser inseridos na mesma avaliação daquela categoria conforme relevância e impacto na interação.

Responda exclusivamente em JSON válido, sem texto fora do JSON, contendo somente as chaves transcricao e analiseDialogo. Não inclua critérios de qualidade de atendimento, pontuação VeloHub, palavras-chave críticas nem qualquer outro campo — isso será tratado por outro agente.

Estrutura obrigatória:
- transcricao: array de objetos, cada um com role ("Agente" ou "Cliente") e fala (string com a fala transcrita fiel).
- analiseDialogo: objeto com temperatura, tensao, comportamentoVocal (cada um com nota 0-10, classificacao, avaliacao) e consideracoes (apenas classificacao e avaliacao, sem nota).`;

const categoriaComNotaSchema = {
  type: 'object',
  properties: {
    nota: { type: 'number' },
    classificacao: { type: 'string' },
    avaliacao: { type: 'string' }
  },
  required: ['nota', 'classificacao', 'avaliacao']
};

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    transcricao: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          fala: { type: 'string' }
        },
        required: ['role', 'fala']
      }
    },
    analiseDialogo: {
      type: 'object',
      properties: {
        temperatura: categoriaComNotaSchema,
        tensao: categoriaComNotaSchema,
        comportamentoVocal: categoriaComNotaSchema,
        consideracoes: {
          type: 'object',
          properties: {
            classificacao: { type: 'string' },
            avaliacao: { type: 'string' }
          },
          required: ['classificacao', 'avaliacao']
        }
      },
      required: ['temperatura', 'tensao', 'comportamentoVocal', 'consideracoes']
    }
  },
  required: ['transcricao', 'analiseDialogo']
};

/**
 * MIME type do áudio a partir da extensão do arquivo
 */
const detectAudioMimeType = (fileName) => {
  const extension = (fileName || '').toLowerCase().split('.').pop();
  switch (extension) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    case 'm4a':
      return 'audio/mp4';
    default:
      console.warn(`⚠️  Formato de áudio não reconhecido (${extension}), usando audio/mpeg`);
      return 'audio/mpeg';
  }
};

/**
 * Inicializar cliente Gemini Enterprise (ADC)
 */
const initializeVertexAI = async () => {
  try {
    if (!GCP_PROJECT_ID) {
      throw new Error('GCP_PROJECT_ID deve estar configurado nas variáveis de ambiente');
    }

    if (!genAIClient) {
      genAIClient = new GoogleGenAI({
        vertexai: true,
        project: GCP_PROJECT_ID,
        location: GOOGLE_CLOUD_LOCATION
      });
      console.log(
        `✅ Gemini Enterprise inicializado (Project: ${GCP_PROJECT_ID}, Location: ${GOOGLE_CLOUD_LOCATION}, Model: ${GEMINI_MODEL_ID})`
      );
    }

    return { genAI: genAIClient };
  } catch (error) {
    console.error('❌ Erro ao inicializar Gemini:', error);
    throw error;
  }
};

const parseJsonFromModelText = (text) => {
  if (!text || typeof text !== 'string') {
    throw new Error('Resposta do Gemini vazia');
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_e) {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Resposta do Gemini não contém JSON válido');
    }
    return JSON.parse(jsonMatch[0]);
  }
};

/**
 * Análise multimodal do áudio no GCS — transcricao + analiseDialogo
 */
const runGeminiAudioAnalysis = async (gcsUri, fileName) => {
  if (!genAIClient) {
    await initializeVertexAI();
  }

  const mimeType = detectAudioMimeType(fileName);

  console.log(`🎵 Gemini: analisando áudio ${gcsUri} (${mimeType})`);

  const response = await withTimeout(
    genAIClient.models.generateContent({
      model: GEMINI_MODEL_ID,
      contents: [
        {
          role: 'user',
          parts: [
            { text: GEMINI_AGENT_PROMPT },
            { fileData: { fileUri: gcsUri, mimeType } }
          ]
        }
      ],
      config: {
        maxOutputTokens: 65535,
        temperature: 1,
        topP: 0.95,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA
      }
    }),
    GEMINI_AUDIO_TIMEOUT_MS,
    'Gemini generateContent'
  );

  const text = response.text;
  const parsed = parseJsonFromModelText(text);

  if (!Array.isArray(parsed.transcricao) || parsed.transcricao.length === 0) {
    throw new Error('Gemini retornou transcricao vazia ou inválida');
  }
  if (!parsed.analiseDialogo) {
    throw new Error('Gemini retornou analiseDialogo ausente');
  }

  console.log(`✅ Gemini: ${parsed.transcricao.length} turnos de diálogo`);

  return {
    transcricao: parsed.transcricao,
    analiseDialogo: parsed.analiseDialogo
  };
};

/**
 * Monta texto de diálogo para o agente GPT
 */
const formatTranscricaoParaTexto = (transcricao) => {
  if (!Array.isArray(transcricao)) {
    return '';
  }
  return transcricao
    .map((turno) => {
      const role = turno.role || 'Desconhecido';
      const fala = turno.fala || '';
      return `${role}: ${fala}`;
    })
    .join('\n');
};

/**
 * Retry com exponential backoff
 */
const retryWithExponentialBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`⚠️  Tentativa ${attempt + 1} falhou. Retry em ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
};

module.exports = {
  initializeVertexAI,
  runGeminiAudioAnalysis,
  formatTranscricaoParaTexto,
  detectAudioMimeType,
  retryWithExponentialBackoff,
  GEMINI_AGENT_PROMPT,
  GEMINI_RESPONSE_SCHEMA
};
