// VERSION: v1.2.0 | DATE: 2026-04-08 | AUTHOR: VeloHub Development Team
// CHANGELOG: v1.2.0 - Seção fila auto-retry (amarelo + timer); logs/histórico sem reverse (buffer já newest-first)
// CHANGELOG: v1.1.0 - Logs recentes: 50 linhas, mais recentes primeiro; API alinha com buffer do worker
// Observatório de monitoramento do worker

const express = require('express');
const router = express.Router();

/**
 * Endpoint do observatório - Dashboard HTML
 */
router.get('/observatorio', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Observatório - Worker de Qualidade</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Courier New', 'Monaco', 'Consolas', monospace;
            background: #000000;
            color: #00ff00;
            padding: 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        h1 {
            color: #00ff00;
            text-align: center;
            margin-bottom: 30px;
            font-size: 36px;
            font-weight: normal;
            text-transform: uppercase;
            letter-spacing: 4px;
            text-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00;
        }
        .status-bar {
            background: rgba(0, 255, 0, 0.1);
            border: 1px solid #00ff00;
            border-radius: 4px;
            padding: 15px 20px;
            margin-bottom: 30px;
            display: flex;
            align-items: center;
            gap: 30px;
            box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
        }
        .status-indicator {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            box-shadow: 0 0 10px currentColor, 0 0 20px currentColor;
            animation: pulse 2s infinite;
        }
        .status-indicator.healthy {
            background: #00ff00;
            color: #00ff00;
        }
        .status-indicator.degraded {
            background: #ffaa00;
            color: #ffaa00;
        }
        .status-indicator.error {
            background: #ff0000;
            color: #ff0000;
        }
        .status-data {
            display: flex;
            gap: 30px;
            align-items: center;
            flex-wrap: wrap;
            flex: 1;
        }
        .data-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .data-label {
            font-size: 10px;
            color: #00ff88;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .data-value {
            font-size: 18px;
            color: #00ff00;
            font-weight: bold;
            text-shadow: 0 0 5px #00ff00;
            font-family: 'Courier New', monospace;
        }
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background: rgba(0, 255, 0, 0.05);
            border: 1px solid #00ff00;
            border-radius: 4px;
            padding: 20px;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.2);
        }
        .card h2 {
            font-size: 12px;
            color: #00ff88;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .card .value {
            font-size: 32px;
            font-weight: bold;
            color: #00ff00;
            text-shadow: 0 0 5px #00ff00;
        }
        .card .subtitle {
            font-size: 12px;
            color: #999;
            margin-top: 5px;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
        }
        .status-healthy {
            background: #00ff00;
            color: #000;
        }
        .status-degraded {
            background: #ffaa00;
            color: #000;
        }
        .status-error {
            background: #ff0000;
            color: #fff;
        }
        .status-processing {
            background: #00ffff;
            color: #000;
        }
        .status-success {
            background: #00ff00;
            color: #000;
        }
        .status-failed {
            background: #ff0000;
            color: #fff;
        }
        .section {
            background: rgba(0, 255, 0, 0.05);
            border: 1px solid #00ff00;
            border-radius: 4px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.2);
        }
        .section h2 {
            color: #00ff00;
            margin-bottom: 15px;
            font-size: 16px;
            text-transform: uppercase;
            letter-spacing: 2px;
            text-shadow: 0 0 5px #00ff00;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        th {
            background: rgba(0, 255, 0, 0.1);
            font-weight: 600;
            color: #00ff88;
            font-size: 11px;
            text-transform: uppercase;
            border-bottom: 1px solid #00ff00;
        }
        td {
            color: #00ff00;
            border-bottom: 1px solid rgba(0, 255, 0, 0.2);
        }
        tr:hover {
            background: rgba(0, 255, 0, 0.05);
        }
        .log-entry {
            padding: 8px;
            margin-bottom: 4px;
            border-left: 3px solid #00ff00;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            color: #00ff00;
        }
        .log-entry.INFO {
            border-left-color: #00ffff;
            color: #00ffff;
        }
        .log-entry.WARN {
            border-left-color: #ffaa00;
            color: #ffaa00;
        }
        .log-entry.ERROR {
            border-left-color: #ff0000;
            color: #ff0000;
        }
        .log-entry.DEBUG {
            border-left-color: #888888;
            color: #888888;
        }
        .queue-retry, .queue-retry td {
            color: #ffcc00 !important;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Observatório</h1>
        
        <div class="status-bar" id="status-bar">
            <div class="status-indicator" id="status-indicator"></div>
            <div class="status-data">
                <div class="data-item">
                    <div class="data-label">Processado</div>
                    <div class="data-value" id="total-processed">0</div>
                </div>
                <div class="data-item">
                    <div class="data-label">Sucesso</div>
                    <div class="data-value" id="success-rate">0%</div>
                </div>
                <div class="data-item">
                    <div class="data-label">Processando</div>
                    <div class="data-value" id="processing">0</div>
                </div>
                <div class="data-item">
                    <div class="data-label">Uptime</div>
                    <div class="data-value" id="uptime">0s</div>
                </div>
            </div>
        </div>
        
        <div class="dashboard" id="dashboard" style="display: none;">
        </div>
        
        <div class="section">
            <h2>Status de Conexões</h2>
            <div id="connections-status">Carregando...</div>
        </div>
        
        <div class="section">
            <h2>Mensagens em Processamento</h2>
            <div id="processing-messages">Nenhuma mensagem em processamento</div>
        </div>
        
        <div class="section">
            <h2>Fila auto-retry (mais recentes no topo)</h2>
            <div id="auto-retry-queue"><p>Nenhum item na fila de reconciliação</p></div>
        </div>
        
        <div class="section">
            <h2>Histórico de Mensagens (Últimas 50)</h2>
            <div id="message-history">Carregando...</div>
        </div>
        
        <div class="section">
            <h2>Logs Recentes (Últimas 50 — mais recentes no topo)</h2>
            <div id="logs">Carregando...</div>
        </div>
    </div>
    
    <script>
        async function loadData() {
            try {
                // Carregar health check
                const healthRes = await fetch('/health');
                const health = await healthRes.json();
                
                // Atualizar status bar
                const statusIndicator = document.getElementById('status-indicator');
                statusIndicator.className = 'status-indicator ' + health.status;
                
                document.getElementById('total-processed').textContent = health.statistics.totalProcessed;
                document.getElementById('success-rate').textContent = health.statistics.successRate;
                document.getElementById('processing').textContent = health.statistics.currentlyProcessing;
                document.getElementById('uptime').textContent = health.uptime.formatted;
                
                // Status de conexões
                const connectionsHtml = \`
                    <table>
                        <tr>
                            <th>Componente</th>
                            <th>Status</th>
                            <th>Detalhes</th>
                        </tr>
                        <tr>
                            <td>MongoDB</td>
                            <td><span class="status-badge status-\${health.components.mongodb.status}">\${health.components.mongodb.status}</span></td>
                            <td>\${health.components.mongodb.statusConnection ? health.components.mongodb.statusConnection.name : 'N/A'}</td>
                        </tr>
                        <tr>
                            <td>Pub/Sub</td>
                            <td><span class="status-badge status-\${health.components.pubsub.status}">\${health.components.pubsub.status}</span></td>
                            <td>\${health.components.pubsub.subscriptionName || 'N/A'}</td>
                        </tr>
                        <tr>
                            <td>Vertex AI</td>
                            <td><span class="status-badge status-\${health.components.vertexAI.status}">\${health.components.vertexAI.status}</span></td>
                            <td>Speech: \${health.components.vertexAI.speechClient}, Gemini: \${health.components.vertexAI.geminiAI}</td>
                        </tr>
                    </table>
                \`;
                document.getElementById('connections-status').innerHTML = connectionsHtml;
                
                // Mensagens em processamento
                let processingHtml = '<p>Nenhuma mensagem em processamento</p>';
                if (health.statistics.currentlyProcessing > 0) {
                    try {
                        const dataRes = await fetch('/observatorio/data');
                        const data = await dataRes.json();
                        if (data.stats && data.stats.processingMessages && data.stats.processingMessages.length > 0) {
                            processingHtml = \`
                                <table>
                                    <tr>
                                        <th>Message ID</th>
                                        <th>Arquivo</th>
                                        <th>Tempo em Processamento</th>
                                    </tr>
                                    \${data.stats.processingMessages.map(([msgId, info]) => \`
                                        <tr>
                                            <td>\${msgId.substring(0, 20)}...</td>
                                            <td>\${info.fileName}</td>
                                            <td>\${((Date.now() - info.startTime) / 1000).toFixed(2)}s</td>
                                        </tr>
                                    \`).join('')}
                                </table>
                            \`;
                        } else {
                            processingHtml = '<p>Processando ' + health.statistics.currentlyProcessing + ' mensagem(ns)</p>';
                        }
                    } catch (error) {
                        processingHtml = '<p>Processando ' + health.statistics.currentlyProcessing + ' mensagem(ns)</p>';
                    }
                }
                document.getElementById('processing-messages').innerHTML = processingHtml;
                
                // Carregar histórico, fila retry e logs
                try {
                    const dataRes = await fetch('/observatorio/data');
                    const data = await dataRes.json();
                    
                    const queue = (data.stats && data.stats.autoRetryQueue) ? data.stats.autoRetryQueue : [];
                    if (queue.length > 0) {
                        const qHtml = \`
                            <table class="queue-retry">
                                <tr>
                                    <th>Quando</th>
                                    <th>Arquivo</th>
                                    <th>Modo</th>
                                    <th>Detalhe</th>
                                </tr>
                                \${queue.map(q => \`
                                    <tr>
                                        <td>\${q.ts ? new Date(q.ts).toLocaleString() : '-'}</td>
                                        <td>\${q.fileName || '-'}</td>
                                        <td>\${q.mode || '-'}</td>
                                        <td>\${q.label || (q.attempt != null ? 'tentativa ' + q.attempt : '') || '-'}</td>
                                    </tr>
                                \`).join('')}
                            </table>
                        \`;
                        document.getElementById('auto-retry-queue').innerHTML = qHtml;
                    } else {
                        document.getElementById('auto-retry-queue').innerHTML = '<p>Nenhum item na fila de reconciliação</p>';
                    }
                    
                    if (data.stats && data.stats.messageHistory && data.stats.messageHistory.length > 0) {
                        const historyHtml = \`
                            <table>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Arquivo</th>
                                    <th>Status</th>
                                    <th>Tempo (s)</th>
                                </tr>
                                \${data.stats.messageHistory.map(msg => \`
                                    <tr>
                                        <td>\${new Date(msg.timestamp).toLocaleString()}</td>
                                        <td>\${msg.fileName}</td>
                                        <td><span class="status-badge status-\${msg.status === 'success' ? 'success' : 'failed'}">\${msg.status === 'success' ? 'OK' : 'ERR'}</span></td>
                                        <td>\${msg.processingTime ? msg.processingTime.toFixed(2) : 'N/A'}</td>
                                    </tr>
                                \`).join('')}
                            </table>
                        \`;
                        document.getElementById('message-history').innerHTML = historyHtml;
                    } else {
                        document.getElementById('message-history').innerHTML = '<p>Nenhuma mensagem processada ainda</p>';
                    }
                    
                    if (data.logs && data.logs.length > 0) {
                        const logsHtml = data.logs.map(log => \`
                            <div class="log-entry \${log.level}">
                                [\${new Date(log.timestamp).toLocaleString()}] [\${log.level}] \${log.message}
                            </div>
                        \`).join('');
                        document.getElementById('logs').innerHTML = logsHtml;
                    } else {
                        document.getElementById('logs').innerHTML = '<p>Nenhum log disponível</p>';
                    }
                } catch (error) {
                    console.error('Erro ao carregar dados:', error);
                    document.getElementById('message-history').innerHTML = '<p>Erro ao carregar histórico</p>';
                    document.getElementById('logs').innerHTML = '<p>Erro ao carregar logs</p>';
                    document.getElementById('auto-retry-queue').innerHTML = '<p>Erro ao carregar fila</p>';
                }
                
            } catch (error) {
                console.error('Erro ao carregar dados:', error);
            }
        }
        
        // Carregar dados inicialmente
        loadData();
        
        // Atualizar a cada 5 segundos
        setInterval(loadData, 5000);
    </script>
</body>
</html>
  `;
  
  res.send(html);
});

/**
 * Endpoint para obter dados do observatório (JSON)
 */
router.get('/observatorio/data', async (req, res) => {
  try {
    const { getStats, getLogs } = require('./audioProcessor');
    const stats = getStats();
    const logs = getLogs();
    
    res.json({
      stats,
      logs: logs.slice(0, 50)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = router;

