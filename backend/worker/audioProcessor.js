// VERSION: v2.0.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
// Worker assíncrono para processamento de áudio via Pub/Sub

const { PubSub } = require('@google-cloud/pubsub');
const axios = require('axios');
const AudioAnaliseStatus = require('../models/AudioAnaliseStatus');
const AudioAnaliseResult = require('../models/AudioAnaliseResult');
const {
  initializeVertexAI,
  transcribeAudio,
  analyzeEmotionAndNuance,
  crossReferenceOutputs,
  retryWithExponentialBackoff
} = require('../config/vertexAI');
require('dotenv').config();

// Configuração
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'qualidade_audio_envio';
const PUBSUB_SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION_NAME || 'upoad_audio_qualidade';
const PUBSUB_TOPIC_NAME = process.env.PUBSUB_TOPIC_NAME || 'qualidade_audio_envio';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';

// Inicializar Pub/Sub
let pubsub;
let subscription;

// Contador de tentativas por mensagem
const messageRetries = new Map();

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
    console.log(`🎵 Iniciando processamento de áudio: ${fileName}`);
    
    // 1. Transcrever áudio com retry
    console.log('📝 Passo 1: Transcrevendo áudio...');
    const transcriptionResult = await retryWithExponentialBackoff(
      () => transcribeAudio(gcsUri, 'pt-BR'),
      MAX_RETRIES
    );
    
    if (!transcriptionResult.transcription || transcriptionResult.transcription.length === 0) {
      throw new Error('Transcrição vazia ou inválida');
    }
    
    console.log(`✅ Transcrição concluída: ${transcriptionResult.transcription.length} caracteres`);
    
    // 2. Analisar emoção e nuance com retry
    console.log('🧠 Passo 2: Analisando emoção e nuance...');
    const emotionResult = await retryWithExponentialBackoff(
      () => analyzeEmotionAndNuance(transcriptionResult.transcription, transcriptionResult.timestamps),
      MAX_RETRIES
    );
    
    console.log(`✅ Análise de emoção concluída. Pontuação: ${emotionResult.pontuacaoGPT}`);
    
    // 3. Cruzar outputs
    console.log('🔗 Passo 3: Cruzando outputs...');
    const crossReferenced = crossReferenceOutputs(transcriptionResult, emotionResult);
    
    const processingTime = (Date.now() - startTime) / 1000;
    crossReferenced.processingTime = processingTime;
    
    console.log(`✅ Processamento completo em ${processingTime.toFixed(2)}s`);
    
    return crossReferenced;
  } catch (error) {
    console.error('❌ Erro ao processar áudio:', error);
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
    console.log(`📨 Mensagem recebida do Pub/Sub [ID: ${messageId}]`);
    
    // Parse da mensagem do GCS
    const data = JSON.parse(message.data.toString());
    console.log('📋 Dados da mensagem:', JSON.stringify(data, null, 2));

    // Extrair informações do evento GCS
    const fileName = data.name || data.object || data.fileName;
    const bucketName = data.bucket || data.bucketName || GCS_BUCKET_NAME;
    
    if (!fileName) {
      throw new Error('Nome do arquivo não encontrado na mensagem');
    }

    // Construir URI do GCS
    const gcsUri = `gs://${bucketName}/${fileName}`;
    console.log(`🔄 Processando arquivo: ${fileName}`);
    console.log(`📍 GCS URI: ${gcsUri}`);

    // Buscar registro de status no MongoDB
    audioStatus = await AudioAnaliseStatus.findByNomeArquivo(fileName);
    
    if (!audioStatus) {
      console.warn(`⚠️  Registro de status não encontrado para: ${fileName}`);
      // Criar registro se não existir
      audioStatus = new AudioAnaliseStatus({
        nomeArquivo: fileName,
        sent: true,
        treated: false
      });
      await audioStatus.save();
      console.log(`✅ Registro de status criado: ${audioStatus._id}`);
    }

    // Processar áudio
    const analysisResult = await processAudio(gcsUri, fileName);

    // Salvar resultado no MongoDB
    const audioResult = new AudioAnaliseResult({
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
    console.log(`✅ Resultado salvo no MongoDB: ${audioResult._id}`);

    // Atualizar status para treated=true
    await audioStatus.marcarComoTratado();
    console.log(`✅ Status atualizado: treated=true para audioId: ${audioStatus._id}`);

    // Notificar backend API sobre conclusão (dispara evento SSE)
    await notifyBackendCompletion(audioStatus._id.toString());

    // Limpar contador de retries
    messageRetries.delete(messageId);

    // Confirmar mensagem processada
    message.ack();
    console.log(`✅ Mensagem processada e confirmada [ID: ${messageId}]`);
    
  } catch (error) {
    console.error(`❌ Erro ao processar mensagem [ID: ${messageId}]:`, error);
    
    retryCount++;
    messageRetries.set(messageId, retryCount);
    
    // Se excedeu máximo de retries, enviar para Dead Letter Queue ou marcar como erro
    if (retryCount >= MAX_RETRIES) {
      console.error(`❌ Máximo de tentativas excedido para mensagem [ID: ${messageId}]. Enviando para DLQ.`);
      
      // Marcar como erro no status se existir
      if (audioStatus) {
        // Poderia adicionar campo de erro no schema se necessário
        console.error(`⚠️  Status não atualizado para audioId: ${audioStatus._id}`);
      }
      
      // Nack sem modificar deadline para enviar para DLQ
      message.nack();
      messageRetries.delete(messageId);
    } else {
      // Retry com exponential backoff
      const delay = 1000 * Math.pow(2, retryCount - 1);
      console.log(`⏳ Retry ${retryCount}/${MAX_RETRIES} em ${delay}ms...`);
      
      setTimeout(() => {
        message.nack();
      }, delay);
    }
  }
};

/**
 * Iniciar worker
 */
const startWorker = () => {
  try {
    // Inicializar Vertex AI
    initializeVertexAI();
    
    // Inicializar Pub/Sub
    initializePubSub();
    
    // Escutar mensagens
    subscription.on('message', processMessage);
    
    // Tratar erros
    subscription.on('error', (error) => {
      console.error('❌ Erro no subscription:', error);
    });
    
    // Tratar desconexões
    process.on('SIGINT', () => {
      console.log('\n⚠️  Recebido SIGINT. Encerrando worker...');
      subscription.close(() => {
        console.log('✅ Subscription fechada');
        process.exit(0);
      });
    });
    
    console.log('🚀 Worker iniciado e aguardando mensagens...');
    console.log(`📊 Configuração:`);
    console.log(`   - Projeto: ${GCP_PROJECT_ID}`);
    console.log(`   - Bucket: ${GCS_BUCKET_NAME}`);
    console.log(`   - Subscription: ${PUBSUB_SUBSCRIPTION_NAME}`);
    console.log(`   - Max Retries: ${MAX_RETRIES}`);
    
  } catch (error) {
    console.error('❌ Erro ao iniciar worker:', error);
    process.exit(1);
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
  initializePubSub
};

