// VERSION: v1.0.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
// Módulo para integração com GCP Secret Manager

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// Configuração
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';

// Cliente do Secret Manager
let secretClient;
const secretCache = new Map();

/**
 * Inicializar cliente do Secret Manager
 */
const initializeSecretClient = () => {
  if (!secretClient) {
    if (!GCP_PROJECT_ID) {
      throw new Error('GCP_PROJECT_ID deve estar configurado nas variáveis de ambiente');
    }
    secretClient = new SecretManagerServiceClient();
    console.log('✅ Secret Manager client inicializado');
  }
  return secretClient;
};

/**
 * Buscar secret do GCP Secret Manager
 * @param {string} secretName - Nome do secret (ex: 'GEMINI_API_KEY', 'MONGO_ENV')
 * @param {string} version - Versão do secret (default: 'latest')
 * @returns {Promise<string>} Valor do secret
 */
const getSecret = async (secretName, version = 'latest') => {
  try {
    // Verificar cache primeiro
    const cacheKey = `${secretName}:${version}`;
    if (secretCache.has(cacheKey)) {
      return secretCache.get(cacheKey);
    }

    // Inicializar cliente se necessário
    const client = initializeSecretClient();

    // Construir nome completo do secret
    const name = `projects/${GCP_PROJECT_ID}/secrets/${secretName}/versions/${version}`;

    // Buscar secret
    const [secret] = await client.accessSecretVersion({ name });

    // Extrair valor (pode estar em secret.payload.data como Buffer ou string)
    let secretValue;
    if (secret.payload.data) {
      if (Buffer.isBuffer(secret.payload.data)) {
        secretValue = secret.payload.data.toString('utf8');
      } else {
        secretValue = secret.payload.data;
      }
    } else {
      throw new Error(`Secret ${secretName} não contém dados`);
    }

    // Remover espaços em branco e quebras de linha
    secretValue = secretValue.trim();

    // Armazenar no cache
    secretCache.set(cacheKey, secretValue);

    console.log(`✅ Secret ${secretName} carregado do Secret Manager`);
    return secretValue;
  } catch (error) {
    console.error(`❌ Erro ao buscar secret ${secretName}:`, error.message);
    throw new Error(`Falha ao buscar secret ${secretName}: ${error.message}`);
  }
};

/**
 * Limpar cache de secrets (útil para testes ou atualizações)
 */
const clearSecretCache = () => {
  secretCache.clear();
  console.log('✅ Cache de secrets limpo');
};

/**
 * Buscar múltiplos secrets de uma vez
 * @param {Array<string>} secretNames - Array com nomes dos secrets
 * @returns {Promise<Object>} Objeto com os secrets { secretName: value }
 */
const getSecrets = async (secretNames) => {
  const secrets = {};
  await Promise.all(
    secretNames.map(async (name) => {
      try {
        secrets[name] = await getSecret(name);
      } catch (error) {
        console.error(`❌ Erro ao buscar secret ${name}:`, error.message);
        secrets[name] = null;
      }
    })
  );
  return secrets;
};

module.exports = {
  getSecret,
  getSecrets,
  clearSecretCache,
  initializeSecretClient
};

