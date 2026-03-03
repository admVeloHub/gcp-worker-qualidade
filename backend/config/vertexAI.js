// VERSION: v1.7.0 | DATE: 2025-02-11 | AUTHOR: VeloHub Development Team
// CHANGELOG: v1.7.0 - Atualização de métricas: pontuações atualizadas, removidos critérios não verificáveis pela IA (registroAtendimento, naoConsultouBot, conformidadeTicket)
const speech = require('@google-cloud/speech');
const { VertexAI } = require('@google-cloud/vertexai');

// Configuração
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// Inicializar clientes
let speechClient;
let vertexAI;

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

    // Inicializar Vertex AI (usa Application Default Credentials automaticamente)
    if (!vertexAI) {
      vertexAI = new VertexAI({
        project: GCP_PROJECT_ID,
        location: GCP_LOCATION
      });
      console.log(`✅ Vertex AI inicializado (Project: ${GCP_PROJECT_ID}, Location: ${GCP_LOCATION})`);
    }

    return { speechClient, genAI: vertexAI };
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
    if (!vertexAI) {
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
   - empatiaCordialidade: Demonstrou empatia e cordialidade?
   - direcionouPesquisa: Direcionou para pesquisa de satisfação?
   - procedimentoIncorreto: Repassou informação incorreta? (true = negativo)
   - encerramentoBrusco: Encerrou o contato de forma brusca? (true = negativo)

   IMPORTANTE - CRITÉRIOS NÃO VERIFICÁVEIS PELA IA:
   Os seguintes critérios NÃO devem ser avaliados pela IA, pois serão copiados automaticamente da avaliação manual:
   - registroAtendimento: Anotação interna não presente na transcrição do áudio
   - naoConsultouBot: Não é possível verificar pela transcrição se o bot foi consultado
   - conformidadeTicket: Erro de tabulação ou resposta incoerente não verificável apenas pela transcrição
   
   Estes critérios devem sempre ser false na resposta da IA e serão adicionados posteriormente copiando da avaliação manual.

3. PONTUAÇÃO:
   Calcule a pontuação baseado apenas nos critérios verificáveis acima. A pontuação pode variar de -200 a 85 pontos (sem incluir os critérios não verificáveis):
   
   CRITÉRIOS POSITIVOS (somam pontos):
   - saudacaoAdequada: +5 pontos
   - escutaAtiva: +10 pontos
   - clarezaObjetividade: +10 pontos
   - resolucaoQuestao: +40 pontos
   - empatiaCordialidade: +10 pontos
   - direcionouPesquisa: +10 pontos
   
   CRITÉRIOS NEGATIVOS (subtraem pontos):
   - procedimentoIncorreto: -100 pontos (se o colaborador repassou um procedimento incorreto)
   - encerramentoBrusco: -100 pontos (se o colaborador encerrou o contato de forma brusca ou derrubou a ligação)
   
   IMPORTANTE: 
   - Some todos os critérios positivos que forem true e subtraia os critérios negativos que forem true.
   - A pontuação final pode ser negativa se houver critérios negativos, mas será limitada a 0 no cálculo final.
   - NÃO inclua registroAtendimento, naoConsultouBot ou conformidadeTicket no cálculo da pontuação - estes critérios serão copiados da avaliação manual.

4. PALAVRAS-CHAVE CRÍTICAS:
   Você DEVE buscar especificamente pelas seguintes palavras ou frases na transcrição:
   - "procon" (ou "PROCON")
   - "bacen" (ou "BACEN" ou "Banco Central")
   - "processo" (quando relacionado a processo judicial ou administrativo)
   - "acionar na justiça" (ou variações como "processar", "entrar na justiça", "acionar judicialmente")
   - "denuncia" (ou "denúncia", "denunciar")
   
   Sinônimos e variações também devem ser considerados:
   - "reclamação formal", "reclamação no PROCON", "reclamação no BACEN"
   - "processar", "processo judicial", "ação judicial"
   - "advogado", "entrar com ação", "ir para a justiça"
   - "denunciar", "fazer denúncia", "registrar denúncia"
   
   IMPORTANTE: 
   - Se NENHUMA dessas palavras ou sinônimos for encontrada na transcrição, retorne um array vazio: []
   - Se encontrar alguma dessas palavras ou sinônimos, liste-as no array palavrasCriticas
   - Não invente palavras críticas que não estejam relacionadas a reclamações formais ou processos legais

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
    "empatiaCordialidade": boolean,
    "direcionouPesquisa": boolean,
    "procedimentoIncorreto": boolean,
    "encerramentoBrusco": boolean
  },
  "pontuacaoGPT": number,
  "confianca": number,
  "palavrasCriticas": ["procon", "bacen"] ou [] (array vazio se nenhuma palavra crítica for encontrada),
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

NOTA IMPORTANTE: Os campos "registroAtendimento", "naoConsultouBot" e "conformidadeTicket" NÃO devem estar em criteriosGPT, pois serão adicionados posteriormente copiando da avaliação manual do avaliador humano.
`;

    // Usar Vertex AI para análise (usa credenciais do GCP automaticamente)
    const model = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-pro',
    });
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    
    const response = result.response;
    const text = response.candidates[0].content.parts[0].text;

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
 * @param {object} emotionResult - Resultado da análise de emoção (Gemini)
 * @param {object} gptResult - Resultado da análise GPT (opcional)
 * @returns {object} Resultado cruzado
 */
const crossReferenceOutputs = (transcriptionResult, emotionResult, gptResult = null) => {
  try {
    // Calcular pontuação consensual (média entre Gemini e GPT se ambos disponíveis)
    let pontuacaoConsensual = emotionResult.pontuacaoGPT || 0;
    if (gptResult && typeof gptResult.pontuacaoGPT === 'number') {
      pontuacaoConsensual = Math.round((emotionResult.pontuacaoGPT + gptResult.pontuacaoGPT) / 2);
    }

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
      analysis: emotionResult.analysis,
      // Análise GPT (opcional)
      gptAnalysis: gptResult ? {
        criterios: gptResult.criteriosGPT,
        pontuacao: gptResult.pontuacaoGPT,
        palavrasCriticas: gptResult.palavrasCriticas,
        recomendacoes: gptResult.recomendacoes || [],
        confianca: gptResult.confianca || 0,
        validacaoGemini: gptResult.validacaoGemini || null,
        analysis: gptResult.analysis || ''
      } : null,
      // Pontuação consensual (média entre Gemini e GPT)
      pontuacaoConsensual: pontuacaoConsensual
    };

    console.log('✅ Outputs cruzados com sucesso');
    if (gptResult) {
      console.log(`📊 Pontuação Gemini: ${emotionResult.pontuacaoGPT}, GPT: ${gptResult.pontuacaoGPT}, Consensual: ${pontuacaoConsensual}`);
    }
    
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

