let currentFileId = null;
let currentPage = 1;
const limit = 24;
let activeJobId = null;
let jobPollInterval = null;
let selectedArticleIds = new Set();
let currentRawMetadata = {};

// Elements
const dashboardView = document.getElementById('dashboardView');
const articlesView = document.getElementById('articlesView');
const filesList = document.getElementById('filesList');
const currentFileTitle = document.getElementById('currentFileTitle');
const uploadZone = document.getElementById('uploadZone');
const csvFile = document.getElementById('csvFile');
const uploadStatus = document.getElementById('uploadStatus');

const articlesGrid = document.getElementById('articlesGrid');
const searchInput = document.getElementById('searchInput');
const oaFilter = document.getElementById('oaFilter');
const dlFilter = document.getElementById('dlFilter');
const yearFilter = document.getElementById('yearFilter');
const approvalFilter = document.getElementById('approvalFilter');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const totalArticlesSpan = document.getElementById('totalArticles');

const actionBar = document.getElementById('actionBar');
const selectedCountSpan = document.getElementById('selectedCountSpan');
const selectAllResultsCb = document.getElementById('selectAllResultsCb');

// Modal Elements
const batchModal = document.getElementById('batchModal');
const closeBatchBtn = document.getElementById('closeBatchBtn');
const hideBatchBtn = document.getElementById('hideBatchBtn');

const detailsModal = document.getElementById('detailsModal');
const detailsBody = document.getElementById('detailsBody');
const closeDetailsBtn = document.getElementById('closeDetailsBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');

// Dashboard Logic
async function loadFiles() {
    try {
        const res = await fetch('api/files');
        const data = await res.json();
        filesList.innerHTML = '';
        if(data.files.length === 0) {
            filesList.innerHTML = '<p style="color: #94a3b8; text-align: center;">Nenhum arquivo enviado ainda.</p>';
            return;
        }
        
        data.files.forEach(f => {
            const date = new Date(f.upload_date).toLocaleString('pt-BR');
            const card = document.createElement('div');
            card.className = 'file-card glass-panel';
            card.innerHTML = `
                <div class="file-card-info" onclick="openFile(${f.id}, '${f.filename}')">
                    <h3><i class="fas fa-file-csv"></i> ${f.filename}</h3>
                    <p>Enviado em: ${date}</p>
                </div>
                <div class="file-card-actions">
                    <button onclick="deleteFile(${f.id})"><i class="fas fa-trash"></i></button>
                </div>
            `;
            filesList.appendChild(card);
        });
    } catch(e) { console.error(e); }
}

async function deleteFile(id) {
    if(!confirm('Certeza que deseja deletar este arquivo e todos os artigos dele?')) return;
    await fetch(`api/files/${id}`, { method: 'DELETE' });
    loadFiles();
}

function openFile(id, filename) {
    currentFileId = id;
    currentFileTitle.textContent = `Arquivo: ${filename}`;
    dashboardView.classList.add('hidden');
    articlesView.classList.remove('hidden');
    selectedArticleIds.clear();
    updateActionBar();
    loadFilters();
    loadArticles(1);
}

document.getElementById('backToDashboardBtn').addEventListener('click', () => {
    articlesView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    loadFiles();
});

// Upload Logic
uploadZone.addEventListener('click', () => csvFile.click());
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = '#2563eb'; });
uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = '#3b82f6'; });
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault(); uploadZone.style.borderColor = '#3b82f6';
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
});
csvFile.addEventListener('change', (e) => {
    if (e.target.files.length) handleUpload(e.target.files[0]);
});

