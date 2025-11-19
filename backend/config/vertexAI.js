// VERSION: v1.2.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
const speech = require('@google-cloud/speech');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSecret } = require('./secrets');

// Configuração
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// Inicializar clientes
let speechClient;
let genAI;
let geminiApiKey;

/**
 * Detectar encoding de áudio baseado na extensão do arquivo
 * @param {string} fileName - Nome do arquivo com extensão
 * @returns {Object} { encoding: string, sampleRateHertz: number }
 */
const detectAudioEncoding = (fileName) => {
  const extension = fileName.toLowerCase().split('.').pop();
  
  switch (extension) {
    case 'mp3':
      return {
        encoding: 'MP3',
        sampleRateHertz: 44100
      };
    case 'wav':
      return {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000
      };
    default:
      // Fallback para WEBM_OPUS
      console.warn(`⚠️  Formato de áudio não reconhecido (${extension}), usando WEBM_OPUS como fallback`);
      return {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 16000
      };
  }
};

/**
 * Inicializar clientes Vertex AI
 */
const initializeVertexAI = async () => {
  try {
    if (!GCP_PROJECT_ID) {
      throw new Error('GCP_PROJECT_ID deve estar configurado nas variáveis de ambiente');
    }

    // Inicializar Speech-to-Text client
    if (!speechClient) {
      speechClient = new speech.SpeechClient({
        projectId: GCP_PROJECT_ID
      });
    }

    // Buscar GEMINI_API_KEY do Secret Manager se ainda não foi carregada
    if (!geminiApiKey) {
      try {
        geminiApiKey = await getSecret('GEMINI_API_KEY');
      } catch (error) {
        throw new Error(`Falha ao buscar GEMINI_API_KEY do Secret Manager: ${error.message}`);
      }
    }

    // Inicializar Gemini AI
    if (!genAI && geminiApiKey) {
      genAI = new GoogleGenerativeAI(geminiApiKey);
    } else if (!genAI) {
      throw new Error('GEMINI_API_KEY deve estar configurada no Secret Manager');
    }

    console.log('✅ Vertex AI inicializado');
    return { speechClient, genAI };
  } catch (error) {
    console.error('❌ Erro ao inicializar Vertex AI:', error);
    throw error;
  }
};

/**
 * Transcrever áudio usando Speech-to-Text
 * @param {string} gcsUri - URI do arquivo no GCS (gs://bucket/file)
 * @param {string} fileName - Nome do arquivo para detectar encoding
 * @param {string} languageCode - Código do idioma (ex: 'pt-BR')
 * @returns {Promise<{transcription: string, timestamps: Array}>}
 */
const transcribeAudio = async (gcsUri, fileName, languageCode = 'pt-BR') => {
  try {
    if (!speechClient) {
      await initializeVertexAI();
    }

    // Detectar encoding baseado na extensão do arquivo
    const audioConfig = detectAudioEncoding(fileName);
    
    const request = {
      audio: {
        uri: gcsUri
      },
      config: {
        encoding: audioConfig.encoding,
        sampleRateHertz: audioConfig.sampleRateHertz,
        languageCode: languageCode,
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true, // Para timestamps
        model: 'latest_long', // Modelo otimizado para áudios longos
        useEnhanced: true
      }
    };

    console.log(`🎤 Transcrevendo áudio: ${gcsUri} (encoding: ${audioConfig.encoding}, sampleRate: ${audioConfig.sampleRateHertz}Hz)`);
    const [operation] = await speechClient.longRunningRecognize(request);
    
    // Aguardar conclusão da operação
    const [response] = await operation.promise();
    
    // Processar resultados
    let transcription = '';
    const timestamps = [];
    
    if (response.results && response.results.length > 0) {
      response.results.forEach(result => {
        if (result.alternatives && result.alternatives[0]) {
          const alternative = result.alternatives[0];
          transcription += alternative.transcript + ' ';
          
          // Extrair timestamps das palavras
          if (alternative.words) {
            alternative.words.forEach(word => {
              timestamps.push({
                word: word.word,
                startTime: word.startTime.seconds + word.startTime.nanos / 1e9,
                endTime: word.endTime.seconds + word.endTime.nanos / 1e9
              });
            });
          }
        }
      });
    }

    transcription = transcription.trim();

    console.log(`✅ Transcrição concluída: ${transcription.length} caracteres`);
    
    return {
      transcription,
      timestamps,
      confidence: response.results[0]?.alternatives[0]?.confidence || 0
    };
  } catch (error) {
    console.error('❌ Erro ao transcrever áudio:', error);
    throw error;
  }
};

/**
 * Analisar emoção e nuance usando Gemini
 * @param {string} transcription - Texto transcrito
 * @param {Array} timestamps - Timestamps das palavras
 * @returns {Promise<{emotion: object, nuance: object, analysis: string}>}
 */
