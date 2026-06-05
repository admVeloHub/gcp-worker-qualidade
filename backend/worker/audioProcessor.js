// VERSION: v4.2.0 | DATE: 2026-06-05 | AUTHOR: VeloHub Development Team
// CHANGELOG: v4.2.0 - processPendingDocDirect retorna ok|skipped|in_flight|error (sweep não republica em in_flight)
// CHANGELOG: v4.1.1 - Porta local via WORKER da FONTE DA VERDADE (.env); Cloud Run continua PORT=8080
// CHANGELOG: v4.1.0 - Heartbeat interno; fila serial; espera GCS; mongo/sweep autonomos; erros recuperaveis por padrao
// CHANGELOG: v4.0.0 - Pipeline Gemini transcricao+analiseDialogo; GPT RAG obrigatorio; persistencia LISTA audio_analise_results
// CHANGELOG: v3.9.0 - Loop interno de fila ativa até zerar pendentes; drenagem backlog no arranque; sem depender de HTTP/observatório
// CHANGELOG: v3.8.0 - processAudioByFileName + sweep direct; deploy worker-qualidade; /worker/reconcile; Pub/Sub flowControl
// CHANGELOG: v3.7.4 - Auto-retry sweep autônomo: arranque robusto (race Mongo/PubSub); log explícito de dependências
// CHANGELOG: v3.7.3 - Dev: loadFonteVerdadeEnv (FONTE DA VERDADE/.env ou VELOHUB_DOTENV_PATH)
// CHANGELOG: v3.7.2 - Ao salvar audio_analise_results: gravar avaliacaoIA em qualidade_avaliacoes (nota consensual/fallback)
// CHANGELOG: v3.7.1 - Sucesso: remove entrada da autoRetryQueue; TLS/gRPC recuperável; comentário BACKEND_API_URL = base Skynet sem /api
// CHANGELOG: v3.7.0 - audioTreated pending|done|failed; auto-retry sweep; autoRetryQueue; logs/histórico unshift
// CHANGELOG: v3.6.0 - Buffer de logs do observatório: 50 linhas; GPT só com ENABLE_GPT_ANALYSIS=true (default off)
// CHANGELOG: v3.5.1 - Correção erro de sintaxe: removido } extra e corrigida indentação no cálculo de pontuação consensual
// Worker assíncrono para processamento de áudio via Pub/Sub

// CRÍTICO: Iniciar servidor HTTP IMEDIATAMENTE para Cloud Run
// Isso deve acontecer antes de qualquer import que possa falhar
require('../config/loadFonteVerdadeEnv').loadFrom(__dirname);

const express = require('express');
const { resolveWorkerHttpPort } = require('../config/workerPort');
const PORT = resolveWorkerHttpPort();

// Criar servidor Express básico IMEDIATAMENTE
const basicApp = express();
basicApp.use(express.json());

// Rota raiz simples - DEVE responder imediatamente para Cloud Run
basicApp.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: process.env.K_SERVICE || 'worker-qualidade',
    timestamp: new Date().toISOString()
  });
});

// Variáveis para módulos (serão carregados depois que servidor estiver pronto)
let PubSub, axios, AudioAnaliseStatus, AudioAnaliseResult, QualidadeAvaliacao;
let initializeVertexAI, runGeminiAudioAnalysis, formatTranscricaoParaTexto, retryWithExponentialBackoff;
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
    runGeminiAudioAnalysis = vertexAI.runGeminiAudioAnalysis;
    formatTranscricaoParaTexto = vertexAI.formatTranscricaoParaTexto;
    retryWithExponentialBackoff = vertexAI.retryWithExponentialBackoff;
    
    // Importar OpenAI GPT
    const openAIGPT = require('../config/openAIGPT');
    analyzeWithGPT = openAIGPT.analyzeWithGPT;
    
    // Importar routers (podem falhar se modelos não estiverem prontos)
    healthCheckRouter = require('./healthCheck');
    observatorioRouter = require('./observatorio');
    registerWorkerInstances = healthCheckRouter.registerWorkerInstances;
    console.log(`[${new Date().toISOString()}] [INFO] 📋 Observatório HTML carregado de: ${require.resolve('./observatorio')}`);
    
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
// Configuração
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'qualidade_audio_envio';
const PUBSUB_SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION_NAME || 'upload_audio_qualidade';
const PUBSUB_TOPIC_NAME = process.env.PUBSUB_TOPIC_NAME || 'qualidade_audio_envio';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
/** Origem do Skynet (sem /api). Cloud Run: definir BACKEND_API_URL nas variáveis do serviço worker. */
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const { startAutoRetrySweep, getSweepTick } = require('./audioAutoRetrySweep');
const { waitForGcsObjectReady } = require('../config/gcsStorage');