async function handleUpload(file) {
    if (!file.name.toLowerCase().endsWith('.csv')) { alert('Apenas arquivos CSV são suportados.'); return; }
    
    uploadZone.classList.add('hidden');
    uploadStatus.classList.remove('hidden');
    
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const fileId = crypto.randomUUID();
    
    const statusText = document.getElementById('uploadStatusText');
    const progressBar = document.getElementById('uploadProgressBar');
    
    statusText.textContent = `Enviando arquivo (0%)`;
    progressBar.style.width = '0%';
    
    try {
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);
            
            const formData = new FormData();
            formData.append('file', chunk);
            
            await fetch(`api/upload_chunk?file_id=${fileId}&chunk_index=${chunkIndex}`, { 
                method: 'POST', 
                body: formData 
            });
            
            const percentComplete = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            statusText.textContent = `Enviando arquivo (${percentComplete}%)`;
            progressBar.style.width = `${percentComplete}%`;
        }
        
        statusText.textContent = 'Processando metadados no servidor...';
        progressBar.style.width = '100%';
        progressBar.style.background = '#f59e0b'; // warning color for processing
        
        // Notify complete
        await fetch('api/upload_complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId, filename: file.name })
        });
        
        setTimeout(() => {
            uploadStatus.classList.add('hidden');
            uploadZone.classList.remove('hidden');
            progressBar.style.background = '';
            loadFiles();
        }, 2000);
        
    } catch (e) {
        alert('Erro ao enviar.');
        console.error(e);
        uploadZone.classList.remove('hidden');
        uploadStatus.classList.add('hidden');
    }
}

// Articles Logic
async function loadFilters() {
    try {
        const res = await fetch(`api/filters?file_id=${currentFileId}`);
        const data = await res.json();
        yearFilter.innerHTML = '<option value="all">Todos os Anos</option>';
        data.years.forEach(year => {
            if (year) {
                const opt = document.createElement('option');
                opt.value = year; opt.textContent = year;
                yearFilter.appendChild(opt);
            }
        });
    } catch (e) { console.error(e); }
}

async function updateStats() {
    try {
        const res = await fetch(`api/stats?file_id=${currentFileId}`);
        const data = await res.json();
        const countApproved = document.getElementById('countApproved');
        const countRejected = document.getElementById('countRejected');
        if (countApproved) countApproved.textContent = data.Aprovado || 0;
        if (countRejected) countRejected.textContent = data.Rejeitado || 0;
    } catch (e) { console.error(e); }
}

function filterByApproval(status) {
    if (approvalFilter) approvalFilter.value = status;
    loadArticles(1);
}

async function approveArticle(id) {
    try {
        await fetch(`api/articles/${id}/approve`, { method: 'POST' });
        updateStats();
        
        // Update DOM locally without full page reload
        const card = document.getElementById(`card-${id}`);
        if (card) {
            // Se o filtro atual não inclui Aprovados (ex: Pendentes), removemos o card visualmente
            const currentFilter = approvalFilter ? approvalFilter.value : 'default';
            if (currentFilter === 'Pendente') {
                card.remove();
            } else {
                const titleSec = card.querySelector('.card-meta');
                if (titleSec && !titleSec.innerHTML.includes('fa-check')) {
                    titleSec.innerHTML += ` <span class="badge badge-approved"><i class="fas fa-check"></i> Aprovado</span>`;
                }
                const actions = document.getElementById(`actions-${id}`);
                if (actions) {
                    const btnsContainer = actions.querySelector('div');
                    if (btnsContainer && btnsContainer.innerHTML.includes('approve-btn')) {
                        btnsContainer.style.display = 'none';
                    }
                    actions.innerHTML = `<button class="btn-card-action send-main-btn" onclick="sendToMainCuration(${id})"><i class="fas fa-rocket"></i> Enviar para Curadoria</button>` + actions.innerHTML;
                }
            }
        }
    } catch (e) { console.error(e); alert('Erro ao aprovar artigo.'); }
}

