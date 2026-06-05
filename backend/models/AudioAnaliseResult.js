// VERSION: v3.0.0 | DATE: 2026-06-03 | AUTHOR: VeloHub Development Team
// CHANGELOG: v3.0.0 - Schema LISTA: transcricao, analiseDialogo, criteriosDetalhados, palavrasCriticas, observacaoGPT, avaliacao_id
const mongoose = require('mongoose');
const { getSecret } = require('../config/secrets');

let MONGODB_URI;
const ANALISES_DB_NAME = process.env.CONSOLE_ANALISES_DB || 'console_analises';

let analisesConnection;
let connectionPromise;

const initializeConnection = async () => {
  if (analisesConnection && analisesConnection.readyState === 1) {
    return analisesConnection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      if (!MONGODB_URI) {
        if (process.env.MONGO_ENV) {
          MONGODB_URI = process.env.MONGO_ENV;
          console.log('✅ MongoDB URI encontrada em variáveis de ambiente');
        } else {
          MONGODB_URI = await getSecret('MONGO_ENV');
        }
      }

      analisesConnection = mongoose.createConnection(MONGODB_URI, {
        dbName: ANALISES_DB_NAME
      });

      await new Promise((resolve, reject) => {
        analisesConnection.on('connected', () => {
          console.log('✅ Conexão MongoDB (AudioAnaliseResult) estabelecida');
          resolve();
        });

        analisesConnection.on('error', (error) => {
          console.error('❌ Erro na conexão MongoDB (AudioAnaliseResult):', error);
          reject(error);
        });

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

const transcricaoTurnoSchema = new mongoose.Schema(
  {
    role: { type: String, required: true },
    fala: { type: String, required: true }
  },
  { _id: false }
);

const categoriaAnaliseSchema = new mongoose.Schema(
  {
    nota: { type: Number },
    classificacao: { type: String },
    avaliacao: { type: String }
  },
  { _id: false }
);

const consideracoesSchema = new mongoose.Schema(
  {
    classificacao: { type: String },
    avaliacao: { type: String }
  },
  { _id: false }
);

const analiseDialogoSchema = new mongoose.Schema(
  {
    temperatura: categoriaAnaliseSchema,
    tensao: categoriaAnaliseSchema,
    comportamentoVocal: categoriaAnaliseSchema,
    consideracoes: consideracoesSchema
  },
  { _id: false }
);

const criteriosDetalhadosSchema = new mongoose.Schema(
  {
    saudacaoAdequada: { type: Boolean, default: false },
    escutaAtiva: { type: Boolean, default: false },
    clarezaObjetividade: { type: Boolean, default: false },
    resolucaoQuestao: { type: Boolean, default: false },
    dominioAssunto: { type: Boolean, default: false },
    empatiaCordialidade: { type: Boolean, default: false },
    direcionouPesquisa: { type: Boolean, default: false },
    procedimentoIncorreto: { type: Boolean, default: false },
    encerramentoBrusco: { type: Boolean, default: false },
    registroAtendimento: { type: Boolean, default: false },
    naoConsultouBot: { type: Boolean, default: false },
    conformidadeTicket: { type: Boolean, default: false }
  },
  { _id: false }
);

const audioAnaliseResultSchema = new mongoose.Schema(
  {
    avaliacao_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'QualidadeAvaliacao'
    },
    nomeArquivoAudio: {
      type: String,
      required: true,
      trim: true
    },
    transcricao: {
      type: [transcricaoTurnoSchema],
      required: true
    },
    analiseDialogo: {
      type: analiseDialogoSchema,
      required: true
    },
    criteriosDetalhados: {
      type: criteriosDetalhadosSchema,
      required: true
    },
    pontuacaoCalculada: {
      type: Number,
      min: 0,
      max: 100
    },
    palavrasCriticas: {
      type: [String],
      default: []
    },
    observacaoGPT: {
      type: String,
      default: ''
    },
    timestampInicio: {
      type: Date,
      required: true
    },
    timestampFim: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true,
    collection: 'audio_analise_results'
  }
);

audioAnaliseResultSchema.index({ avaliacao_id: 1 });
audioAnaliseResultSchema.index({ nomeArquivoAudio: 1 });
audioAnaliseResultSchema.index({ createdAt: -1 });

let AudioAnaliseResultModel;

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
