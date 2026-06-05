// VERSION: v1.0.0 | DATE: 2026-06-03 | AUTHOR: VeloHub Development Team
// Porta HTTP do worker: Cloud Run usa PORT; rede local usa WORKER da FONTE DA VERDADE/.env

/**
 * @returns {number}
 */
const resolveWorkerHttpPort = () => {
  if (process.env.K_SERVICE) {
    return parseInt(process.env.PORT || '8080', 10);
  }
  if (process.env.WORKER) {
    return parseInt(process.env.WORKER, 10);
  }
  return parseInt(process.env.PORT || '8080', 10);
};

module.exports = { resolveWorkerHttpPort };
