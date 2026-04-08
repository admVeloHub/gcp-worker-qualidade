// Observatório de monitoramento do worker — VeloHub Development Team
// Política de versão: não incrementar semver neste arquivo a cada alteração. O release do worker será rotulado **v2.0.0** quando o conjunto estiver pronto (único bump nessa entrega).

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
    <title>Observatório — Worker de Qualidade</title>
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
            padding: 8px 20px 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        /* Título + faixa com dois painéis iguais (métricas | conexões) */
        .page-header {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0;
            margin: 0 0 28px 0;
            padding: 0;
            width: 100%;
        }
        .page-header h1 {
            flex: 0 0 auto;
        }
        h1 {
            color: #00ff00;
            text-align: center;
            margin: 0;
            padding: 0;
            font-size: 36px;
            font-weight: normal;
            line-height: 1;
            text-transform: uppercase;
            letter-spacing: 4px;
            text-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00;
        }
        .status-bar-wrap {
            display: flex;
            justify-content: center;
            width: 100%;
            margin: 0;
            padding-top: 2px;
            flex: 0 0 auto;
        }
        /* Duas caixas lado a lado, cada uma só com a largura do conteúdo */
        .status-panels-row {
            display: flex;
            flex-direction: row;
            align-items: stretch;
            gap: 12px;
            width: fit-content;
            max-width: 100%;
            margin: 0 auto;
            box-sizing: border-box;
        }
        .status-subpanel {
            flex: 0 1 auto;
            width: max-content;
            max-width: 100%;
            background: rgba(0, 255, 0, 0.1);
            border: 1px solid #00ff00;
            border-radius: 4px;
            padding: 10px 12px;
            box-sizing: border-box;
            box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
        .status-bar {
            display: flex;
            align-items: center;
            gap: 16px;
            justify-content: center;
            flex-wrap: wrap;
            width: max-content;
            max-width: 100%;
        }
        .connections-block {
            margin: 0;
            padding: 0;
            width: max-content;
            max-width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .status-subpanel .connections-row {
            justify-content: center;
            margin: 0;
            gap: 18px 24px;
        }
        @media (max-width: 720px) {
            .status-panels-row {
                flex-direction: column;
                width: 100%;
                max-width: 100%;
            }
            .status-subpanel {
                width: 100%;
                max-width: 100%;
            }
            .status-bar {
                width: 100%;
            }
            .connections-block {
                width: 100%;
            }
        }
        .status-indicator {
            width: 12px;
            height: 12px;
            flex-shrink: 0;
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
            gap: 18px;
            align-items: center;
            flex-wrap: wrap;
            flex: 0 1 auto;
            justify-content: center;
        }
        .data-item {
            display: flex;
            flex-direction: column;
            gap: 1px;
        }
        .data-label {
            font-size: 9px;
            color: #00ff88;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .data-value {
            font-size: 15px;
            line-height: 1.15;
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
        .queue-unified {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .queue-unified-row {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px 14px;
            padding: 10px 12px;
            border-left: 3px solid #00ff00;
            background: rgba(0, 255, 0, 0.05);
            font-size: 12px;
            font-family: 'Courier New', monospace;
        }
        .queue-unified-row--retry {
            color: #ffcc00;
            border-left-color: #ffcc00;
            background: rgba(255, 204, 0, 0.07);
        }
        .queue-unified-row--retry .queue-file,
        .queue-unified-row--retry .queue-meta {
            color: #ffcc00;
        }
        .queue-file {
            color: #00ff00;
            font-weight: bold;
            word-break: break-all;
            flex: 1 1 200px;
        }
        .queue-meta {
            color: #00ff88;
            font-size: 11px;
            white-space: nowrap;
        }
        .connections-row {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 28px 36px;
            min-height: 1.2em;
        }
        .conn-item {
            display: inline-flex;
            flex-direction: row;
            align-items: center;
            gap: 10px;
            flex: 0 0 auto;
        }
        .conn-label {
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #00ff88;
            white-space: nowrap;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="page-header">
        <h1>Observatório</h1>
        <div class="status-bar-wrap">
        <div class="status-panels-row">
        <div class="status-subpanel">
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
        </div>
        <div class="status-subpanel">
        <div class="connections-block">
            <div class="connections-row" role="list">
                <div class="conn-item" role="listitem">
                    <div class="status-indicator error" id="conn-led-mongodb" title="…" aria-label="MongoDB"></div>
                    <span class="conn-label">MongoDB</span>
                </div>
                <div class="conn-item" role="listitem">
                    <div class="status-indicator error" id="conn-led-pubsub" title="…" aria-label="Pub/Sub"></div>
                    <span class="conn-label">Pub/Sub</span>
                </div>
                <div class="conn-item" role="listitem">
                    <div class="status-indicator error" id="conn-led-vertex" title="…" aria-label="Vertex AI"></div>
                    <span class="conn-label">Vertex AI</span>
                </div>
            </div>
        </div>
        </div>
        </div>
        </div>
        </header>
        
        <div class="dashboard" id="dashboard" style="display: none;">
        </div>
        
        <div class="section">
            <h2>Fila</h2>
            <div id="unified-process-queue"><p>Nenhum item na fila</p></div>
        </div>
        
        <div class="section">
            <h2>Logs Recentes (Últimas 50 — mais recentes no topo)</h2>
            <div id="logs">Carregando...</div>
        </div>
    </div>
    
    <script>
        function mapConnStatusToIndicator(status) {
            if (status === 'healthy') return 'healthy';
            if (status === 'partial') return 'degraded';
            return 'error';
        }
        
        function applyConnLed(elId, componentStatus, labelPrefix) {
            const el = document.getElementById(elId);
            if (!el) return;
            const led = mapConnStatusToIndicator(componentStatus);
            el.className = 'status-indicator ' + led;
            el.title = String(componentStatus);
            el.setAttribute('aria-label', labelPrefix + ': ' + String(componentStatus));
        }
        
        function escapeHtml(s) {
            if (s == null || s === '') return '';
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }
        
        /** Fila auto-retry agendada: (MMm - n/3) alinhado ao sweep (MAX 3 tentativas). */
        function formatRetryParen(q) {
            if (!q || q.mode !== 'scheduled' || q.nextInMs == null) return '';
            var max = 3;
            var attemptIdx = typeof q.attempt === 'number' ? q.attempt : 0;
            var n = attemptIdx + 1;
            if (n < 1) n = 1;
            if (n > max) n = max;
            var minutes = Math.max(0, Math.ceil(Number(q.nextInMs) / 60000));
            var mm = minutes < 10 ? ('0' + minutes) : String(minutes);
            return '(' + mm + 'm - ' + n + '/' + max + ')';
        }
        
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
                
                // Status de conexões — LEDs fixos na 2ª linha do painel (atualiza classes, sem innerHTML)
                if (health.components) {
                    applyConnLed('conn-led-mongodb', health.components.mongodb.status, 'MongoDB');
                    applyConnLed('conn-led-pubsub', health.components.pubsub.status, 'Pub/Sub');
                    applyConnLed('conn-led-vertex', health.components.vertexAI.status, 'Vertex AI');
                }
                
                let data = { stats: {}, logs: [] };
                try {
                    const dataRes = await fetch('/observatorio/data');
                    data = await dataRes.json();
                } catch (error) {
                    console.error('Erro ao carregar dados:', error);
                    document.getElementById('unified-process-queue').innerHTML = '<p>Erro ao carregar fila</p>';
                    document.getElementById('logs').innerHTML = '<p>Erro ao carregar logs</p>';
                    return;
                }
                
                var proc = (data.stats && data.stats.processingMessages) ? data.stats.processingMessages : [];
                var autoQ = (data.stats && data.stats.autoRetryQueue) ? data.stats.autoRetryQueue : [];
                var processingFiles = new Set();
                proc.forEach(function (pair) {
                    if (pair[1] && pair[1].fileName) processingFiles.add(pair[1].fileName);
                });
                var scheduled = autoQ.filter(function (q) {
                    return q.mode === 'scheduled' && q.fileName && processingFiles.has(q.fileName) === false;
                });
                var uhtml = '';
                if (proc.length === 0 && scheduled.length === 0) {
                    uhtml = '<p>Nenhum item na fila</p>';
                } else {
                    var rows = [];
                    proc.forEach(function (pair) {
                        var msgId = pair[0];
                        var info = pair[1] || {};
                        var fid = escapeHtml(info.fileName || '—');
                        var midRaw = String(msgId || '');
                        var mid = escapeHtml(midRaw.length > 28 ? midRaw.substring(0, 28) + '…' : midRaw);
                        var st = info.startTime != null ? info.startTime : Date.now();
                        var sec = ((Date.now() - st) / 1000).toFixed(1);
                        rows.push('<div class="queue-unified-row"><span class="queue-file">' + fid + '</span><span class="queue-meta">' + mid + ' · ' + sec + 's</span></div>');
                    });
                    scheduled.forEach(function (q) {
                        var fid = escapeHtml(q.fileName || '—');
                        var suffix = formatRetryParen(q);
                        rows.push('<div class="queue-unified-row queue-unified-row--retry"><span class="queue-file">' + fid + '</span><span class="queue-meta">' + suffix + '</span></div>');
                    });
                    uhtml = '<div class="queue-unified">' + rows.join('') + '</div>';
                }
                document.getElementById('unified-process-queue').innerHTML = uhtml;
                
                try {
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
                    console.error('Erro ao renderizar logs:', error);
                    document.getElementById('logs').innerHTML = '<p>Erro ao carregar logs</p>';
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

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.type('html');
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