const analyzeEmotionAndNuance = async (transcription, timestamps) => {
  try {
    if (!genAI) {
      await initializeVertexAI();
    }

    // Preparar prompt para análise de emoção e nuance
    const prompt = `
Analise a seguinte transcrição de uma ligação de atendimento e forneça:

1. ANÁLISE DE EMOÇÃO E NUANCE:
   - Tom de voz (positivo, neutro, negativo)
   - Nível de empatia demonstrado
   - Clareza na comunicação
   - Profissionalismo
   - Pontos de tensão ou desconforto

2. AVALIAÇÃO DOS CRITÉRIOS DE QUALIDADE:
   Avalie cada critério abaixo como true ou false baseado na transcrição:

   - saudacaoAdequada: O colaborador cumprimentou adequadamente?
   - escutaAtiva: Demonstrou escuta ativa e fez perguntas relevantes?
   - clarezaObjetividade: Foi claro e objetivo na comunicação?
   - resolucaoQuestao: Resolveu a questão seguindo procedimentos?
   - dominioAssunto: Demonstrou conhecimento sobre o assunto?
   - empatiaCordialidade: Demonstrou empatia e cordialidade?
   - direcionouPesquisa: Direcionou para pesquisa de satisfação?
   - procedimentoIncorreto: Repassou informação incorreta? (true = negativo)
   - encerramentoBrusco: Encerrou o contato de forma brusca? (true = negativo)

3. PONTUAÇÃO:
   Calcule pontuação de 0-100 baseado nos critérios:
   - Critérios positivos: +10 a +25 pontos cada
   - Critérios negativos: -60 a -100 pontos cada

4. PALAVRAS-CHAVE CRÍTICAS:
   Liste palavras ou frases que indicam problemas ou pontos de atenção.

TRANSCRIÇÃO:
${transcription}

Retorne um JSON com a seguinte estrutura:
{
  "analiseGPT": "Análise completa detalhada",
  "criteriosGPT": {
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
  "pontuacaoGPT": number,
  "confianca": number,
  "palavrasCriticas": ["palavra1", "palavra2"],
  "calculoDetalhado": ["explicação1", "explicação2"],
  "emotion": {
    "tom": "positivo|neutro|negativo",
    "empatia": number,
    "profissionalismo": number
  },
  "nuance": {
    "clareza": number,
    "tensao": number
  }
}
`;

    // Usar Gemini para análise (já inicializado acima)

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Extrair JSON da resposta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Resposta do Gemini não contém JSON válido');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    console.log('✅ Análise de emoção e nuance concluída');
    
    return {
      emotion: analysis.emotion || {},
      nuance: analysis.nuance || {},
      analysis: analysis.analiseGPT || '',
      criteriosGPT: analysis.criteriosGPT || {},
      pontuacaoGPT: analysis.pontuacaoGPT || 0,
      confianca: analysis.confianca || 0,
      palavrasCriticas: analysis.palavrasCriticas || [],
      calculoDetalhado: analysis.calculoDetalhado || []
    };
  } catch (error) {
    console.error('❌ Erro ao analisar emoção e nuance:', error);
    throw error;
  }
};

/**
 * Cruzar outputs de transcrição e análise de emoção
 * @param {object} transcriptionResult - Resultado da transcrição
 * @param {object} emotionResult - Resultado da análise de emoção
 * @returns {object} Resultado cruzado
 */
const crossReferenceOutputs = (transcriptionResult, emotionResult) => {
  try {
    // Cruzar timestamps com análise de emoção
    const crossReferenced = {
      transcription: transcriptionResult.transcription,
      timestamps: transcriptionResult.timestamps,
      emotion: emotionResult.emotion,
      nuance: emotionResult.nuance,
      qualityAnalysis: {
        criterios: emotionResult.criteriosGPT,
        pontuacao: emotionResult.pontuacaoGPT,
        confianca: emotionResult.confianca,
        palavrasCriticas: emotionResult.palavrasCriticas,
        calculoDetalhado: emotionResult.calculoDetalhado
      },
      analysis: emotionResult.analysis
    };

    console.log('✅ Outputs cruzados com sucesso');
    
    return crossReferenced;
  } catch (error) {
    console.error('❌ Erro ao cruzar outputs:', error);
    throw error;
  }
};

/**
 * Retry com exponential backoff
 * @param {Function} fn - Função a ser executada
 * @param {number} maxRetries - Número máximo de tentativas
 * @param {number} baseDelay - Delay base em ms
 * @returns {Promise}
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
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
};

module.exports = {
  initializeVertexAI,
  transcribeAudio,
  analyzeEmotionAndNuance,
  crossReferenceOutputs,
  retryWithExponentialBackoff,
  detectAudioEncoding
};

