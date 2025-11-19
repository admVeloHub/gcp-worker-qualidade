# VERSION: v1.0.0 | DATE: 2025-01-30 | AUTHOR: VeloHub Development Team
# Dockerfile para Worker de Processamento de Áudio - Cloud Run

FROM node:18-alpine

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código da aplicação
COPY . .

# Expor porta (Cloud Run requer porta, mesmo que não seja usada)
EXPOSE 8080

# Variável de ambiente para porta
ENV PORT=8080

# Comando para iniciar o worker
CMD ["node", "backend/worker/audioProcessor.js"]