const WORKER_HEARTBEAT_MS = parseInt(process.env.WORKER_HEARTBEAT_MS || '30000', 10);
const TASK_GAP_MS = parseInt(process.env.TASK_GAP_MS || '1000', 10);

// Inicializar Pub/Sub
let pubsub;
let subscription;

// Instâncias para health check
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
  messageHistory: [],
  autoRetryQueue: []
};

const recentLogs = [];
const MAX_LOGS = 50;
let sweepStarted = false;
let mongoSucceeded = false;
let sweepWaitLogged = false;

const PENDING_WORK_ACTIVE_MS = parseInt(process.env.PENDING_WORK_ACTIVE_MS || '15000', 10);
const BACKLOG_DRAIN_MAX_ROUNDS = parseInt(process.env.BACKLOG_DRAIN_MAX_ROUNDS || '500', 10);
let pendingWorkInterval = null;
let backlogDrainRunning = false;
let heartbeatInterval = null;
let mongoInitInFlight = null;
let serialTail = Promise.resolve();

/** Uma tarefa de áudio por vez; intervalo entre conclusões. */
const enqueueSerialTask = (taskFn, label = 'task') => {
  const job = serialTail.then(async () => {
    addLog('DEBUG', `🔒 Fila serial: ${label}`);
    try {
      return await taskFn();
    } finally {
      if (TASK_GAP_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, TASK_GAP_MS));
      }
    }
  });
  serialTail = job.catch(() => {});
  return job;
};

const ensureMongoReady = async () => {
  if (mongoSucceeded) {
    return true;
  }
  if (mongoInitInFlight) {
    return mongoInitInFlight;
  }
  mongoInitInFlight = (async () => {
    try {
      await AudioAnaliseStatus.initializeConnection();
      await AudioAnaliseResult.initializeConnection();
      await QualidadeAvaliacao.initializeConnection();
      mongoSucceeded = true;
      sweepWaitLogged = false;
      addLog('INFO', '✅ MongoDB pronto (ensureMongoReady)');
      tryStartAutoRetrySweep();
      return true;
    } catch (error) {
      addLog('WARN', `ensureMongoReady: ${error.message}`);
      return false;
    } finally {
      mongoInitInFlight = null;
    }
  })();
  return mongoInitInFlight;
};

const runWorkerHeartbeatTick = async () => {
  await ensureMongoReady();
  tryStartAutoRetrySweep();
  const pending = await countMongoPendingAudio();
  if (pending > 0 || hasInFlightProcessing()) {
    await runQueueReconcileCycle();
    ensurePendingWorkLoop();
  }
};

const startWorkerHeartbeat = () => {
  if (heartbeatInterval) {
    return;
  }
  addLog(
    'INFO',
    `💓 Heartbeat interno a cada ${WORKER_HEARTBEAT_MS / 1000}s (mongo + sweep + fila — sem observatório)`
  );
  heartbeatInterval = setInterval(() => {
    runWorkerHeartbeatTick().catch((e) => addLog('ERROR', `heartbeat: ${e.message}`));
  }, WORKER_HEARTBEAT_MS);
  runWorkerHeartbeatTick().catch((e) => addLog('ERROR', `heartbeat inicial: ${e.message}`));
};

const pushAutoRetryQueue = (entry) => {
  const id = entry.avaliacaoId;
  if (id) {
    const idx = stats.autoRetryQueue.findIndex((x) => x.avaliacaoId === id);
    if (idx >= 0) stats.autoRetryQueue.splice(idx, 1);
  }
  stats.autoRetryQueue.unshift(entry);
  if (stats.autoRetryQueue.length > 50) stats.autoRetryQueue.pop();
};

const tryStartAutoRetrySweep = () => {
  if (sweepStarted) return;
  if (!mongoSucceeded || !pubsub) {
    if (!sweepWaitLogged) {
      sweepWaitLogged = true;
      addLog(
        'INFO',
        `⏳ Auto-retry sweep aguardando dependências (mongo=${mongoSucceeded}, pubsub=${!!pubsub})`
      );
    }
    return;
  }
  sweepStarted = true;
  addLog('INFO', '🔄 Iniciando auto-retry sweep em background (independente do observatório)');
  startAutoRetrySweep({
    addLog,
    recordQueue: pushAutoRetryQueue,
    getPubSub: () => pubsub,
    bucketName: GCS_BUCKET_NAME,
    processDirect: processPendingDocDirect,
    onPendingWork: (n) => signalPendingWork(`sweep:${n}`)
  });
};

