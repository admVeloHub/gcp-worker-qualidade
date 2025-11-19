# VERSION: v1.0.1 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
# Script para configurar notificação do bucket GCS para Pub/Sub

# Configurações
$PROJECT_ID = "velohub-471220"
$BUCKET_NAME = "qualidade_audio_envio"
$TOPIC_NAME = "qualidade_audio_envio"

Write-Host "🔧 Configurando notificação do bucket GCS para Pub/Sub..." -ForegroundColor Cyan
Write-Host ""

# Verificar se gcloud está instalado
try {
    $null = gcloud --version 2>&1
    Write-Host "✅ gcloud CLI encontrado" -ForegroundColor Green
} catch {
    Write-Host "❌ Erro: gcloud CLI não encontrado. Instale o Google Cloud SDK primeiro." -ForegroundColor Red
    exit 1
}

# Configurar projeto padrão
Write-Host "📋 Configurando projeto padrão: $PROJECT_ID" -ForegroundColor Yellow
gcloud config set project $PROJECT_ID
Write-Host ""

# Verificar se o bucket existe
Write-Host "🔍 Verificando se o bucket existe..." -ForegroundColor Yellow
$bucketCheck = gsutil ls -b gs://$BUCKET_NAME 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Bucket '$BUCKET_NAME' não encontrado" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ Bucket '$BUCKET_NAME' encontrado" -ForegroundColor Green
}
Write-Host ""

# Criar notificação do bucket para Pub/Sub
Write-Host "🔔 Criando notificação do bucket para Pub/Sub..." -ForegroundColor Yellow
Write-Host "   Bucket: gs://$BUCKET_NAME" -ForegroundColor White
Write-Host "   Tópico: $TOPIC_NAME" -ForegroundColor White
Write-Host ""

$notificationResult = gsutil notification create -t $TOPIC_NAME -f json gs://$BUCKET_NAME 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Notificação criada com sucesso!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Detalhes da notificação:" -ForegroundColor Cyan
    Write-Host $notificationResult -ForegroundColor White
    Write-Host ""
    Write-Host "📋 Configuração:" -ForegroundColor Cyan
    Write-Host "   Bucket: gs://$BUCKET_NAME" -ForegroundColor White
    Write-Host "   Tópico: projects/$PROJECT_ID/topics/$TOPIC_NAME" -ForegroundColor White
    Write-Host "   Evento: OBJECT_FINALIZE (quando arquivo é criado)" -ForegroundColor White
    Write-Host "   Formato: JSON_API_V1" -ForegroundColor White
} else {
    if ($notificationResult -match "already exists" -or $notificationResult -match "já existe") {
        Write-Host "⚠️  Notificação já existe para este bucket e tópico" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "📋 Listando notificações existentes:" -ForegroundColor Cyan
        gsutil notification list gs://$BUCKET_NAME
    } else {
        Write-Host "❌ Erro ao criar notificação:" -ForegroundColor Red
        Write-Host $notificationResult -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "✅ Configuração concluída!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Próximos passos:" -ForegroundColor Cyan
Write-Host "   1. Verificar no Console GCP se a notificação aparece no bucket" -ForegroundColor White
Write-Host "   2. Testar fazendo upload de um arquivo no bucket" -ForegroundColor White
Write-Host "   3. Verificar se mensagem aparece na subscription do Pub/Sub" -ForegroundColor White