async function rejectArticle(id) {
    try {
        await fetch(`api/articles/${id}/reject`, { method: 'POST' });
        updateStats();
        
        // Update DOM locally
        const card = document.getElementById(`card-${id}`);
        if (card) {
            const currentFilter = approvalFilter ? approvalFilter.value : 'default';
            if (currentFilter === 'Pendente' || currentFilter === 'default') {
                card.remove(); // Rejeitado some no default
            } else {
                const titleSec = card.querySelector('.card-meta');
                if (titleSec && !titleSec.innerHTML.includes('fa-times')) {
                    titleSec.innerHTML += ` <span class="badge badge-rejected"><i class="fas fa-times"></i> Rejeitado</span>`;
                }
                const actions = document.getElementById(`actions-${id}`);
                if (actions) {
                    const btnsContainer = actions.querySelector('div');
                    if (btnsContainer && btnsContainer.innerHTML.includes('reject-btn')) {
                        btnsContainer.innerHTML = `<button class="btn-card-action approve-btn" onclick="approveArticle(${id})"><i class="fas fa-thumbs-up"></i> Rev. p/ Aprovar</button>`;
                    }
                }
            }
        }
    } catch (e) { console.error(e); alert('Erro ao rejeitar artigo.'); }
}

function sendToMainCuration(id) {
    alert("Pronto para integração! Esta função enviará o artigo com ID " + id + " para SB100/squad1/frontend/src/pages/Curation/ no futuro.");
}

async function loadArticles(page = 1, silent = false) {
    currentPage = page;
    const search = searchInput.value;
    const oa = oaFilter.value;
    const year = yearFilter.value;
    const dl = dlFilter.value;
    const approval = approvalFilter ? approvalFilter.value : 'default';
    
    const csvBtn = document.getElementById('downloadCsvBtn');
    if (csvBtn) {
        if (approval === 'Aprovado') csvBtn.classList.remove('hidden');
        else csvBtn.classList.add('hidden');
    }

    if (!silent) {
        articlesGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem;"><i class="fas fa-spinner spin fa-2x"></i> Carregando...</div>';
    }
    
    try {
        updateStats();
        const res = await fetch(`api/articles?file_id=${currentFileId}&page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&oa_status=${oa}&year=${year}&dl_status=${dl}&approval_status=${approval}`);
        const data = await res.json();
        renderArticles(data.data);
        updatePagination(data.page, data.total_pages, data.total);
    } catch (e) {
        if (!silent) articlesGrid.innerHTML = '<div style="color: #ef4444; grid-column: 1/-1;">Erro ao carregar artigos.</div>';
    }
}

function renderArticles(articles) {
    articlesGrid.innerHTML = '';
    if (articles.length === 0) {
        articlesGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8;">Nenhum artigo encontrado.</div>';
        return;
    }

    articles.forEach(article => {
        const card = document.createElement('div');
        card.className = 'article-card';
        card.id = `card-${article.id}`;
        
        let oaClass = 'badge-unknown', oaText = 'Não Verificado';
        if (article.open_access === 'Sim') { oaClass = 'badge-oa'; oaText = 'Livre (OA)'; }
        if (article.open_access === 'Não') { oaClass = 'badge-closed'; oaText = 'Fechado'; }

        let dlBadge = '';
        if (article.download_status === 'Baixado') dlBadge = `<span class="badge" style="background: rgba(59,130,246,0.2); color: #60a5fa;"><i class="fas fa-check"></i> Baixado</span>`;
        else if (article.download_status === 'Disponível') dlBadge = `<span class="badge" style="background: rgba(16,185,129,0.2); color: #34d399;"><i class="fas fa-cloud-download-alt"></i> Disponível</span>`;
        else if (article.download_status === 'Indisponível') dlBadge = `<span class="badge" style="background: rgba(245,158,11,0.2); color: #fbbf24;"><i class="fas fa-ban"></i> Indisponível</span>`;
        else if (article.download_status === 'Erro') dlBadge = `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171;" title="${article.download_error}"><i class="fas fa-exclamation-triangle"></i> Erro Download</span>`;

        let approvalBadge = '';
        if (article.approval_status === 'Aprovado') approvalBadge = `<span class="badge badge-approved"><i class="fas fa-check"></i> Aprovado</span>`;
        else if (article.approval_status === 'Rejeitado') approvalBadge = `<span class="badge badge-rejected"><i class="fas fa-times"></i> Rejeitado</span>`;

        let llmBadge = '';
        if (article.llm_analyzed === 1) llmBadge = `<span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc;"><i class="fas fa-robot"></i> LLM</span>`;

        const isChecked = selectedArticleIds.has(article.id) ? 'checked' : '';

        // Store raw metadata string directly in a data attribute
        const encodedRaw = encodeURIComponent(article.raw_metadata || '{}');

        card.innerHTML = `
            <input type="checkbox" class="card-select-cb" data-id="${article.id}" ${isChecked}>
            <div class="card-body">
                <div class="card-title" title="Clique para ver detalhes" onclick="openDetails('${encodedRaw}', ${article.id}, '${article.approval_status}')">${article.title || 'Título Indisponível'}</div>
                <div class="card-authors">${article.authors || 'Autores desconhecidos'}</div>
                <div class="card-meta">
                    <span><i class="far fa-calendar"></i> ${article.year || 'N/D'}</span>
                    <span class="badge ${oaClass}" id="oa-badge-${article.id}">${oaText}</span>
                    ${dlBadge}
                    ${approvalBadge}
                    ${llmBadge}
                </div>
            </div>
            <div class="card-actions" style="flex-direction: column;" id="actions-${article.id}">
                ${renderActionButtons(article)}
            </div>
        `;
        
        articlesGrid.appendChild(card);
    });

    document.querySelectorAll('.card-select-cb').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = parseInt(e.target.dataset.id);
            if(e.target.checked) selectedArticleIds.add(id);
            else selectedArticleIds.delete(id);
            checkSelectAllStatus(articles);
            updateActionBar();
        });
    });
    
    checkSelectAllStatus(articles);
}