const countMongoPendingAudio = async () => {
  try {
    const Model = await QualidadeAvaliacao.model();
    return await Model.countDocuments({
      audioSent: true,
      nomeArquivoAudio: { $exists: true, $nin: [null, ''] },
      $nor: [{ audioTreated: 'done' }, { audioTreated: true }, { audioTreated: 'failed' }]
    });
  } catch (e) {
    addLog('WARN', `count pendentes: ${e.message}`);
    return 0;
  }
};

const hasInFlightProcessing = () => stats.processingMessages.size > 0;

const runQueueReconcileCycle = async () => {
  const tick = getSweepTick();
  if (tick) {
    await tick();
  }
  const mongoPending = await countMongoPendingAudio();
  return mongoPending > 0 || hasInFlightProcessing();
};

const signalPendingWork = (reason) => {
  addLog('INFO', `📌 Fila com trabalho pendente (${reason}) — worker permanece ativo`);
  ensurePendingWorkLoop();
};

const ensurePendingWorkLoop = () => {
  if (pendingWorkInterval) return;
  addLog('INFO', `🔥 Loop de fila a cada ${PENDING_WORK_ACTIVE_MS / 1000}s até concluir todos os áudios`);
  pendingWorkInterval = setInterval(async () => {
    try {
      const still = await runQueueReconcileCycle();
      if (!still) {
        clearInterval(pendingWorkInterval);
        pendingWorkInterval = null;
        addLog('INFO', '✅ Nenhum áudio pendente — loop de fila encerrado');
      }
    } catch (e) {
      addLog('ERROR', `loop fila pendente: ${e.message}`);
    }
  }, PENDING_WORK_ACTIVE_MS);
};

const drainBacklogOnReady = async () => {
  if (backlogDrainRunning || !mongoSucceeded || !genAIInstance) {
    return;
  }
  backlogDrainRunning = true;
  try {
    const initial = await countMongoPendingAudio();
    if (initial === 0) {
      addLog('INFO', '📥 Arranque: nenhum áudio pendente no Mongo');
      return;
    }
    addLog('INFO', `📥 Arranque: drenando ${initial} áudio(s) pendente(s) sem aguardar observatório`);
    signalPendingWork('startup-backlog');
    let rounds = 0;
    while (rounds < BACKLOG_DRAIN_MAX_ROUNDS) {
      const still = await runQueueReconcileCycle();
      if (!still) break;
      rounds++;
      if (hasInFlightProcessing()) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    const left = await countMongoPendingAudio();
    addLog('INFO', `📥 Drenagem de arranque: ${rounds} ciclo(s), restantes=${left}`);
  } finally {
    backlogDrainRunning = false;
  }
};

const isFileCurrentlyProcessing = (fileName) => {
  for (const [, info] of stats.processingMessages) {
    if (info && info.fileName === fileName) return true;
  }
  return false;
};

/**
 * Processa um áudio pendente diretamente (sweep), sem depender do pull Pub/Sub.
 * @returns {Promise<'ok'|'skipped'|'in_flight'|'error'>}
 */
const processPendingDocDirect = async (doc) => {
  const fileName = doc.nomeArquivoAudio;
  if (!fileName) {
    return 'error';
  }
  if (isFileCurrentlyProcessing(fileName)) {
    return 'in_flight';
  }
  await ensureMongoReady();
  if (!genAIInstance) {
    return 'error';
  }
  try {
    const outcome = await enqueueSerialTask(
      () =>
        processAudioByFileName(fileName, GCS_BUCKET_NAME, {
          messageId: `sweep-${doc._id}-${Date.now()}`,
          source: 'sweep'
        }),
      `sweep:${fileName}`
    );
    if (outcome === 'ok') return 'ok';
    if (outcome === 'skipped') return 'skipped';
    return 'error';
  } catch (e) {
    addLog('ERROR', `sweep direct ${fileName}: ${e.message}`);
    return 'error';
  }
};

const addLog = (level, message) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  recentLogs.unshift(logEntry);
  if (recentLogs.length > MAX_LOGS) {
    recentLogs.pop();
  }
  console.log(`[${logEntry.timestamp}] [${level}] ${message}`);
};

