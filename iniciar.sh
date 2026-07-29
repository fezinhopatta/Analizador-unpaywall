#!/bin/bash
echo "Configurando o Extrator de Metadados..."

# Instalar dependências se necessário


# Iniciar o servidor
PORT="${PORT:-8001}"
echo "Iniciando o servidor em http://localhost:${PORT}"
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port "${PORT}"
