// VERSION: v3.5.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
// Worker assíncrono para processamento de áudio via Pub/Sub

// CRÍTICO: Iniciar servidor HTTP IMEDIATAMENTE para Cloud Run
// Isso deve acontecer antes de qualquer import que possa falhar
const express = require('express');
const PORT = process.env.PORT || 8080;

// Criar servidor Express básico IMEDIATAMENTE
const basicApp = express();
basicApp.use(express.json());

// Rota raiz simples - DEVE responder imediatamente para Cloud Run
basicApp.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'audio-worker',
    timestamp: new Date().toISOString()
  });
});

// Variáveis para módulos (serão carregados depois que servidor estiver pronto)
let PubSub, axios, AudioAnaliseStatus, AudioAnaliseResult, QualidadeAvaliacao;
let initializeVertexAI, transcribeAudio, analyzeEmotionAndNuance, crossReferenceOutputs, retryWithExponentialBackoff;
let analyzeWithGPT, healthCheckRouter, observatorioRouter, registerWorkerInstances;

// Iniciar servidor básico IMEDIATAMENTE (antes de qualquer outra coisa)
let basicServer = null;
if (require.main === module) {
  try {
    basicServer = basicApp.listen(PORT, '0.0.0.0', () => {
      console.log(`[${new Date().toISOString()}] [INFO] ✅ Servidor HTTP básico iniciado na porta ${PORT}`);
      console.log(`[${new Date().toISOString()}] [INFO]    - Cloud Run pode verificar saúde`);
      
      // IMPORTANTE: Aguardar servidor estar realmente escutando antes de carregar módulos
      // Usar setImmediate para garantir que o servidor está pronto
      setImmediate(() => {
        try {
          loadWorkerModules();
        } catch (error) {
          console.error(`[${new Date().toISOString()}] [ERROR] ❌ Erro ao carregar módulos do worker: ${error.message}`);
          console.error(error.stack);
          // Servidor básico continua funcionando mesmo se módulos falharem
        }
      });
    });
    
    basicServer.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] [ERROR] ❌ Erro no servidor básico: ${error.message}`);
    });
    
    basicServer.on('listening', () => {
      console.log(`[${new Date().toISOString()}] [INFO] ✅ Servidor HTTP escutando na porta ${PORT}`);
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [ERROR] ❌ Erro ao iniciar servidor básico: ${error.message}`);
    console.error(error.stack);
    process.exit(1); // Se servidor básico falhar, não há o que fazer
  }
}