/** Sweep grava mode=scheduled no tick; ao concluir Pub/Sub com sucesso o doc some da query mas a entrada em memória permanecia — limpa aqui. */
const removeAutoRetryQueueForAvaliacao = (avaliacao) => {
  if (!stats.autoRetryQueue.length || !avaliacao || avaliacao._id == null) return;
  const id = String(avaliacao._id);
  const before = stats.autoRetryQueue.length;
  stats.autoRetryQueue = stats.autoRetryQueue.filter((x) => x.avaliacaoId !== id);
  if (stats.autoRetryQueue.length !== before) {
    addLog('DEBUG', `🧹 Fila observatório: removido avaliacaoId=${id}`);
  }
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
    subscription.setOptions({
      flowControl: {
        maxMessages: 1,
        allowExcessMessages: false
      }
    });

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
    'nome do arquivo não encontrado na mensagem'
  ];

  if (nonRecoverablePatterns.some((pattern) => errorMessage.includes(pattern))) {
    return false;
  }

  // Demais falhas (transcrição vazia, GCS ainda não pronto, Gemini/GPT, rede) → nack / sweep retenta
  return true;
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

    addLog('INFO', '📝 Passo 1: Gemini — transcrição e analiseDialogo...');
    const geminiResult = await retryWithExponentialBackoff(
      () => runGeminiAudioAnalysis(gcsUri, fileName),
      MAX_RETRIES
    );

    addLog('INFO', `✅ Gemini concluído: ${geminiResult.transcricao.length} turnos`);

    const transcricaoTexto = formatTranscricaoParaTexto(geminiResult.transcricao);
    if (!transcricaoTexto || transcricaoTexto.trim().length === 0) {
      throw new Error('Transcrição vazia após formatação');
    }

    addLog('INFO', '🤖 Passo 2: GPT — auditoria técnica com RAG...');
    const gptResult = await retryWithExponentialBackoff(
      () => analyzeWithGPT(transcricaoTexto),
      MAX_RETRIES
    );

    addLog('INFO', '✅ Análise GPT (RAG) concluída');

    const processingTime = (Date.now() - startTime) / 1000;
    addLog('INFO', `✅ Processamento completo em ${processingTime.toFixed(2)}s`);

    return {
      transcricao: geminiResult.transcricao,
      analiseDialogo: geminiResult.analiseDialogo,
      criteriosDetalhados: gptResult.criteriosDetalhados,
      palavrasCriticas: gptResult.palavrasCriticas,
      observacaoGPT: gptResult.observacaoGPT,
      processingTime
    };
  } catch (error) {
    addLog('ERROR', `❌ Erro ao processar áudio: ${error.message}`);
    throw error;
  }
};

/**
 * Processa um arquivo de áudio (Pub/Sub ou sweep direto).
 * @returns {Promise<'ok'|'skipped'>}
 */
