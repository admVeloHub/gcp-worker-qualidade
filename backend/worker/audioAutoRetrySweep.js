// VERSION: v1.0.0 | DATE: 2026-04-08 | AUTHOR: VeloHub Development Team
// Reconciliação: republica no Pub/Sub avaliações sent+pending presas (20 min, +3x8 min, falha no tick seguinte).

const QualidadeAvaliacao = require('../models/QualidadeAvaliacao');

const SWEEP_MS = parseInt(process.env.AUTO_RETRY_SWEEP_MS || '60000', 10);
const FIRST_DELAY_MS = parseInt(process.env.AUDIO_AUTO_RETRY_FIRST_MS || String(20 * 60 * 1000), 10);
const BETWEEN_MS = parseInt(process.env.AUDIO_AUTO_RETRY_BETWEEN_MS || String(8 * 60 * 1000), 10);
const MANUAL_UNLOCK_MS = parseInt(process.env.AUDIO_MANUAL_UNLOCK_MS || String(15 * 60 * 1000), 10);
const MAX_AUTO_ATTEMPTS = 3;
const PUBSUB_TOPIC_NAME = process.env.PUBSUB_TOPIC_NAME || 'qualidade_audio_envio';

function isDone(t) {
  return t === true || t === 'done';
}

function isFailed(t) {
  return t === 'failed';
}

function isPendingLike(t) {
  if (isDone(t) || isFailed(t)) return false;
  return t === 'pending' || t === false || t == null || t === '';
}

function formatCountdown(ms) {
  if (ms <= 0) return '0s';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return m > 0 ? `${m}m ${rs}s` : `${rs}s`;
}

async function publishAudioMessage(pubsub, fileName, bucketName) {
  const topic = pubsub.topic(PUBSUB_TOPIC_NAME);
  const [exists] = await topic.exists();
  if (!exists) {
    throw new Error(`Tópico Pub/Sub '${PUBSUB_TOPIC_NAME}' não existe`);
  }
  const messageData = {
    name: fileName,
    bucket: bucketName,
    contentType: 'audio/mpeg',
    timeCreated: new Date().toISOString(),
    updated: new Date().toISOString()
  };
  return topic.publishMessage({ json: messageData });
}

/**
 * @param {{ addLog: Function, recordQueue: Function, getPubSub: () => any, bucketName: string }} deps
 */
function startAutoRetrySweep(deps) {
  const { addLog, recordQueue, getPubSub, bucketName } = deps;

  const tick = async () => {
    const pubsub = getPubSub();
    if (!pubsub) {
      return;
    }
    let Model;
    try {
      Model = await QualidadeAvaliacao.model();
    } catch (e) {
      addLog('WARN', `auto-retry: modelo indisponível: ${e.message}`);
      return;
    }

    const now = Date.now();
    let candidates;
    try {
      candidates = await Model.find({
        audioSent: true,
        nomeArquivoAudio: { $exists: true, $nin: [null, ''] },
        $nor: [{ audioTreated: 'done' }, { audioTreated: true }, { audioTreated: 'failed' }]
      })
        .limit(200)
        .exec();
    } catch (e) {
      addLog('ERROR', `auto-retry: query falhou: ${e.message}`);
      return;
    }

    for (const doc of candidates) {
      const t = doc.audioTreated;
      if (!isPendingLike(t)) continue;

      const attempts = doc.audioAutoRepublishAttempts || 0;
      const created = doc.audioCreatedAt || doc.audioUpdatedAt;
      const lastAuto = doc.audioLastAutoRepublishAt ? new Date(doc.audioLastAutoRepublishAt).getTime() : 0;
      const baseCreated = created ? new Date(created).getTime() : now;

      if (attempts >= MAX_AUTO_ATTEMPTS) {
        doc.audioTreated = 'failed';
        doc.audioManualReenvioDisponivelEm = new Date(now + MANUAL_UNLOCK_MS);
        doc.audioUpdatedAt = new Date();
        await doc.save();
        addLog('ERROR', `🔴 auto-retry esgotado → failed: ${doc.nomeArquivoAudio} avaliacao=${doc._id}`);
        recordQueue({
          ts: new Date().toISOString(),
          avaliacaoId: String(doc._id),
          fileName: doc.nomeArquivoAudio,
          mode: 'failed_final',
          attempts
        });
        continue;
      }

      let shouldRepublish = false;
      if (attempts === 0 && now - baseCreated >= FIRST_DELAY_MS) {
        shouldRepublish = true;
      } else if (attempts > 0 && attempts < MAX_AUTO_ATTEMPTS && lastAuto && now - lastAuto >= BETWEEN_MS) {
        shouldRepublish = true;
      }

      if (!shouldRepublish) {
        let nextIn = 0;
        if (attempts === 0) {
          nextIn = FIRST_DELAY_MS - (now - baseCreated);
        } else {
          nextIn = BETWEEN_MS - (now - lastAuto);
        }
        if (nextIn > 0 && nextIn < 24 * 60 * 60 * 1000) {
          recordQueue({
            ts: new Date().toISOString(),
            avaliacaoId: String(doc._id),
            fileName: doc.nomeArquivoAudio,
            mode: 'scheduled',
            attempt: attempts,
            nextInMs: nextIn,
            label: `próximo em (${formatCountdown(nextIn)})`
          });
        }
        continue;
      }

      try {
        await publishAudioMessage(pubsub, doc.nomeArquivoAudio, bucketName);
        doc.audioAutoRepublishAttempts = attempts + 1;
        doc.audioLastAutoRepublishAt = new Date();
        doc.audioUpdatedAt = new Date();
        await doc.save();
        addLog('WARN', `🔁 auto-retry Pub/Sub (${doc.audioAutoRepublishAttempts}/${MAX_AUTO_ATTEMPTS}): ${doc.nomeArquivoAudio}`);
        recordQueue({
          ts: new Date().toISOString(),
          avaliacaoId: String(doc._id),
          fileName: doc.nomeArquivoAudio,
          mode: 'republished',
          attempt: doc.audioAutoRepublishAttempts
        });
      } catch (e) {
        addLog('ERROR', `auto-retry publish falhou ${doc.nomeArquivoAudio}: ${e.message}`);
      }
    }
  };

  setInterval(() => {
    tick().catch((e) => {
      addLog('ERROR', `auto-retry sweep: ${e.message}`);
    });
  }, SWEEP_MS);

  addLog('INFO', `🔄 Auto-retry sweep a cada ${SWEEP_MS / 1000}s (1ª+${FIRST_DELAY_MS / 60000}min, depois ${BETWEEN_MS / 60000}min)`);
}

module.exports = { startAutoRetrySweep, SWEEP_MS, FIRST_DELAY_MS, BETWEEN_MS };