function renderActionButtons(article) {
    let btns = '';
    
    if (article.approval_status !== 'Aprovado' && article.approval_status !== 'Rejeitado') {
        btns += `<button class="btn-card-action approve-btn" onclick="approveArticle(${article.id})"><i class="fas fa-thumbs-up"></i> Aprovar</button>`;
        btns += `<button class="btn-card-action reject-btn" onclick="rejectArticle(${article.id})"><i class="fas fa-thumbs-down"></i> Rejeitar</button>`;
    } else if (article.approval_status === 'Rejeitado') {
        btns += `<button class="btn-card-action approve-btn" onclick="approveArticle(${article.id})"><i class="fas fa-thumbs-up"></i> Rev. p/ Aprovar</button>`;
    }

    let html = '';
    if (btns !== '') {
        html += `<div style="display:flex; gap: 0.5rem; width: 100%; margin-bottom: 0.5rem;">${btns}</div>`;
    }

    if (article.approval_status === 'Aprovado') {
        html += `<button class="btn-card-action send-main-btn" onclick="sendToMainCuration(${article.id})"><i class="fas fa-rocket"></i> Enviar para Curadoria</button>`;
    }

    html += `<div style="display:flex; gap: 0.5rem; width: 100%; align-items: center; justify-content: center; margin-top: 0.5rem;">`;
    if (article.pdf_path) {
        html += `<button class="btn-card-action open" style="flex:1" onclick="window.open('${article.pdf_path}', '_blank')"><i class="fas fa-file-pdf"></i> PDF</button>`;
    } else if (article.open_access === 'Sim') {
        html += `<button class="btn-card-action download" style="flex:1" onclick="checkOASingle(${article.id}, this)"><i class="fas fa-download"></i> Baixar PDF</button>`;
    } else if (article.open_access === 'Não') {
        html += `<button class="btn-card-action check verify-btn" style="flex:1" onclick="checkOASingle(${article.id}, this)"><i class="fas fa-search-dollar"></i> Verif. Dnv</button>`;
    } else if (article.doi) {
        html += `<button class="btn-card-action check verify-btn" style="flex:1" onclick="checkOASingle(${article.id}, this)"><i class="fas fa-search-dollar"></i> Verificar Acesso</button>`;
    } else {
        html += `<span style="color: #64748b; font-size: 0.8rem; padding: 0.6rem; flex:1; text-align: center;">Sem DOI</span>`;
    }
    html += `</div>`;

    return html;
}

