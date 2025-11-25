// VERSION: v2.0.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
const mongoose = require('mongoose');
const { getSecret } = require('../config/secrets');

// Configurar conexão específica para console_analises
let MONGODB_URI;
const ANALISES_DB_NAME = process.env.CONSOLE_ANALISES_DB || 'console_analises';

// Variável para armazenar a conexão
let analisesConnection;
let connectionPromise;

/**
 * Inicializar conexão MongoDB usando Secret Manager
 * @returns {Promise<mongoose.Connection>}
 */
const initializeConnection = async () => {
  if (analisesConnection && analisesConnection.readyState === 1) {
    return analisesConnection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      // Buscar URI do MongoDB - verificar env var primeiro, depois Secret Manager
      if (!MONGODB_URI) {
        if (process.env.MONGO_ENV) {
          MONGODB_URI = process.env.MONGO_ENV;
          console.log('✅ MongoDB URI encontrada em variáveis de ambiente');
        } else {
          MONGODB_URI = await getSecret('MONGO_ENV');
        }
      }

      // Criar conexão específica para análises
      analisesConnection = mongoose.createConnection(MONGODB_URI, {
        dbName: ANALISES_DB_NAME
      });

      // Aguardar conexão estar pronta
      await new Promise((resolve, reject) => {
        analisesConnection.on('connected', () => {
          console.log('✅ Conexão MongoDB (AudioAnaliseResult) estabelecida');
          resolve();
        });

        analisesConnection.on('error', (error) => {
          console.error('❌ Erro na conexão MongoDB (AudioAnaliseResult):', error);
          reject(error);
        });

        // Se já estiver conectado, resolver imediatamente
        if (analisesConnection.readyState === 1) {
          resolve();
        }
      });

      return analisesConnection;
    } catch (error) {
      connectionPromise = null;
      throw error;
    }
  })();

  return connectionPromise;
};

// Schema para critérios de qualidade
const criteriosQualidadeSchema = new mongoose.Schema({
  saudacaoAdequada: { type: Boolean, default: false },
  escutaAtiva: { type: Boolean, default: false },
  clarezaObjetividade: { type: Boolean, default: false },
  resolucaoQuestao: { type: Boolean, default: false },
  dominioAssunto: { type: Boolean, default: false },
  empatiaCordialidade: { type: Boolean, default: false },
  direcionouPesquisa: { type: Boolean, default: false },
  procedimentoIncorreto: { type: Boolean, default: false },
  encerramentoBrusco: { type: Boolean, default: false }
}, { _id: false });

// Schema para timestamps das palavras
const timestampSchema = new mongoose.Schema({
  word: String,
  startTime: Number,
  endTime: Number
}, { _id: false });

// Schema para análise de emoção
const emotionSchema = new mongoose.Schema({
  tom: String,
  empatia: Number,
  profissionalismo: Number
}, { _id: false });

// Schema para nuance
const nuanceSchema = new mongoose.Schema({
  clareza: Number,
  tensao: Number
}, { _id: false });

// Schema principal para resultados da análise de áudio
const audioAnaliseResultSchema = new mongoose.Schema({
  avaliacaoMonitorId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'QualidadeAvaliacao'
  },
  nomeArquivo: {
    type: String,
    required: true,
    trim: true
  },
  gcsUri: {
    type: String,
    required: true
  },
  transcription: {
    type: String,
    required: true
  },
  timestamps: [timestampSchema],
  emotion: emotionSchema,
  nuance: nuanceSchema,
  qualityAnalysis: {
    criterios: criteriosQualidadeSchema,
    pontuacao: {
      type: Number,
      min: -160,
      max: 100
    },
    confianca: {
      type: Number,
      min: 0,
      max: 100
    },
    palavrasCriticas: [String],
    calculoDetalhado: [String],
    analysis: String
  },
  gptAnalysis: {
    criterios: criteriosQualidadeSchema,
    pontuacao: {
      type: Number,
      min: -160,
      max: 100
    },
    palavrasCriticas: [String],
    recomendacoes: [String],
    confianca: {
      type: Number,
      min: 0,
      max: 100
    },
    validacaoGemini: {
      concorda: Boolean,
      diferencas: [String]
    },
    analysis: String
  },
  pontuacaoConsensual: {
    type: Number,
    min: -160,
    max: 100
  },
  processingTime: {
    type: Number // em segundos
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'audio_analise_results'
});

// Índices
audioAnaliseResultSchema.index({ avaliacaoMonitorId: 1 });
audioAnaliseResultSchema.index({ nomeArquivo: 1 });
audioAnaliseResultSchema.index({ createdAt: -1 });

// Função para obter o modelo (garante que a conexão está inicializada)
const getModel = async () => {
  const connection = await initializeConnection();
  return connection.model('AudioAnaliseResult', audioAnaliseResultSchema);
};

// Modelo (será inicializado quando necessário)
let AudioAnaliseResultModel;

/**
 * Obter modelo AudioAnaliseResult
 * @returns {Promise<mongoose.Model>}
 */
const AudioAnaliseResult = {
  async model() {
    if (!AudioAnaliseResultModel) {
      const connection = await initializeConnection();
      AudioAnaliseResultModel = connection.model('AudioAnaliseResult', audioAnaliseResultSchema);
    }
    return AudioAnaliseResultModel;
  }
};

module.exports = AudioAnaliseResult;
module.exports.initializeConnection = initializeConnection;

