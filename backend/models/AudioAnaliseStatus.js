// VERSION: v1.2.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
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
          console.log('✅ Conexão MongoDB (AudioAnaliseStatus) estabelecida');
          resolve();
        });

        analisesConnection.on('error', (error) => {
          console.error('❌ Erro na conexão MongoDB (AudioAnaliseStatus):', error);
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

// Schema para controle de envio e exibição do status do processamento de áudio
const audioAnaliseStatusSchema = new mongoose.Schema({
  nomeArquivo: {
    type: String,
    required: true,
    trim: true
  },
  sent: {
    type: Boolean,
    required: true,
    default: false
  },
  treated: {
    type: Boolean,
    required: true,
    default: false
  }
}, {
  timestamps: true, // Adiciona createdAt e updatedAt automaticamente
  collection: 'audio_analise_status'
});

// Índices para otimização de consultas
audioAnaliseStatusSchema.index({ nomeArquivo: 1 });
audioAnaliseStatusSchema.index({ sent: 1 });
audioAnaliseStatusSchema.index({ treated: 1 });
audioAnaliseStatusSchema.index({ createdAt: -1 });

// Métodos estáticos
audioAnaliseStatusSchema.statics.findByNomeArquivo = function(nomeArquivo) {
  return this.findOne({ nomeArquivo });
};

audioAnaliseStatusSchema.statics.findProcessando = function() {
  return this.find({ sent: true, treated: false });
};

audioAnaliseStatusSchema.statics.findConcluidos = function() {
  return this.find({ treated: true });
};

// Método de instância para marcar como enviado
audioAnaliseStatusSchema.methods.marcarComoEnviado = function() {
  this.sent = true;
  this.treated = false;
  return this.save();
};

// Método de instância para marcar como tratado
audioAnaliseStatusSchema.methods.marcarComoTratado = function() {
  this.treated = true;
  return this.save();
};

// Função para obter o modelo (garante que a conexão está inicializada)
const getModel = async () => {
  const connection = await initializeConnection();
  return connection.model('AudioAnaliseStatus', audioAnaliseStatusSchema);
};

// Modelo (será inicializado quando necessário)
let AudioAnaliseStatusModel;

/**
 * Obter modelo AudioAnaliseStatus
 * @returns {Promise<mongoose.Model>}
 */
const AudioAnaliseStatus = {
  async model() {
    if (!AudioAnaliseStatusModel) {
      const connection = await initializeConnection();
      AudioAnaliseStatusModel = connection.model('AudioAnaliseStatus', audioAnaliseStatusSchema);
    }
    return AudioAnaliseStatusModel;
  },

  async findByNomeArquivo(nomeArquivo) {
    const Model = await this.model();
    return Model.findOne({ nomeArquivo });
  },

  async findProcessando() {
    const Model = await this.model();
    return Model.find({ sent: true, treated: false });
  },

  async findConcluidos() {
    const Model = await this.model();
    return Model.find({ treated: true });
  }
};

module.exports = AudioAnaliseStatus;
module.exports.initializeConnection = initializeConnection;