function updatePagination(page, totalPages, total) {
    pageInfo.textContent = `Página ${page} de ${totalPages || 1}`;
    totalArticlesSpan.textContent = `${total} artigos filtrados`;
    prevPageBtn.disabled = page <= 1;
    nextPageBtn.disabled = page >= totalPages || totalPages === 0;
}

// Single item actions
window.checkOASingle = async function(id, btnElement) {
    btnElement.innerHTML = '<i class="fas fa-spinner spin"></i> Aguarde...';
    btnElement.disabled = true;
    
    // For single check, we use verify, for download we use download endpoint directly
    const isDownload = btnElement.classList.contains('download');
    const endpoint = isDownload ? `api/download/${id}` : `api/check_oa/${id}`;

    try {
        await fetch(endpoint, { method: 'POST' });
        // Instead of managing DOM manually which gets complex with download errors, 
        // we can just reload the current page. Since we are on current page, it's fast.
        loadArticles(currentPage);
    } catch(e) { alert('Erro na requisição'); loadArticles(currentPage); }
}

// Details logic
let currentModalArticleId = null;

window.openDetails = function(encodedRaw, id, approvalStatus) {
    try {
        currentModalArticleId = id;
        currentRawMetadata = JSON.parse(decodeURIComponent(encodedRaw));
        let html = '<table class="details-table"><tbody>';
        for (const [key, value] of Object.entries(currentRawMetadata)) {
            html += `<tr><th>${key}</th><td>${value || '-'}</td></tr>`;
        }
        html += '</tbody></table>';
        detailsBody.innerHTML = html;
        
        // Reset tabs
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('tabMetadata').classList.add('active');
        document.querySelector('.tab-btn[onclick="switchTab(\'tabMetadata\')"]').classList.add('active');
        
        // Restore LLM state from cache if exists
        const cachedAnalyses = window.llmResultsCache ? window.llmResultsCache[id] : null;
        if (cachedAnalyses && Array.isArray(cachedAnalyses)) {
            document.getElementById('llmResultsArea').style.display = 'block';
            document.getElementById('llmLoading').style.display = 'none';
            const answersView = document.getElementById('llmAnswers');
            answersView.style.display = 'flex';
            answersView.innerHTML = ''; // Limpa antigas
            
            cachedAnalyses.forEach(analysis => {
                const row = document.createElement('div');
                row.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 1rem; border-radius: 6px;";
                
                const label = document.createElement('span');
                label.style.cssText = "font-weight: 600; color: #cbd5e1; max-width: 40%;";
                label.textContent = analysis.question;
                
                const value = document.createElement('span');
                value.style.cssText = "padding: 0.25rem 1rem; border-radius: 6px; font-weight: bold; background: #334155; color: white; max-width: 55%; text-align: right; word-wrap: break-word;";
                
                let txt = (analysis.answer || "").trim();
                if (!txt) txt = "-";
                
                if (analysis.question === "Cana?") {
                    value.style.borderRadius = "999px";
                    if (txt.toUpperCase() === "SIM") value.style.background = "#059669";
                    else if (txt.toUpperCase() === "NÃO" || txt.toUpperCase() === "NAO") value.style.background = "#dc2626";
                } else {
                    value.style.fontSize = "0.9rem";
                }
                
                value.textContent = txt;
                row.appendChild(label);
                row.appendChild(value);
                answersView.appendChild(row);
            });
        } else {
            const llmResultsArea = document.getElementById('llmResultsArea');
            if (llmResultsArea) llmResultsArea.style.display = 'none';
        }

        const tabAiBtn = document.getElementById('tabAiBtn');
        if (approvalStatus === 'Aprovado') {
            tabAiBtn.classList.remove('hidden');
        } else {
            tabAiBtn.classList.add('hidden');
        }

        detailsModal.classList.remove('hidden');
    } catch(e) { console.error(e); }
}

