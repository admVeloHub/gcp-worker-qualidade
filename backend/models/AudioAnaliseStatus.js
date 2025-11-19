// VERSION: v1.0.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
const mongoose = require('mongoose');

// Configurar conexão específica para console_analises
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://lucasgravina:nKQu8bSN6iZl8FPo@velohubcentral.od7vwts.mongodb.net/?retryWrites=true&w=majority&appName=VelohubCentral';
const ANALISES_DB_NAME = process.env.CONSOLE_ANALISES_DB || 'console_analises';

// Criar conexão específica para análises
const analisesConnection = mongoose.createConnection(MONGODB_URI, {
  dbName: ANALISES_DB_NAME
});

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

// Modelo
const AudioAnaliseStatus = analisesConnection.model('AudioAnaliseStatus', audioAnaliseStatusSchema);

module.exports = AudioAnaliseStatus;