const processAudioByFileName = async (fileName, bucketName, { messageId, source = 'pubsub' } = {}) => {
  const jobId = messageId || `${source}-${fileName}-${Date.now()}`;
  const gcsUri = `gs://${bucketName}/${fileName}`;

  addLog('INFO', `🔄 Processando arquivo (${source}): ${fileName}`);
  addLog('DEBUG', `📍 GCS URI: ${gcsUri}`);

  await ensureMongoReady();
  if (!genAIInstance) {
    throw new Error('Gemini ainda não inicializado — aguarde e tente novamente');
  }

  addLog('INFO', `⏳ Aguardando objeto GCS estar pronto: ${fileName}`);
  const gcsReady = await waitForGcsObjectReady(bucketName, fileName);
  addLog('INFO', `✅ GCS pronto (${gcsReady.size} bytes, tentativa ${gcsReady.attempt})`);

  stats.processingMessages.set(jobId, {
    fileName,
    startTime: Date.now()
  });

  let avaliacao = null;

  try {
    const ResultModel = await AudioAnaliseResult.model();
    const existingResult = await ResultModel.findOne({ nomeArquivoAudio: fileName });

    if (existingResult) {
      addLog('INFO', `ℹ️  Arquivo ${fileName} já foi processado anteriormente. Ignorando.`);
      messageRetries.delete(jobId);
      stats.processingMessages.delete(jobId);
      return 'skipped';
    }

    const QualidadeAvaliacaoModel = await QualidadeAvaliacao.model();
    avaliacao = await QualidadeAvaliacaoModel.findOne({ nomeArquivoAudio: fileName });

    if (!avaliacao) {
      const error = new Error(
        `Avaliação não encontrada para arquivo ${fileName}. O arquivo deve estar associado a uma avaliação existente.`
      );
      messageRetries.delete(jobId);
      stats.processingMessages.delete(jobId);
      if (source === 'pubsub') {
        throw error;
      }
      addLog('WARN', `⚠️  ${error.message}`);
      return 'skipped';
    }

    if (avaliacao.audioTreated === 'done' || avaliacao.audioTreated === true) {
      addLog('INFO', `ℹ️  Arquivo ${fileName} já foi processado para avaliação ${avaliacao._id}. Ignorando.`);
      messageRetries.delete(jobId);
      stats.processingMessages.delete(jobId);
      return 'skipped';
    }

    addLog('INFO', `✅ Avaliação encontrada: ${avaliacao._id} para arquivo: ${fileName}`);

    const timestampInicio = new Date();
    const analysisResult = await processAudio(gcsUri, fileName);
    const timestampFim = new Date();

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
    
    const criteriosDetalhados = { ...analysisResult.criteriosDetalhados };
    copiarCritériosNaoVerificaveis(criteriosDetalhados);
    const pontuacaoCalculada = calcularPontuacao(criteriosDetalhados);

    const audioResult = new ResultModel({
      avaliacao_id: avaliacao._id,
      nomeArquivoAudio: fileName,
      transcricao: analysisResult.transcricao,
      analiseDialogo: analysisResult.analiseDialogo,
      criteriosDetalhados,
      pontuacaoCalculada,
      palavrasCriticas: analysisResult.palavrasCriticas || [],
      observacaoGPT: analysisResult.observacaoGPT || '',
      timestampInicio,
      timestampFim
    });

    await audioResult.save();
    addLog('INFO', `✅ Resultado salvo no MongoDB: ${audioResult._id}`);

    const notaIA = pontuacaoCalculada != null ? Number(pontuacaoCalculada) : NaN;
    if (!Number.isNaN(notaIA)) {
      avaliacao.avaliacaoIA = notaIA;
    }

    avaliacao.audioTreated = 'done';
    avaliacao.audioUpdatedAt = new Date();
    await avaliacao.save();
    addLog('INFO', `✅ Status atualizado: audioTreated=done para avaliacaoId: ${avaliacao._id}`);
    removeAutoRetryQueueForAvaliacao(avaliacao);

    // Notificar backend API sobre conclusão (dispara evento SSE)
    await notifyBackendCompletion(avaliacao._id.toString());

    // Atualizar estatísticas
    stats.totalProcessed++;
    stats.totalSuccess++;
    stats.lastMessageTime = Date.now();
    
    const processingInfo = stats.processingMessages.get(jobId);
    const processingTime = processingInfo ? (Date.now() - processingInfo.startTime) / 1000 : 0;

    stats.messageHistory.unshift({
      messageId: jobId,
      fileName,
      status: 'success',
      processingTime,
      timestamp: new Date().toISOString()
    });
    if (stats.messageHistory.length > 50) stats.messageHistory.pop();

    messageRetries.delete(jobId);
    stats.processingMessages.delete(jobId);

    addLog('INFO', `✅ Processamento concluído (${source}) [ID: ${jobId}]`);
    return 'ok';
  } catch (error) {
    messageRetries.delete(jobId);
    stats.processingMessages.delete(jobId);
    addLog('ERROR', `❌ Erro ao processar ${fileName} (${source}) [ID: ${jobId}]: ${error.message}`);
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
    signalPendingWork('pubsub-message');

    const data = JSON.parse(message.data.toString());
    addLog('DEBUG', `📋 Dados da mensagem: ${JSON.stringify(data, null, 2)}`);

    const fileName = data.name || data.object || data.fileName;
    const bucketName = data.bucket || data.bucketName || GCS_BUCKET_NAME;

    if (!fileName) {
      throw new Error('Nome do arquivo não encontrado na mensagem');
    }

    const outcome = await enqueueSerialTask(
      () =>
        processAudioByFileName(fileName, bucketName, {
          messageId,
          source: 'pubsub'
        }),
      `pubsub:${fileName}`
    );

    message.ack();
    if (outcome === 'ok') {
      addLog('INFO', `✅ Mensagem processada e confirmada [ID: ${messageId}]`);
    }
    return;
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
      
      stats.messageHistory.unshift({
        messageId,
        fileName: processingInfo?.fileName || 'unknown',
        status: 'failed',
        error: error.message,
        processingTime,
        timestamp: new Date().toISOString()
      });
      if (stats.messageHistory.length > 50) stats.messageHistory.pop();
      
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
      
      stats.messageHistory.unshift({
        messageId,
        fileName: processingInfo?.fileName || 'unknown',
        status: 'failed',
        error: error.message,
        processingTime,
        timestamp: new Date().toISOString()
      });
      if (stats.messageHistory.length > 50) stats.messageHistory.pop();
      
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
  addLog('INFO', '🔄 Inicializando conexão MongoDB...');
  const ok = await ensureMongoReady();
  if (!ok) {
    addLog('ERROR', '❌ Erro ao inicializar MongoDB na primeira tentativa (heartbeat retentará)');
  }
  return ok;
};

/**
 * Adicionar rotas adicionais ao servidor básico já criado
 */
const addRoutesToServer = () => {
  try {
    basicApp.post('/worker/reconcile', async (req, res) => {
      try {
        const tick = getSweepTick();
        if (!tick) {
          tryStartAutoRetrySweep();
          return res.status(503).json({
            ok: false,
            reason: 'sweep_not_started',
            service: process.env.K_SERVICE || null
          });
        }
        await tick();
        res.json({
          ok: true,
          service: process.env.K_SERVICE || null,
          sweepStarted,
          mongoSucceeded,
          pubsubReady: !!pubsub
        });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    basicApp.get('/worker/reconcile', async (req, res) => {
      try {
        const tick = getSweepTick();
        if (!tick) {
          tryStartAutoRetrySweep();
          return res.status(503).json({
            ok: false,
            reason: 'sweep_not_started',
            service: process.env.K_SERVICE || null
          });
        }
        await tick();
        res.json({
          ok: true,
          service: process.env.K_SERVICE || null,
          sweepStarted,
          mongoSucceeded,
          pubsubReady: !!pubsub
        });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

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
    addLog('INFO', `☁️  Serviço Cloud Run: ${process.env.K_SERVICE || '(local)'}`);
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
      tryStartAutoRetrySweep();
      
      subscription.on('message', processMessage);
      subscription.on('error', (error) => {
        addLog('ERROR', `❌ Erro no subscription: ${error.message}`);
      });
    } catch (error) {
      addLog('ERROR', `❌ Erro ao inicializar Pub/Sub: ${error.message}`);
      // Não travar o servidor se Pub/Sub falhar
    }
    
    const openAIGPT = require('../config/openAIGPT');
    openAIGPT.initializeOpenAI().catch((error) => {
      addLog('ERROR', `❌ Erro ao inicializar OpenAI: ${error.message}`);
    });

    // Gemini Enterprise (ADC)
    initializeVertexAI().then(({ genAI }) => {
      genAIInstance = genAI;
      addLog('INFO', '✅ Gemini Enterprise inicializado com sucesso');
      tryStartAutoRetrySweep();
      drainBacklogOnReady().catch((e) => {
        addLog('ERROR', `drenagem backlog: ${e.message}`);
      });

      if (subscription && genAIInstance) {
        registerWorkerInstances(subscription, genAIInstance);
      }
    }).catch(error => {
      addLog('ERROR', `❌ Erro ao inicializar Gemini: ${error.message}`);
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
    
    startWorkerHeartbeat();

    addLog('INFO', '🚀 Worker iniciado e aguardando mensagens...');
    addLog('INFO', `📊 Configuração:`);
    addLog('INFO', `   - Projeto: ${GCP_PROJECT_ID}`);
    addLog('INFO', `   - Bucket: ${GCS_BUCKET_NAME}`);
    addLog('INFO', `   - Subscription: ${PUBSUB_SUBSCRIPTION_NAME}`);
    addLog('INFO', `   - Max Retries: ${MAX_RETRIES}`);
    addLog('INFO', `   - Heartbeat: ${WORKER_HEARTBEAT_MS}ms | Gap serial: ${TASK_GAP_MS}ms | Pub/Sub maxMessages: 1`);
    
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
  getStats: () => ({
    ...stats,
    processingMessages: Array.from(stats.processingMessages.entries()),
    autoRetryQueue: stats.autoRetryQueue || [],
    queueLoopActive: !!pendingWorkInterval,
    cloudRunService: process.env.K_SERVICE || null
  }),
  getLogs: () => recentLogs,
  ensureMongoReady,
  runWorkerHeartbeatTick
};