window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');
}

window.modalRejectArticle = async function() {
    if (currentModalArticleId) {
        await rejectArticle(currentModalArticleId);
        detailsModal.classList.add('hidden');
    }
}

window.startLLMAnalysis = async function() {
    if (!currentModalArticleId) return;
    
    const btn = document.getElementById('btnAiAnalyze');
    const originalHtml = btn.innerHTML;
    
    // Disable buttons and show loading UI
    btn.innerHTML = '<i class="fas fa-spinner spin"></i> Iniciando...';
    btn.disabled = true;
    
    const resultsArea = document.getElementById('llmResultsArea');
    const loadingView = document.getElementById('llmLoading');
    const answersView = document.getElementById('llmAnswers');
    const answerCana = document.getElementById('llmAnswerCana');
    
    resultsArea.style.display = 'block';
    loadingView.style.display = 'flex';
    answersView.style.display = 'none';
    
    try {
        const response = await fetch(`api/articles/${currentModalArticleId}/analyze`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            let errorMsg = "Falha na análise LLM";
            try {
                const errData = await response.json();
                if(errData.error) errorMsg = errData.error;
            } catch(e) {}
            throw new Error(errorMsg);
        }
        const data = await response.json();
        
        // Update UI
        loadingView.style.display = 'none';
        answersView.style.display = 'flex';
        answersView.innerHTML = ''; // Limpa antigas
        
        let canaResult = 'ERRO';

        data.analyses.forEach(analysis => {
            const row = document.createElement('div');
            row.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 1rem; border-radius: 6px;";
            
            const label = document.createElement('span');
            label.style.cssText = "font-weight: 600; color: #cbd5e1; max-width: 40%;";
            label.textContent = analysis.question;
            
            const value = document.createElement('span');
            value.style.cssText = "padding: 0.25rem 1rem; border-radius: 6px; font-weight: bold; background: #334155; color: white; max-width: 55%; text-align: right; word-wrap: break-word;";
            
            let txt = (analysis.answer || "").trim();
            if (!txt) txt = "-";
            
            if (analysis.question === "Cana?") {
                value.style.borderRadius = "999px";
                if (txt.toUpperCase() === "SIM") {
                    value.style.background = "#059669";
                    canaResult = "SIM";
                } else if (txt.toUpperCase() === "NÃO" || txt.toUpperCase() === "NAO") {
                    value.style.background = "#dc2626";
                    canaResult = "NÃO";
                }
            } else {
                value.style.fontSize = "0.9rem";
            }
            
            value.textContent = txt;
            row.appendChild(label);
            row.appendChild(value);
            answersView.appendChild(row);
        });

        // Save only full raw array to cache to restore all rows
        window.llmResultsCache = window.llmResultsCache || {};
        window.llmResultsCache[currentModalArticleId] = data.analyses;

        // Update llm_analyzed badge locally
        const cardTitle = document.querySelector(`.card-select-cb[data-id="${currentModalArticleId}"]`)?.closest('.article-card')?.querySelector('.card-meta');
        if (cardTitle && !cardTitle.innerHTML.includes('fa-robot')) {
            cardTitle.innerHTML += ` <span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc;"><i class="fas fa-robot"></i> LLM</span>`;
        }
        
    } catch(e) {
        console.error(e);
        alert('Erro ao realizar a análise com LLM: ' + e.message);
        resultsArea.style.display = 'none';
    } finally {
        // Restore button state
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

window.clearLlmAnalysis = function() {
    if (currentModalArticleId && window.llmResultsCache) {
        delete window.llmResultsCache[currentModalArticleId];
    }
    document.getElementById('llmResultsArea').style.display = 'none';
}

closeDetailsBtn.addEventListener('click', () => detailsModal.classList.add('hidden'));

exportJsonBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentRawMetadata, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", "metadados_artigo.json");
    document.body.appendChild(a);
    a.click();
    a.remove();
});

