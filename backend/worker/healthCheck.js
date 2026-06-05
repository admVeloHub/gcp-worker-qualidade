// VERSION: v1.2.0 | DATE: 2026-06-03 | AUTHOR: VeloHub Development Team
// CHANGELOG: v1.2.0 - /health chama ensureMongoReady (religa sweep se Mongo conectou tarde)
// CHANGELOG: v1.1.0 - Health check Gemini Enterprise (ADC); remove Speech-to-Text
const express = require('express');
const AudioAnaliseStatus = require('../models/AudioAnaliseStatus');
const AudioAnaliseResult = require('../models/AudioAnaliseResult');

const router = express.Router();

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

const checkGemini = (genAI) => {
  try {
    const geminiStatus = genAI ? 'initialized' : 'not_initialized';

    return {
      status: genAI ? 'healthy' : 'not_initialized',
      geminiClient: geminiStatus
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
};

let workerSubscription = null;
let workerGenAI = null;

const registerWorkerInstances = (subscription, genAI) => {
  workerSubscription = subscription;
  workerGenAI = genAI;
};

router.get('/health', async (req, res) => {
  try {
    const { getStats, ensureMongoReady } = require('./audioProcessor');
    await ensureMongoReady();
    const stats = getStats();
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);

    const mongoStatus = await checkMongoDB();
    const pubsubStatus = checkPubSub(workerSubscription);
    const geminiStatus = checkGemini(workerGenAI);

    const successRate =
      stats.totalProcessed > 0
        ? ((stats.totalSuccess / stats.totalProcessed) * 100).toFixed(2)
        : 0;

    const overallStatus =
      mongoStatus.status === 'healthy' &&
      pubsubStatus.status === 'healthy' &&
      geminiStatus.status === 'healthy'
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
        gemini: geminiStatus
      },
      statistics: {
        totalProcessed: stats.totalProcessed,
        totalSuccess: stats.totalSuccess,
        totalFailed: stats.totalFailed,
        successRate: `${successRate}%`,
        currentlyProcessing: stats.processingMessages.size,
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
