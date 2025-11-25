// VERSION: v1.0.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
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
          console.log('✅ Conexão MongoDB (QualidadeAvaliacao) estabelecida');
          resolve();
        });

        analisesConnection.on('error', (error) => {
          console.error('❌ Erro na conexão MongoDB (QualidadeAvaliacao):', error);
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

// Schema principal para qualidade_avaliacoes
const qualidadeAvaliacaoSchema = new mongoose.Schema({
  colaboradorNome: {
    type: String,
    required: true,
    trim: true
  },
  avaliador: {
    type: String,
    required: true,
    trim: true
  },
  mes: {
    type: String,
    required: true,
    trim: true
  },
  ano: {
    type: Number,
    required: true
  },
  saudacaoAdequada: {
    type: Boolean,
    required: true
  },
  escutaAtiva: {
    type: Boolean,
    required: true
  },
  resolucaoQuestao: {
    type: Boolean,
    required: true
  },
  empatiaCordialidade: {
    type: Boolean,
    required: true
  },
  direcionouPesquisa: {
    type: Boolean,
    required: true
  },
  procedimentoIncorreto: {
    type: Boolean,
    required: true
  },
  encerramentoBrusco: {
    type: Boolean,
    required: true
  },
  clarezaObjetividade: {
    type: Boolean,
    required: true
  },
  dominioAssunto: {
    type: Boolean,
    required: true
  },
  observacoes: {
    type: String,
    default: '',
    trim: true
  },
  dataLigacao: {
    type: Date,
    required: true
  },
  pontuacaoTotal: {
    type: Number,
    default: 0
  },
  // Campos de status de áudio (fundidos de audio_analise_status)
  nomeArquivoAudio: {
    type: String,
    default: null,
    trim: true
  },
  audioSent: {
    type: Boolean,
    default: false
  },
  audioTreated: {
    type: Boolean,
    default: false
  },
  audioCreatedAt: {
    type: Date,
    default: null
  },
  audioUpdatedAt: {
    type: Date,
    default: null
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
  collection: 'qualidade_avaliacoes'
});

// Middleware para atualizar updatedAt antes de salvar
qualidadeAvaliacaoSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Middleware para atualizar updatedAt antes de atualizar
qualidadeAvaliacaoSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

// Índices para otimização de consultas
qualidadeAvaliacaoSchema.index({ colaboradorNome: 1 });
qualidadeAvaliacaoSchema.index({ avaliador: 1 });
qualidadeAvaliacaoSchema.index({ mes: 1, ano: 1 });
qualidadeAvaliacaoSchema.index({ createdAt: -1 });
qualidadeAvaliacaoSchema.index({ audioSent: 1 });
qualidadeAvaliacaoSchema.index({ audioTreated: 1 });
qualidadeAvaliacaoSchema.index({ nomeArquivoAudio: 1 });

// Função para obter o modelo (garante que a conexão está inicializada)
const getModel = async () => {
  const connection = await initializeConnection();
  return connection.model('QualidadeAvaliacao', qualidadeAvaliacaoSchema);
};

// Modelo (será inicializado quando necessário)
let QualidadeAvaliacaoModel;

/**
 * Obter modelo QualidadeAvaliacao
 * @returns {Promise<mongoose.Model>}
 */
const QualidadeAvaliacao = {
  async model() {
    if (!QualidadeAvaliacaoModel) {
      const connection = await initializeConnection();
      QualidadeAvaliacaoModel = connection.model('QualidadeAvaliacao', qualidadeAvaliacaoSchema);
    }
    return QualidadeAvaliacaoModel;
  },

  async findOne(query) {
    const Model = await this.model();
    return Model.findOne(query);
  },

  async findById(id) {
    const Model = await this.model();
    return Model.findById(id);
  }
};

module.exports = QualidadeAvaliacao;
module.exports.initializeConnection = initializeConnection;