// Selection Logic
function updateActionBar() {
    if(selectedArticleIds.size > 0) {
        actionBar.classList.remove('hidden');
        selectedCountSpan.textContent = `${selectedArticleIds.size} artigos selecionados`;
    } else {
        actionBar.classList.add('hidden');
    }
}

document.getElementById('clearSelectionBtn').addEventListener('click', () => {
    selectedArticleIds.clear();
    document.querySelectorAll('.card-select-cb').forEach(cb => cb.checked = false);
    const selectAllPageCb = document.getElementById('selectAllPageCb');
    if (selectAllPageCb) selectAllPageCb.checked = false;
    if (selectAllResultsCb) selectAllResultsCb.checked = false;
    updateActionBar();
});

function checkSelectAllStatus(articles) {
    const selectAllPageCb = document.getElementById('selectAllPageCb');
    if (!selectAllPageCb) return;
    if (articles.length === 0) { selectAllPageCb.checked = false; return; }
    const allSelectedOnPage = articles.every(a => selectedArticleIds.has(a.id));
    selectAllPageCb.checked = allSelectedOnPage;
}

const selectAllPageCb = document.getElementById('selectAllPageCb');
if (selectAllPageCb) {
    selectAllPageCb.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        document.querySelectorAll('.card-select-cb').forEach(cb => {
            cb.checked = isChecked;
            const id = parseInt(cb.dataset.id);
            if (isChecked) selectedArticleIds.add(id);
            else selectedArticleIds.delete(id);
        });
        updateActionBar();
    });
}

if (selectAllResultsCb) {
    selectAllResultsCb.addEventListener('change', async (e) => {
        const isChecked = e.target.checked;
        if (!isChecked) {
            selectedArticleIds.clear();
            document.querySelectorAll('.card-select-cb').forEach(cb => cb.checked = false);
            const selectAllPageCb = document.getElementById('selectAllPageCb');
            if (selectAllPageCb) selectAllPageCb.checked = false;
            updateActionBar();
            return;
        }

        const label = e.target.nextElementSibling;
        const origHtml = label.innerHTML;
        label.innerHTML = '<i class="fas fa-spinner spin"></i> Selecionando...';
        e.target.disabled = true;

        const search = searchInput.value;
        const oa = oaFilter.value;
        const year = yearFilter.value;
        const dl = dlFilter.value;
        const approval = approvalFilter ? approvalFilter.value : 'default';

        try {
            const res = await fetch(`api/articles/ids?file_id=${currentFileId}&search=${encodeURIComponent(search)}&oa_status=${oa}&year=${year}&dl_status=${dl}&approval_status=${approval}`);
            const data = await res.json();
            
            data.ids.forEach(id => selectedArticleIds.add(id));
            
            // Update checkboxes on current page
            document.querySelectorAll('.card-select-cb').forEach(cb => {
                const id = parseInt(cb.dataset.id);
                if (selectedArticleIds.has(id)) {
                    cb.checked = true;
                }
            });
            const selectAllPageCb = document.getElementById('selectAllPageCb');
            if (selectAllPageCb) selectAllPageCb.checked = true;
            
            updateActionBar();
        } catch(err) {
            console.error(err);
            alert("Erro ao selecionar todos.");
            e.target.checked = false;
        }
        
        label.innerHTML = origHtml;
        e.target.disabled = false;
    });
}


