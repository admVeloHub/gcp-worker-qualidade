// VERSION: v2.2.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
// Worker assíncrono para processamento de áudio via Pub/Sub

const { PubSub } = require('@google-cloud/pubsub');
const axios = require('axios');
const express = require('express');
const AudioAnaliseStatus = require('../models/AudioAnaliseStatus');
const AudioAnaliseResult = require('../models/AudioAnaliseResult');
const {
  initializeVertexAI,
  transcribeAudio,
  analyzeEmotionAndNuance,
  crossReferenceOutputs,
  retryWithExponentialBackoff
} = require('../config/vertexAI');
const healthCheckRouter = require('./healthCheck');
const observatorioRouter = require('./observatorio');
const { registerWorkerInstances } = healthCheckRouter;
require('dotenv').config();

// Configuração
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'qualidade_audio_envio';
const PUBSUB_SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION_NAME || 'upload_audio_qualidade';
const PUBSUB_TOPIC_NAME = process.env.PUBSUB_TOPIC_NAME || 'qualidade_audio_envio';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const PORT = process.env.PORT || 8080;

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
 * Notificar backend API sobre conclusão do processamento
 * @param {string} audioId - ID do registro de status
 */
const notifyBackendCompletion = async (audioId) => {
  try {
    const response = await axios.post(`${BACKEND_API_URL}/api/audio-analise/notify-completed`, {
      audioId: audioId
    }, {
      timeout: 5000
    });
    
    console.log(`✅ Backend notificado sobre conclusão: ${audioId}`);
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
    
    // 2. Analisar emoção e nuance com retry
    addLog('INFO', '🧠 Passo 2: Analisando emoção e nuance...');
    const emotionResult = await retryWithExponentialBackoff(
      () => analyzeEmotionAndNuance(transcriptionResult.transcription, transcriptionResult.timestamps),
      MAX_RETRIES
    );
    
    addLog('INFO', `✅ Análise de emoção concluída. Pontuação: ${emotionResult.pontuacaoGPT}`);
    
    // 3. Cruzar outputs
    addLog('INFO', '🔗 Passo 3: Cruzando outputs...');
    const crossReferenced = crossReferenceOutputs(transcriptionResult, emotionResult);
    
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
  let audioStatus = null;
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

    // Buscar registro de status no MongoDB
    audioStatus = await AudioAnaliseStatus.findByNomeArquivo(fileName);
    
    if (!audioStatus) {
      addLog('WARN', `⚠️  Registro de status não encontrado para: ${fileName}`);
      // Criar registro se não existir
      const StatusModel = await AudioAnaliseStatus.model();
      audioStatus = new StatusModel({
        nomeArquivo: fileName,
        sent: true,
        treated: false
      });
      await audioStatus.save();
      addLog('INFO', `✅ Registro de status criado: ${audioStatus._id}`);
    }

    // Processar áudio
    const analysisResult = await processAudio(gcsUri, fileName);

    // Salvar resultado no MongoDB
    const ResultModel = await AudioAnaliseResult.model();
    const audioResult = new ResultModel({
      audioStatusId: audioStatus._id,
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
      processingTime: analysisResult.processingTime
    });

    await audioResult.save();
    addLog('INFO', `✅ Resultado salvo no MongoDB: ${audioResult._id}`);

    // Atualizar status para treated=true
    await audioStatus.marcarComoTratado();
    addLog('INFO', `✅ Status atualizado: treated=true para audioId: ${audioStatus._id}`);

    // Notificar backend API sobre conclusão (dispara evento SSE)
    await notifyBackendCompletion(audioStatus._id.toString());

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
    
    retryCount++;
    messageRetries.set(messageId, retryCount);
    
    // Se excedeu máximo de retries, enviar para Dead Letter Queue ou marcar como erro
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
      
      // Marcar como erro no status se existir
      if (audioStatus) {
        addLog('ERROR', `⚠️  Status não atualizado para audioId: ${audioStatus._id}`);
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
    await AudioAnaliseStatus.initializeConnection();
    await AudioAnaliseResult.initializeConnection();
    addLog('INFO', '✅ MongoDB inicializado com sucesso');
    return true;
  } catch (error) {
    addLog('ERROR', `❌ Erro ao inicializar MongoDB: ${error.message}`);
    throw error;
  }
};

/**
 * Iniciar servidor HTTP para health check e observatório
 */
const startHttpServer = () => {
  const app = express();
  
  // Middleware
  app.use(express.json());
  
  // Rotas
  app.use('/', healthCheckRouter);
  app.use('/', observatorioRouter);
  
  // Detectar se está rodando no Cloud Run e construir URL base
  const K_SERVICE = process.env.K_SERVICE;
  const isCloudRun = !!K_SERVICE;
  const baseUrl = isCloudRun 
    ? 'https://worker-qualidade-278491073220.us-east1.run.app'
    : `http://localhost:${PORT}`;
  
  // Iniciar servidor
  const server = app.listen(PORT, () => {
    addLog('INFO', `🌐 Servidor HTTP iniciado na porta ${PORT}`);
    addLog('INFO', `   - Health Check: ${baseUrl}/health`);
    addLog('INFO', `   - Observatório: ${baseUrl}/observatorio`);
  });
  
  return server;
};

/**
 * Iniciar worker
 */
const startWorker = async () => {
  try {
    addLog('INFO', '🚀 Iniciando worker...');
    
    // 1. INICIAR SERVIDOR HTTP PRIMEIRO (crítico para Cloud Run health check)
    startHttpServer();
    addLog('INFO', '✅ Servidor HTTP iniciado - Cloud Run pode verificar saúde');
    
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

// Iniciar worker se executado diretamente
if (require.main === module) {
  startWorker();
}

module.exports = {
  startWorker,
  processMessage,
  processAudio,
  initializePubSub,
  initializeMongoDB,
  getStats: () => ({ ...stats, processingMessages: Array.from(stats.processingMessages.entries()) }),
  getLogs: () => recentLogs
};

