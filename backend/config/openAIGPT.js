// VERSION: v1.1.0 | DATE: 2025-11-24 | AUTHOR: VeloHub Development Team
const OpenAI = require('openai');
const { getSecret } = require('./secrets');

// Configuração
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GPT_MODEL = process.env.GPT_MODEL || 'gpt-5-mini'; // Modelo padrão: gpt-5-mini

// Cliente OpenAI
let openaiClient = null;
let openaiApiKey = null;

/**
 * Inicializar cliente OpenAI
 */
const initializeOpenAI = async () => {
  try {

    // Buscar OPENAI_API_KEY - verificar env var primeiro, depois Secret Manager
    if (!openaiApiKey) {
      if (process.env.OPENAI_API_KEY) {
        openaiApiKey = process.env.OPENAI_API_KEY;
        console.log('✅ OPENAI_API_KEY encontrada em variáveis de ambiente');
      } else {
        try {
          openaiApiKey = await getSecret('OPENAI_API_KEY');
        } catch (error) {
          throw new Error(`Falha ao buscar OPENAI_API_KEY do Secret Manager: ${error.message}`);
        }
      }
    }

    // Inicializar OpenAI client
    if (!openaiClient && openaiApiKey) {
      openaiClient = new OpenAI({
        apiKey: openaiApiKey
      });
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

/**
 * Analisar transcrição com GPT
 * @param {string} transcription - Texto transcrito
 * @param {object} geminiAnalysis - Resultado da análise do Gemini (opcional, para comparação)
 * @returns {Promise<object>} Resultado da análise GPT
 */
const analyzeWithGPT = async (transcription, geminiAnalysis = null) => {
  try {
    if (!openaiClient) {
      await initializeOpenAI();
    }

    const prompt = `
Analise a seguinte transcrição de uma ligação de atendimento e forneça uma análise complementar seguindo os mesmos critérios de qualidade:

TRANSCRIÇÃO:
${transcription}

${geminiAnalysis ? `
ANÁLISE PREVIA (Gemini):
Pontuação: ${geminiAnalysis.pontuacaoGPT || 0}
Critérios: ${JSON.stringify(geminiAnalysis.criteriosGPT || {}, null, 2)}
Palavras Críticas: ${geminiAnalysis.palavrasCriticas?.join(', ') || 'Nenhuma'}
Análise: ${geminiAnalysis.analysis || 'Não disponível'}

Por favor, valide ou complemente esta análise com sua própria avaliação. Se houver diferenças significativas, explique-as.
` : ''}

CRITÉRIOS DE QUALIDADE:
Avalie cada critério abaixo como true ou false baseado na transcrição:

- saudacaoAdequada: O colaborador cumprimentou adequadamente? (+10 pontos se true)
- escutaAtiva: Demonstrou escuta ativa e fez perguntas relevantes? (+15 pontos se true)
- clarezaObjetividade: Foi claro e objetivo na comunicação? (+10 pontos se true)
- resolucaoQuestao: Resolveu a questão seguindo procedimentos? (+25 pontos se true)
- dominioAssunto: Demonstrou conhecimento sobre o assunto? (+15 pontos se true)
- empatiaCordialidade: Demonstrou empatia e cordialidade? (+15 pontos se true)
- direcionouPesquisa: Direcionou para pesquisa de satisfação? (+10 pontos se true)
- procedimentoIncorreto: Repassou informação incorreta? (-60 pontos se true)
- encerramentoBrusco: Encerrou o contato de forma brusca ou derrubou a ligação? (-100 pontos se true)

PONTUAÇÃO:
Calcule a pontuação baseado nos critérios acima. A pontuação pode variar de -160 a 100 pontos.

PALAVRAS-CHAVE CRÍTICAS:
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

Retorne um JSON com a seguinte estrutura:
{
  "analiseGPT": "Análise detalhada do atendimento",
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
  "palavrasCriticas": [] ou ["palavra1", "palavra2"],
  "recomendacoes": ["recomendação1", "recomendação2"],
  "confianca": number,
  "validacaoGemini": ${geminiAnalysis ? '{"concorda": boolean, "diferencas": ["diferença1", "diferença2"]}' : 'null'}
}
`;

    const response = await openaiClient.chat.completions.create({
      model: GPT_MODEL, // Usa variável de ambiente ou padrão 'gpt-5-mini'
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em análise de qualidade de atendimento ao cliente. Analise transcrições de forma objetiva e detalhada, seguindo rigorosamente os critérios de pontuação especificados.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3, // Baixa temperatura para respostas mais consistentes
      response_format: { type: 'json_object' } // Forçar resposta JSON
    });

    const analysisText = response.choices[0].message.content;
    
    // Extrair JSON da resposta (pode ter texto antes/depois)
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Resposta do GPT não contém JSON válido');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    console.log('✅ Análise GPT concluída');
    
    return {
      analysis: analysis.analiseGPT || '',
      criteriosGPT: analysis.criteriosGPT || {},
      pontuacaoGPT: analysis.pontuacaoGPT || 0,
      palavrasCriticas: analysis.palavrasCriticas || [],
      recomendacoes: analysis.recomendacoes || [],
      confianca: analysis.confianca || 0,
      validacaoGemini: analysis.validacaoGemini || null
    };
  } catch (error) {
    console.error('❌ Erro ao analisar com GPT:', error);
    throw error;
  }
};

module.exports = {
  initializeOpenAI,
  analyzeWithGPT
};