// Batch Processing & Background Jobs Logic
function startPollingJob(jobId, title, successLabel, failLabel, btnId, origHtml) {
    activeJobId = jobId;
    
    document.getElementById('batchTitle').textContent = title;
    document.getElementById('batchSuccessLabel').textContent = successLabel;
    document.getElementById('batchFailLabel').textContent = failLabel;
    batchModal.classList.remove('hidden');
    hideBatchBtn.classList.remove('hidden');
    closeBatchBtn.classList.add('hidden');
    
    // Change top buttons to 'Ver Progresso'
    if(btnId) {
        document.getElementById(btnId).innerHTML = '<i class="fas fa-eye"></i> Ver Progresso Atual';
    }
    
    if(jobPollInterval) clearInterval(jobPollInterval);
    
    jobPollInterval = setInterval(async () => {
        try {
            const res = await fetch(`api/batch/status/${jobId}`);
            const data = await res.json();
            
            if(data.error) { clearInterval(jobPollInterval); return; }
            
            document.getElementById('batchSuccessCount').textContent = data.success;
            document.getElementById('batchFailCount').textContent = data.fail;
            const rem = data.total - data.processed;
            document.getElementById('batchRemainingCount').textContent = rem;
            
            const pct = Math.floor((data.processed / data.total) * 100);
            document.getElementById('batchProgressBar').style.width = pct + "%";
            document.getElementById('batchStatusText').textContent = `Processando: ${data.processed} de ${data.total}`;
            
            if(data.status === 'completed') {
                clearInterval(jobPollInterval);
                document.getElementById('batchStatusText').textContent = "Concluído!";
                hideBatchBtn.classList.add('hidden');
                closeBatchBtn.classList.remove('hidden');
                activeJobId = null;
                
                if(btnId && origHtml) {
                    document.getElementById(btnId).innerHTML = origHtml;
                }
                
                loadArticles(currentPage, true);
            }
        } catch(e) { console.error(e); }
    }, 2000);
}

hideBatchBtn.addEventListener('click', () => {
    batchModal.classList.add('hidden');
});

closeBatchBtn.addEventListener('click', () => {
    batchModal.classList.add('hidden');
});

document.getElementById('verifySelectedBtn').addEventListener('click', async () => {
    if(activeJobId && !document.getElementById('batchModal').classList.contains('hidden') === false) {
        batchModal.classList.remove('hidden');
        return;
    }
    if(selectedArticleIds.size === 0) return;
    
    const ids = Array.from(selectedArticleIds);
    try {
        const res = await fetch('api/batch/verify', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({article_ids: ids})
        });
        const data = await res.json();
        startPollingJob(data.job_id, "Verificando Lote", "Abertos", "Fechados", 'verifySelectedBtn', '<i class="fas fa-search-dollar"></i> Verificar Acesso');
    } catch(e) { alert("Erro ao iniciar lote."); }
});

document.getElementById('fetchDownloadBtn').addEventListener('click', async () => {
    if(activeJobId && !document.getElementById('batchModal').classList.contains('hidden') === false) {
        batchModal.classList.remove('hidden');
        return;
    }
    if(selectedArticleIds.size === 0) return;
    
    const ids = Array.from(selectedArticleIds);
    try {
        const res = await fetch('api/batch/download', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({article_ids: ids})
        });
        const data = await res.json();
        startPollingJob(data.job_id, "Efetuando Downloads", "Sucesso", "Falhas", 'fetchDownloadBtn', '<i class="fas fa-cloud-download-alt"></i> Efetuar Download (Servidor)');
    } catch(e) { alert("Erro ao iniciar lote de download."); }
});

// Download ZIP Logic
document.getElementById('downloadSelectedBtn').addEventListener('click', async (e) => {
    if(selectedArticleIds.size === 0) return;
    const btn = e.target;
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner spin"></i> Preparando ZIP...';
    btn.disabled = true;

    try {
        const res = await fetch('api/download_zip', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({article_ids: Array.from(selectedArticleIds)})
        });
        
        if(!res.ok) {
            const err = await res.json();
            alert(err.error || "Erro ao baixar ZIP.");
            btn.innerHTML = origHtml;
            btn.disabled = false;
            return;
        }
        
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "artigos_selecionados.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch(err) {
        alert("Erro na requisição.");
    }
    
    btn.innerHTML = origHtml;
    btn.disabled = false;
});

applyFiltersBtn.addEventListener('click', () => loadArticles(1));
searchInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') loadArticles(1); });
prevPageBtn.addEventListener('click', () => loadArticles(currentPage - 1));
nextPageBtn.addEventListener('click', () => loadArticles(currentPage + 1));

// Init
loadFiles();
