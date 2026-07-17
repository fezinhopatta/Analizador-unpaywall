# Extrator e Gerenciador de Metadados de Artigos Científicos

Bem-vindo ao Extrator de Metadados! Este sistema foi projetado para processar grandes arquivos CSV de artigos, filtrá-los, e verificar quais estão disponíveis gratuitamente (Open Access) na internet.

## Como Executar no GitHub Codespaces (ou Linux)

Se você está rodando isso no GitHub Codespaces, siga estas instruções simples:

1. Abra o terminal integrado do Codespaces.
2. Dê permissão de execução ao script de inicialização:
   ```bash
   chmod +x iniciar.sh
   ```
3. Execute o script:
   ```bash
   ./iniciar.sh
   ```

O script irá instalar todas as dependências necessárias automaticamente e iniciará o servidor. 

4. Quando o servidor iniciar, o Codespaces deve exibir um pop-up avisando que o servidor está rodando na porta `8000`. Clique em **"Open in Browser"** (Abrir no Navegador). 
   - Se o pop-up não aparecer, vá para a aba "Ports" (Portas) no terminal e clique no ícone de globo ao lado da porta 8000.

## Como usar o sistema

1. **Upload**: Arraste e solte o seu arquivo CSV na área indicada. O sistema vai carregar ele aos poucos no banco de dados para evitar travar a máquina.
2. **Navegar**: Use a barra de pesquisa ou os filtros de Open Access e Ano.
3. **Verificar Open Access**: Se o artigo não foi verificado, clique no botão "Verificar Acesso" para consultar a API Unpaywall (já configurada com seu email).
4. **Baixar PDF**: Se o artigo estiver livre na internet, o botão "Baixar PDF" aparecerá. Ao clicar, o PDF será salvo na pasta `artigos/` dentro do próprio projeto.