// Função para carregar módulos do worker de forma segura
function loadWorkerModules() {
  try {
    // Importar módulos básicos
    const pubsubModule = require('@google-cloud/pubsub');
    PubSub = pubsubModule.PubSub;
    axios = require('axios');
    
    // Importar modelos MongoDB
    AudioAnaliseStatus = require('../models/AudioAnaliseStatus');
    AudioAnaliseResult = require('../models/AudioAnaliseResult');
    QualidadeAvaliacao = require('../models/QualidadeAvaliacao');
    
    // Importar configurações Vertex AI
    const vertexAI = require('../config/vertexAI');
    initializeVertexAI = vertexAI.initializeVertexAI;
    transcribeAudio = vertexAI.transcribeAudio;
    analyzeEmotionAndNuance = vertexAI.analyzeEmotionAndNuance;
    crossReferenceOutputs = vertexAI.crossReferenceOutputs;
    retryWithExponentialBackoff = vertexAI.retryWithExponentialBackoff;
    
    // Importar OpenAI GPT
    const openAIGPT = require('../config/openAIGPT');
    analyzeWithGPT = openAIGPT.analyzeWithGPT;
    
    // Importar routers (podem falhar se modelos não estiverem prontos)
    healthCheckRouter = require('./healthCheck');
    observatorioRouter = require('./observatorio');
    registerWorkerInstances = healthCheckRouter.registerWorkerInstances;
    
    console.log(`[${new Date().toISOString()}] [INFO] ✅ Módulos do worker carregados com sucesso`);
    
    // Adicionar rotas ao servidor básico
    if (basicServer) {
      addRoutesToServer();
      startWorker();
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [ERROR] ❌ Erro ao carregar módulos: ${error.message}`);
    console.error(error.stack);
    // Servidor básico continua funcionando
  }
}

// Carregar dotenv apenas se existir (opcional para Cloud Run)
try {
  require('dotenv').config();
} catch (error) {
  // Ignorar erro se dotenv não estiver disponível (normal no Cloud Run)
}

// Configuração
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'qualidade_audio_envio';
const PUBSUB_SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION_NAME || 'upload_audio_qualidade';
const PUBSUB_TOPIC_NAME = process.env.PUBSUB_TOPIC_NAME || 'qualidade_audio_envio';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const ENABLE_GPT_ANALYSIS = process.env.ENABLE_GPT_ANALYSIS !== 'false'; // Default: true

// Inicializar Pub/Sub
let pubsub;
let subscription;

// Instâncias para health check
let speechClientInstance = null;
let genAIInstance = null;

// Contador de tentativas por mensagem
const messageRetries = new Map();

// Estatísticas de processamento
const stats = {
  startTime: Date.now(),
  totalProcessed: 0,
  totalSuccess: 0,
  totalFailed: 0,
  lastMessageTime: null,
  processingMessages: new Map(), // messageId -> { fileName, startTime }
  messageHistory: [] // Últimas 50 mensagens processadas
};

// Logs recentes (últimas 100 linhas)
const recentLogs = [];
const MAX_LOGS = 100;

/**
 * Adicionar log ao histórico
 */
const addLog = (level, message) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  recentLogs.push(logEntry);
  if (recentLogs.length > MAX_LOGS) {
    recentLogs.shift();
  }
  // Também logar no console
  console.log(`[${logEntry.timestamp}] [${level}] ${message}`);
};

/**
 * Inicializar cliente Pub/Sub
 */
const initializePubSub = () => {
  try {
    if (!GCP_PROJECT_ID) {
      throw new Error('GCP_PROJECT_ID deve estar configurado nas variáveis de ambiente');
    }

    pubsub = new PubSub({ projectId: GCP_PROJECT_ID });
    subscription = pubsub.subscription(PUBSUB_SUBSCRIPTION_NAME);
    
    console.log('✅ Pub/Sub inicializado');
    console.log(`📡 Escutando subscription: ${PUBSUB_SUBSCRIPTION_NAME}`);
    
    return { pubsub, subscription };
  } catch (error) {
    console.error('❌ Erro ao inicializar Pub/Sub:', error);
    throw error;
  }
};

/**
 * Classificar erro como recuperável ou não recuperável
 * @param {Error} error - Erro a ser classificado
 * @returns {boolean} true se recuperável, false se não recuperável
 */
const isRecoverableError = (error) => {
  const errorMessage = error.message.toLowerCase();
  
  // Erros não recuperáveis - não devem ser retentados
  // Fazer ack() imediatamente para remover da fila
  const nonRecoverablePatterns = [
    'avaliação não encontrada',
    'arquivo deve estar associado',
    'já foi processado',
    'validation error',
    'invalid data'
  ];
  
  if (nonRecoverablePatterns.some(pattern => errorMessage.includes(pattern))) {
    return false;
  }
  
  // Erros recuperáveis - podem ser retentados
  const recoverablePatterns = [
    'network',
    'timeout',
    'connection',
    'temporary',
    'service unavailable'
  ];
  
  return recoverablePatterns.some(pattern => errorMessage.includes(pattern));
};

/**
 * Notificar backend API sobre conclusão do processamento
 * @param {string} avaliacaoId - ID da avaliação
 */
const notifyBackendCompletion = async (avaliacaoId) => {
  try {
    const response = await axios.post(`${BACKEND_API_URL}/api/audio-analise/notify-completed`, {
      avaliacaoId: avaliacaoId
    }, {
      timeout: 5000
    });
    
    console.log(`✅ Backend notificado sobre conclusão: ${avaliacaoId}`);
    return response.data;
  } catch (error) {
    console.warn(`⚠️  Erro ao notificar backend (não crítico):`, error.message);
    // Não lançar erro, pois a notificação é opcional
    return null;
  }
};

/**
 * Processar áudio completo
 * @param {string} gcsUri - URI do arquivo no GCS
 * @param {string} fileName - Nome do arquivo
 * @returns {Promise<object>} Resultado da análise
 */
const processAudio = async (gcsUri, fileName) => {
  const startTime = Date.now();
  
  try {
    addLog('INFO', `🎵 Iniciando processamento de áudio: ${fileName}`);
    
    // 1. Transcrever áudio com retry
    addLog('INFO', '📝 Passo 1: Transcrevendo áudio...');
    const transcriptionResult = await retryWithExponentialBackoff(
      () => transcribeAudio(gcsUri, fileName, 'pt-BR'),
      MAX_RETRIES
    );
    
    if (!transcriptionResult.transcription || transcriptionResult.transcription.length === 0) {
      throw new Error('Transcrição vazia ou inválida');
    }
    
    addLog('INFO', `✅ Transcrição concluída: ${transcriptionResult.transcription.length} caracteres`);
    
    // 2. Analisar emoção e nuance com retry (Gemini)
    addLog('INFO', '🧠 Passo 2: Analisando emoção e nuance com Gemini...');
    const emotionResult = await retryWithExponentialBackoff(
      () => analyzeEmotionAndNuance(transcriptionResult.transcription, transcriptionResult.timestamps),
      MAX_RETRIES
    );
    
    addLog('INFO', `✅ Análise Gemini concluída. Pontuação: ${emotionResult.pontuacaoGPT}`);
    
    // 3. Analisar com GPT (opcional)
    let gptResult = null;
    if (ENABLE_GPT_ANALYSIS) {
      try {
        addLog('INFO', '🤖 Passo 3: Analisando com GPT...');
        gptResult = await retryWithExponentialBackoff(
          () => analyzeWithGPT(transcriptionResult.transcription, emotionResult),
          MAX_RETRIES
        );
        addLog('INFO', `✅ Análise GPT concluída. Pontuação: ${gptResult.pontuacaoGPT}`);
      } catch (error) {
        addLog('WARN', `⚠️  Análise GPT falhou (continuando com Gemini apenas): ${error.message}`);
        // Não bloquear processamento se GPT falhar
        gptResult = null;
      }
    } else {
      addLog('INFO', '⏭️  Análise GPT desabilitada (ENABLE_GPT_ANALYSIS=false)');
    }
    
    // 4. Cruzar outputs (Gemini + GPT se disponível)
    addLog('INFO', '🔗 Passo 4: Cruzando outputs...');
    const crossReferenced = crossReferenceOutputs(transcriptionResult, emotionResult, gptResult);
    
    const processingTime = (Date.now() - startTime) / 1000;
    crossReferenced.processingTime = processingTime;
    
    addLog('INFO', `✅ Processamento completo em ${processingTime.toFixed(2)}s`);
    
    return crossReferenced;
  } catch (error) {
    addLog('ERROR', `❌ Erro ao processar áudio: ${error.message}`);
    throw error;
  }
};

/**
 * Processar mensagem do Pub/Sub
 * @param {object} message - Mensagem recebida do Pub/Sub
 */
const processMessage = async (message) => {
  const messageId = message.id;
  let avaliacao = null;
  let retryCount = messageRetries.get(messageId) || 0;
  
  try {
    addLog('INFO', `📨 Mensagem recebida do Pub/Sub [ID: ${messageId}]`);
    
    // Parse da mensagem do GCS
    const data = JSON.parse(message.data.toString());
    addLog('DEBUG', `📋 Dados da mensagem: ${JSON.stringify(data, null, 2)}`);

    // Extrair informações do evento GCS
    const fileName = data.name || data.object || data.fileName;
    const bucketName = data.bucket || data.bucketName || GCS_BUCKET_NAME;
    
    if (!fileName) {
      throw new Error('Nome do arquivo não encontrado na mensagem');
    }

    // Construir URI do GCS
    const gcsUri = `gs://${bucketName}/${fileName}`;
    addLog('INFO', `🔄 Processando arquivo: ${fileName}`);
    addLog('DEBUG', `📍 GCS URI: ${gcsUri}`);

    // Registrar início do processamento
    stats.processingMessages.set(messageId, {
      fileName,
      startTime: Date.now()
    });

    // 1. Verificar se arquivo já foi processado (ANTES de buscar avaliação)
    let ResultModel = await AudioAnaliseResult.model();
    const existingResult = await ResultModel.findOne({ nomeArquivo: fileName });
    
    if (existingResult) {
      addLog('INFO', `ℹ️  Arquivo ${fileName} já foi processado anteriormente. Ignorando.`);
      // Limpar contador de retries e mensagem em processamento
      messageRetries.delete(messageId);
      stats.processingMessages.delete(messageId);
      // Confirmar mensagem (arquivo já processado - não reprocessar)
      message.ack();
      return;
    }

    // 2. Buscar avaliação pelo nomeArquivoAudio no MongoDB (já preenchido no upload)
    const QualidadeAvaliacaoModel = await QualidadeAvaliacao.model();
    avaliacao = await QualidadeAvaliacaoModel.findOne({ nomeArquivoAudio: fileName });
    
    if (!avaliacao) {
      addLog('WARN', `⚠️  Avaliação não encontrada para arquivo: ${fileName}`);
      // Erro não recuperável - fazer ack() imediatamente para remover da fila
      const error = new Error(`Avaliação não encontrada para arquivo ${fileName}. O arquivo deve estar associado a uma avaliação existente.`);
      
      // Atualizar estatísticas
      stats.totalProcessed++;
      stats.totalFailed++;
      
      // Adicionar ao histórico
      const processingInfo = stats.processingMessages.get(messageId);
      const processingTime = processingInfo ? (Date.now() - processingInfo.startTime) / 1000 : 0;
      
      stats.messageHistory.push({
        messageId,
        fileName,
        status: 'failed',
        error: error.message,
        processingTime,
        timestamp: new Date().toISOString()
      });
      
      // Manter apenas últimas 50 mensagens
      if (stats.messageHistory.length > 50) {
        stats.messageHistory.shift();
      }
      
      // Limpar contador de retries e mensagem em processamento
      messageRetries.delete(messageId);
      stats.processingMessages.delete(messageId);
      
      // Fazer ack() imediatamente (erro não recuperável)
      message.ack();
      addLog('INFO', `✅ Mensagem removida da fila (erro não recuperável) [ID: ${messageId}]`);
      return;
    }
    
    // 3. Verificar se avaliação já foi processada
    if (avaliacao.audioTreated) {
      addLog('INFO', `ℹ️  Arquivo ${fileName} já foi processado para avaliação ${avaliacao._id}. Ignorando.`);
      // Limpar contador de retries e mensagem em processamento
      messageRetries.delete(messageId);
      stats.processingMessages.delete(messageId);
      // Confirmar mensagem (já processado - não reprocessar)
      message.ack();
      return;
    }
    
    addLog('INFO', `✅ Avaliação encontrada: ${avaliacao._id} para arquivo: ${fileName}`);

    // Processar áudio
    const analysisResult = await processAudio(gcsUri, fileName);

    // Copiar critérios não verificáveis pela IA da avaliação manual
    // (A IA não pode determinar registroAtendimento, naoConsultouBot e conformidadeTicket)
    const copiarCritériosNaoVerificaveis = (criterios) => {
      // Copiar registroAtendimento (substitui dominioAssunto)
      if (avaliacao.registroAtendimento !== undefined && avaliacao.registroAtendimento !== null) {
        criterios.registroAtendimento = Boolean(avaliacao.registroAtendimento);
      } else if (avaliacao.dominioAssunto !== undefined && avaliacao.dominioAssunto !== null) {
        // Compatibilidade retroativa
        criterios.registroAtendimento = Boolean(avaliacao.dominioAssunto);
      }
      
      // Copiar naoConsultouBot
      if (avaliacao.naoConsultouBot !== undefined && avaliacao.naoConsultouBot !== null) {
        criterios.naoConsultouBot = Boolean(avaliacao.naoConsultouBot);
      }
      
      // Copiar conformidadeTicket
      if (avaliacao.conformidadeTicket !== undefined && avaliacao.conformidadeTicket !== null) {
        criterios.conformidadeTicket = Boolean(avaliacao.conformidadeTicket);
      }
    };
    
    // Função para calcular pontuação com novas métricas
    const calcularPontuacao = (criterios) => {
      let total = 0;
      // Critérios positivos
      if (criterios.saudacaoAdequada) total += 5;
      if (criterios.escutaAtiva) total += 10; // Atualizado de 15 para 10
      if (criterios.clarezaObjetividade) total += 10; // Atualizado de 15 para 10
      if (criterios.resolucaoQuestao) total += 40;
      // registroAtendimento (substitui dominioAssunto) - copiado da avaliação manual
      if (criterios.registroAtendimento) total += 15;
      if (criterios.dominioAssunto) total += 15; // Compatibilidade retroativa
      if (criterios.empatiaCordialidade) total += 10; // Atualizado de 15 para 10
      if (criterios.direcionouPesquisa) total += 10;
      // Critérios detratoras
      if (criterios.naoConsultouBot) total -= 10; // Copiado da avaliação manual
      if (criterios.conformidadeTicket) total -= 15; // Copiado da avaliação manual
      if (criterios.procedimentoIncorreto) total -= 100; // Atualizado de -60 para -100
      if (criterios.encerramentoBrusco) total -= 100;
      return Math.max(0, total);
    };
    
    // Copiar critérios não verificáveis e recalcular pontuação para qualityAnalysis (Gemini)
    if (analysisResult.qualityAnalysis && analysisResult.qualityAnalysis.criterios) {
      copiarCritériosNaoVerificaveis(analysisResult.qualityAnalysis.criterios);
      analysisResult.qualityAnalysis.pontuacao = calcularPontuacao(analysisResult.qualityAnalysis.criterios);
    }
    
    // Copiar critérios não verificáveis e recalcular pontuação para gptAnalysis se existir
    if (analysisResult.gptAnalysis && analysisResult.gptAnalysis.criterios) {
      copiarCritériosNaoVerificaveis(analysisResult.gptAnalysis.criterios);
      analysisResult.gptAnalysis.pontuacao = calcularPontuacao(analysisResult.gptAnalysis.criterios);
    }
      // Recalcular pontuação consensual se necessário
      if (analysisResult.pontuacaoConsensual !== undefined) {
        const pontuacaoGemini = analysisResult.qualityAnalysis?.pontuacao || 0;
        const pontuacaoGPT = analysisResult.gptAnalysis?.pontuacao || pontuacaoGemini;
        analysisResult.pontuacaoConsensual = Math.round((pontuacaoGemini + pontuacaoGPT) / 2);
      }
    }

    // Salvar resultado no MongoDB (reutilizar ResultModel já declarado acima)
    const audioResult = new ResultModel({
      avaliacaoMonitorId: avaliacao._id,
      nomeArquivo: fileName,
      gcsUri: gcsUri,
      transcription: analysisResult.transcription,
      timestamps: analysisResult.timestamps,
      emotion: analysisResult.emotion,
      nuance: analysisResult.nuance,
      qualityAnalysis: {
        criterios: analysisResult.qualityAnalysis.criterios,
        pontuacao: analysisResult.qualityAnalysis.pontuacao,
        confianca: analysisResult.qualityAnalysis.confianca,
        palavrasCriticas: analysisResult.qualityAnalysis.palavrasCriticas,
        calculoDetalhado: analysisResult.qualityAnalysis.calculoDetalhado,
        analysis: analysisResult.analysis
      },
      gptAnalysis: analysisResult.gptAnalysis || null,
      pontuacaoConsensual: analysisResult.pontuacaoConsensual || analysisResult.qualityAnalysis.pontuacao,
      processingTime: analysisResult.processingTime
    });

    await audioResult.save();
    addLog('INFO', `✅ Resultado salvo no MongoDB: ${audioResult._id}`);

    // Atualizar audioTreated diretamente na avaliação
    avaliacao.audioTreated = true;
    avaliacao.audioUpdatedAt = new Date();
    await avaliacao.save();
    addLog('INFO', `✅ Status atualizado: audioTreated=true para avaliacaoId: ${avaliacao._id}`);

    // Notificar backend API sobre conclusão (dispara evento SSE)
    await notifyBackendCompletion(avaliacao._id.toString());

    // Atualizar estatísticas
    stats.totalProcessed++;
    stats.totalSuccess++;
    stats.lastMessageTime = Date.now();
    
    // Adicionar ao histórico
    const processingInfo = stats.processingMessages.get(messageId);
    const processingTime = processingInfo ? (Date.now() - processingInfo.startTime) / 1000 : 0;
    
    stats.messageHistory.push({
      messageId,
      fileName,
      status: 'success',
      processingTime,
      timestamp: new Date().toISOString()
    });
    
    // Manter apenas últimas 50 mensagens
    if (stats.messageHistory.length > 50) {
      stats.messageHistory.shift();
    }

    // Limpar contador de retries e mensagem em processamento
    messageRetries.delete(messageId);
    stats.processingMessages.delete(messageId);

    // Confirmar mensagem processada
    message.ack();
    addLog('INFO', `✅ Mensagem processada e confirmada [ID: ${messageId}]`);
    
  } catch (error) {
    addLog('ERROR', `❌ Erro ao processar mensagem [ID: ${messageId}]: ${error.message}`);
    
    // Classificar erro como recuperável ou não recuperável
    const isRecoverable = isRecoverableError(error);
    
    if (!isRecoverable) {
      // Erro não recuperável - fazer ack() imediatamente para remover da fila
      addLog('WARN', `⚠️  Erro não recuperável detectado. Removendo mensagem da fila.`);
      
      // Atualizar estatísticas
      stats.totalProcessed++;
      stats.totalFailed++;
      
      // Adicionar ao histórico
      const processingInfo = stats.processingMessages.get(messageId);
      const processingTime = processingInfo ? (Date.now() - processingInfo.startTime) / 1000 : 0;
      
      stats.messageHistory.push({
        messageId,
        fileName: processingInfo?.fileName || 'unknown',
        status: 'failed',
        error: error.message,
        processingTime,
        timestamp: new Date().toISOString()
      });
      
      // Manter apenas últimas 50 mensagens
      if (stats.messageHistory.length > 50) {
        stats.messageHistory.shift();
      }
      
      // Limpar contador de retries e mensagem em processamento
      messageRetries.delete(messageId);
      stats.processingMessages.delete(messageId);
      
      // Fazer ack() imediatamente (erro não recuperável)
      message.ack();
      addLog('INFO', `✅ Mensagem removida da fila (erro não recuperável) [ID: ${messageId}]`);
      return;
    }
    
    // Erro recuperável - fazer retry até MAX_RETRIES
    retryCount++;
    messageRetries.set(messageId, retryCount);
    
    // Se excedeu máximo de retries, enviar para Dead Letter Queue
    if (retryCount >= MAX_RETRIES) {
      addLog('ERROR', `❌ Máximo de tentativas excedido para mensagem [ID: ${messageId}]. Enviando para DLQ.`);
      
      // Atualizar estatísticas
      stats.totalProcessed++;
      stats.totalFailed++;
      
      // Adicionar ao histórico
      const processingInfo = stats.processingMessages.get(messageId);
      const processingTime = processingInfo ? (Date.now() - processingInfo.startTime) / 1000 : 0;
      
      stats.messageHistory.push({
        messageId,
        fileName: processingInfo?.fileName || 'unknown',
        status: 'failed',
        error: error.message,
        processingTime,
        timestamp: new Date().toISOString()
      });
      
      // Manter apenas últimas 50 mensagens
      if (stats.messageHistory.length > 50) {
        stats.messageHistory.shift();
      }
      
      // Marcar como erro na avaliação se existir
      if (avaliacao) {
        addLog('ERROR', `⚠️  Status não atualizado para avaliacaoId: ${avaliacao._id}`);
      }
      
      // Nack sem modificar deadline para enviar para DLQ
      message.nack();
      messageRetries.delete(messageId);
      stats.processingMessages.delete(messageId);
    } else {
      // Retry com exponential backoff
      const delay = 1000 * Math.pow(2, retryCount - 1);
      addLog('WARN', `⏳ Retry ${retryCount}/${MAX_RETRIES} em ${delay}ms...`);
      
      setTimeout(() => {
        message.nack();
      }, delay);
    }
  }
};

