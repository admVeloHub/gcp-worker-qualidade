// Script temporário para iniciar apenas o servidor HTTP do observatório
require('./backend/config/loadFonteVerdadeEnv').loadFrom(__dirname);
const express = require('express');
const { resolveWorkerHttpPort } = require('./backend/config/workerPort');
const healthCheckRouter = require('./backend/worker/healthCheck');
const observatorioRouter = require('./backend/worker/observatorio');

const PORT = resolveWorkerHttpPort();
const app = express();

app.use(express.json());
app.use('/', healthCheckRouter);
app.use('/', observatorioRouter);

// Detectar se está rodando no Cloud Run
const K_SERVICE = process.env.K_SERVICE;
const isCloudRun = !!K_SERVICE;
const baseUrl = isCloudRun 
  ? 'https://worker-qualidade-278491073220.us-east1.run.app'
  : `http://localhost:${PORT}`;

app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP iniciado na porta ${PORT}`);
  console.log(`   - Health Check: ${baseUrl}/health`);
  console.log(`   - Observatório: ${baseUrl}/observatorio`);
  if (!isCloudRun) {
    console.log('\n⚠️  Modo de visualização apenas - algumas funcionalidades podem não funcionar sem credenciais GCP');
  }
});

