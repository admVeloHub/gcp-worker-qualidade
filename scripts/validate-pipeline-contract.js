// VERSION: v1.0.0 | DATE: 2026-06-03 | AUTHOR: VeloHub Development Team
/**
 * Validação local do contrato LISTA (sem chamadas Gemini/GPT/OpenAI).
 * Uso: node scripts/validate-pipeline-contract.js
 */
const assert = require('assert');
const { formatTranscricaoParaTexto } = require('../backend/config/vertexAI');

const sampleTranscricao = [
  { role: 'Agente', fala: 'Bom dia, Velotax.' },
  { role: 'Cliente', fala: 'Quero saber do meu processo no PROCON.' }
];

const texto = formatTranscricaoParaTexto(sampleTranscricao);
assert(texto.includes('Agente:'), 'formatTranscricaoParaTexto deve incluir turno Agente');
assert(texto.includes('PROCON'), 'formatTranscricaoParaTexto deve preservar conteúdo');

const listaFields = [
  'avaliacao_id',
  'nomeArquivoAudio',
  'transcricao',
  'analiseDialogo',
  'criteriosDetalhados',
  'pontuacaoCalculada',
  'palavrasCriticas',
  'observacaoGPT',
  'timestampInicio',
  'timestampFim'
];

const fs = require('fs');
const path = require('path');

const modelSource = fs.readFileSync(
  path.join(__dirname, '../backend/models/AudioAnaliseResult.js'),
  'utf8'
);

for (const field of listaFields) {
  assert(modelSource.includes(`${field}:`), `AudioAnaliseResult.js deve definir: ${field}`);
}

const legacy = ['transcription:', 'qualityAnalysis:', 'gptAnalysis:', 'avaliacaoMonitorId:', 'nomeArquivo:'];
for (const token of legacy) {
  assert(!modelSource.includes(token), `Campo legado não deve existir no model: ${token}`);
}

console.log('✅ Contrato LISTA validado (schema source + formatTranscricaoParaTexto)');
