// VERSION: v1.0.0 | DATE: 2026-06-03 | AUTHOR: VeloHub Development Team
// Aguarda objeto no GCS estar disponível antes do processamento (evita corrida Pub/Sub × upload).
const { Storage } = require('@google-cloud/storage');

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCS_READY_MAX_WAIT_MS = parseInt(process.env.GCS_READY_MAX_WAIT_MS || '45000', 10);
const GCS_READY_POLL_MS = parseInt(process.env.GCS_READY_POLL_MS || '1000', 10);
const GCS_READY_MIN_SIZE_BYTES = parseInt(process.env.GCS_READY_MIN_SIZE_BYTES || '1', 10);

let storageClient;

const getStorage = () => {
  if (!storageClient) {
    storageClient = new Storage({ projectId: GCP_PROJECT_ID });
  }
  return storageClient;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Aguarda o arquivo existir no bucket com tamanho mínimo (upload concluído).
 * @throws {Error} se não ficar pronto dentro do prazo
 */
const waitForGcsObjectReady = async (bucketName, fileName, options = {}) => {
  const maxWaitMs = options.maxWaitMs ?? GCS_READY_MAX_WAIT_MS;
  const pollMs = options.pollMs ?? GCS_READY_POLL_MS;
  const minSize = options.minSizeBytes ?? GCS_READY_MIN_SIZE_BYTES;

  const storage = getStorage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(fileName);
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        const size = Number(metadata.size || 0);
        if (size >= minSize) {
          return { size, attempt, generation: metadata.generation };
        }
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`GCS objeto não disponível após ${maxWaitMs}ms: ${fileName} (${error.message})`);
      }
    }
    await sleep(pollMs);
  }

  throw new Error(
    `GCS objeto não disponível após ${maxWaitMs}ms (${attempt} tentativas): gs://${bucketName}/${fileName}`
  );
};

module.exports = {
  waitForGcsObjectReady,
  GCS_READY_MAX_WAIT_MS,
  GCS_READY_POLL_MS
};
