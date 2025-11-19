// VERSION: v1.0.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
// Health check endpoint para monitoramento do worker

const express = require('express');
const AudioAnaliseStatus = require('../models/AudioAnaliseStatus');
const AudioAnaliseResult = require('../models/AudioAnaliseResult');

const router = express.Router();

/**
 * Verificar status da conexão MongoDB
 */
const checkMongoDB = async () => {
  try {
    const statusConnection = await AudioAnaliseStatus.initializeConnection();
    const resultConnection = await AudioAnaliseResult.initializeConnection();
    
    const statusReady = statusConnection.readyState === 1;
    const resultReady = resultConnection.readyState === 1;
    
    return {
      status: statusReady && resultReady ? 'healthy' : 'unhealthy',
      statusConnection: {
        readyState: statusConnection.readyState,
        host: statusConnection.host,
        name: statusConnection.name
      },
      resultConnection: {
        readyState: resultConnection.readyState,
        host: resultConnection.host,
        name: resultConnection.name
      }
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
};

/**
 * Verificar status do Pub/Sub
 */
const checkPubSub = (subscription) => {
  try {
    if (!subscription) {
      return {
        status: 'not_initialized',
        error: 'Subscription não inicializada'
      };
    }
    
    return {
      status: 'healthy',
      subscriptionName: subscription.name
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
};

/**
 * Verificar status do Vertex AI
 */
const checkVertexAI = (speechClient, genAI) => {
  try {
    const speechStatus = speechClient ? 'initialized' : 'not_initialized';
    const geminiStatus = genAI ? 'initialized' : 'not_initialized';
    
    return {
      status: speechClient && genAI ? 'healthy' : 'partial',
      speechClient: speechStatus,
      geminiAI: geminiStatus
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
};

// Variáveis globais para acesso às instâncias do worker
let workerSubscription = null;
let workerSpeechClient = null;
let workerGenAI = null;

/**
 * Registrar instâncias do worker para health check
 */
const registerWorkerInstances = (subscription, speechClient, genAI) => {
  workerSubscription = subscription;
  workerSpeechClient = speechClient;
  workerGenAI = genAI;
};

/**
 * Endpoint de health check
 */
router.get('/health', async (req, res) => {
  try {
    const { getStats } = require('./audioProcessor');
    const stats = getStats();
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    
    // Verificar componentes
    const mongoStatus = await checkMongoDB();
    
    // Verificar Pub/Sub
    const pubsubStatus = checkPubSub(workerSubscription);
    
    // Verificar Vertex AI
    const vertexStatus = checkVertexAI(workerSpeechClient, workerGenAI);
    
    // Calcular taxa de sucesso
    const successRate = stats.totalProcessed > 0 
      ? ((stats.totalSuccess / stats.totalProcessed) * 100).toFixed(2)
      : 0;
    
    // Determinar status geral
    const overallStatus = 
      mongoStatus.status === 'healthy' &&
      pubsubStatus.status === 'healthy' &&
      vertexStatus.status === 'healthy'
        ? 'healthy'
        : 'degraded';
    
    const healthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: uptime,
        formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`
      },
      components: {
        mongodb: mongoStatus,
        pubsub: pubsubStatus,
        vertexAI: vertexStatus
      },
      statistics: {
        totalProcessed: stats.totalProcessed,
        totalSuccess: stats.totalSuccess,
        totalFailed: stats.totalFailed,
        successRate: `${successRate}%`,
        currentlyProcessing: stats.processingMessages.length,
        lastMessageTime: stats.lastMessageTime 
          ? new Date(stats.lastMessageTime).toISOString()
          : null
      }
    };
    
    const statusCode = overallStatus === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthData);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
module.exports.registerWorkerInstances = registerWorkerInstances;

