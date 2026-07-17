#!/bin/bash
echo "Configurando o Extrator de Metadados..."

# Instalar dependências se necessário
pip install -r requirements.txt

# Iniciar o servidor
echo "Iniciando o servidor em http://localhost:8000"
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