/**
 * Inicializar MongoDB
 */
const initializeMongoDB = async () => {
  try {
    addLog('INFO', '🔄 Inicializando conexão MongoDB...');
    // AudioAnaliseStatus mantido apenas para compatibilidade durante migração
    await AudioAnaliseStatus.initializeConnection();
    await AudioAnaliseResult.initializeConnection();
    await QualidadeAvaliacao.initializeConnection();
    addLog('INFO', '✅ MongoDB inicializado com sucesso');
    return true;
  } catch (error) {
    addLog('ERROR', `❌ Erro ao inicializar MongoDB: ${error.message}`);
    throw error;
  }
};

/**
 * Adicionar rotas adicionais ao servidor básico já criado
 */
const addRoutesToServer = () => {
  try {
    // Adicionar routers de forma segura (se falharem, servidor básico continua funcionando)
    try {
      basicApp.use('/', healthCheckRouter);
      console.log(`[${new Date().toISOString()}] [INFO] ✅ Health check router adicionado`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WARN] ⚠️  Erro ao adicionar healthCheckRouter: ${error.message}`);
    }
    
    try {
      basicApp.use('/', observatorioRouter);
      console.log(`[${new Date().toISOString()}] [INFO] ✅ Observatório router adicionado`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WARN] ⚠️  Erro ao adicionar observatorioRouter: ${error.message}`);
    }
    
    // Detectar se está rodando no Cloud Run e construir URL base
    const K_SERVICE = process.env.K_SERVICE;
    const isCloudRun = !!K_SERVICE;
    const baseUrl = isCloudRun 
      ? 'https://worker-qualidade-278491073220.us-east1.run.app'
      : `http://localhost:${PORT}`;
    
    console.log(`[${new Date().toISOString()}] [INFO] 🌐 Servidor HTTP completo na porta ${PORT}`);
    console.log(`[${new Date().toISOString()}] [INFO]    - Rota raiz: ${baseUrl}/`);
    console.log(`[${new Date().toISOString()}] [INFO]    - Health Check: ${baseUrl}/health`);
    console.log(`[${new Date().toISOString()}] [INFO]    - Observatório: ${baseUrl}/observatorio`);
    
    return basicServer;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [ERROR] ❌ Erro ao adicionar rotas: ${error.message}`);
    console.error(error.stack);
    // Não fazer exit - servidor básico continua funcionando
    return basicServer;
  }
};

/**
 * Iniciar worker
 */
const startWorker = async () => {
  try {
    addLog('INFO', '🚀 Iniciando worker...');
    addLog('INFO', '✅ Servidor HTTP já iniciado - Cloud Run pode verificar saúde');
    
    // 2. Inicializar componentes em background (não bloqueia servidor)
    // MongoDB
    initializeMongoDB().then(() => {
      addLog('INFO', '✅ MongoDB inicializado com sucesso');
    }).catch(error => {
      addLog('ERROR', `❌ Erro ao inicializar MongoDB: ${error.message}`);
      // Não travar o servidor se MongoDB falhar
    });
    
    // Pub/Sub (inicializar primeiro para ter subscription disponível)
    try {
      initializePubSub();
      addLog('INFO', '✅ Pub/Sub inicializado');
      
      subscription.on('message', processMessage);
      subscription.on('error', (error) => {
        addLog('ERROR', `❌ Erro no subscription: ${error.message}`);
      });
    } catch (error) {
      addLog('ERROR', `❌ Erro ao inicializar Pub/Sub: ${error.message}`);
      // Não travar o servidor se Pub/Sub falhar
    }
    
    // Vertex AI
    initializeVertexAI().then(({ speechClient, genAI }) => {
      speechClientInstance = speechClient;
      genAIInstance = genAI;
      addLog('INFO', '✅ Vertex AI inicializado com sucesso');
      
      // Registrar instâncias para health check quando tudo estiver pronto
      if (subscription && speechClientInstance && genAIInstance) {
        registerWorkerInstances(subscription, speechClientInstance, genAIInstance);
      }
    }).catch(error => {
      addLog('ERROR', `❌ Erro ao inicializar Vertex AI: ${error.message}`);
      // Não travar o servidor se Vertex AI falhar
    });
    
    // Tratar desconexões
    process.on('SIGINT', () => {
      addLog('WARN', '\n⚠️  Recebido SIGINT. Encerrando worker...');
      if (subscription) {
        subscription.close(() => {
          addLog('INFO', '✅ Subscription fechada');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
    
    addLog('INFO', '🚀 Worker iniciado e aguardando mensagens...');
    addLog('INFO', `📊 Configuração:`);
    addLog('INFO', `   - Projeto: ${GCP_PROJECT_ID}`);
    addLog('INFO', `   - Bucket: ${GCS_BUCKET_NAME}`);
    addLog('INFO', `   - Subscription: ${PUBSUB_SUBSCRIPTION_NAME}`);
    addLog('INFO', `   - Max Retries: ${MAX_RETRIES}`);
    
  } catch (error) {
    addLog('ERROR', `❌ Erro ao iniciar worker: ${error.message}`);
    // NÃO fazer exit(1) aqui - deixar servidor HTTP rodar para Cloud Run
    // O servidor já foi iniciado, então Cloud Run pode fazer health check
  }
};

// Handlers de erro global para evitar encerramento do processo
process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] [ERROR] ❌ Uncaught Exception: ${error.message}`);
  console.error(error.stack);
  // Não fazer exit - deixar servidor HTTP continuar rodando
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] [ERROR] ❌ Unhandled Rejection:`, reason);
  // Não fazer exit - deixar servidor HTTP continuar rodando
});

// NOTA: addRoutesToServer() e startWorker() são chamados dentro de loadWorkerModules()
// que é executado depois que o servidor básico está escutando

module.exports = {
  startWorker,
  processMessage,
  processAudio,
  initializePubSub,
  initializeMongoDB,
  getStats: () => ({ ...stats, processingMessages: Array.from(stats.processingMessages.entries()) }),
  getLogs: () => recentLogs
};

