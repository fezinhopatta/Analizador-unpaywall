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
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const totalArticlesSpan = document.getElementById('totalArticles');

const actionBar = document.getElementById('actionBar');
const selectedCountSpan = document.getElementById('selectedCountSpan');
const selectAllBtn = document.getElementById('selectAllBtn');

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
    
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
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

async function loadArticles(page = 1) {
    currentPage = page;
    const search = searchInput.value;
    const oa = oaFilter.value;
    const year = yearFilter.value;
    const dl = dlFilter.value;

    articlesGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem;"><i class="fas fa-spinner spin fa-2x"></i> Carregando...</div>';
    
    try {
        const res = await fetch(`api/articles?file_id=${currentFileId}&page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&oa_status=${oa}&year=${year}&dl_status=${dl}`);
        const data = await res.json();
        renderArticles(data.data);
        updatePagination(data.page, data.total_pages, data.total);
    } catch (e) {
        articlesGrid.innerHTML = '<div style="color: #ef4444; grid-column: 1/-1;">Erro ao carregar artigos.</div>';
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
        
        let oaClass = 'badge-unknown', oaText = 'Não Verificado';
        if (article.open_access === 'Sim') { oaClass = 'badge-oa'; oaText = 'Livre (OA)'; }
        if (article.open_access === 'Não') { oaClass = 'badge-closed'; oaText = 'Fechado'; }

        let dlBadge = '';
        if (article.download_status === 'Baixado') dlBadge = `<span class="badge" style="background: rgba(59,130,246,0.2); color: #60a5fa;"><i class="fas fa-check"></i> Baixado</span>`;
        else if (article.download_status === 'Erro') dlBadge = `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171;" title="${article.download_error}"><i class="fas fa-exclamation-triangle"></i> Erro Download</span>`;

        const isChecked = selectedArticleIds.has(article.id) ? 'checked' : '';

        // Store raw metadata string directly in a data attribute
        const encodedRaw = encodeURIComponent(article.raw_metadata || '{}');

        card.innerHTML = `
            <input type="checkbox" class="card-select-cb" data-id="${article.id}" ${isChecked}>
            <div class="card-title" title="Clique para ver detalhes" onclick="openDetails('${encodedRaw}')">${article.title || 'Título Indisponível'}</div>
            <div class="card-authors">${article.authors || 'Autores desconhecidos'}</div>
            <div class="card-meta">
                <span><i class="far fa-calendar"></i> ${article.year || 'N/D'}</span>
                <span class="badge ${oaClass}" id="oa-badge-${article.id}">${oaText}</span>
                ${dlBadge}
            </div>
            <div class="card-actions" id="actions-${article.id}">
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
            updateActionBar();
        });
    });
}

function renderActionButtons(article) {
    if (article.pdf_path) {
        return `<button class="btn-icon open" onclick="window.open('${article.pdf_path}', '_blank')"><i class="fas fa-file-pdf"></i> Abrir PDF</button>`;
    } else if (article.open_access === 'Sim') {
        return `<button class="btn-icon download" onclick="checkOASingle(${article.id}, this)"><i class="fas fa-download"></i> Baixar PDF</button>`;
    } else if (article.doi) {
        return `<button class="btn-icon check" onclick="checkOASingle(${article.id}, this)"><i class="fas fa-search-dollar"></i> Verificar Acesso</button>`;
    } else {
        return `<span style="color: #64748b; font-size: 0.8rem; padding: 0.6rem;">Sem DOI</span>`;
    }
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
window.openDetails = function(encodedRaw) {
    try {
        currentRawMetadata = JSON.parse(decodeURIComponent(encodedRaw));
        let html = '<table class="details-table"><tbody>';
        for (const [key, value] of Object.entries(currentRawMetadata)) {
            html += `<tr><th>${key}</th><td>${value || '-'}</td></tr>`;
        }
        html += '</tbody></table>';
        detailsBody.innerHTML = html;
        detailsModal.classList.remove('hidden');
    } catch(e) { console.error(e); }
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
    updateActionBar();
});

selectAllBtn.addEventListener('click', async (e) => {
    const btn = e.target;
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner spin"></i> Selecionando...';
    btn.disabled = true;

    const search = searchInput.value;
    const oa = oaFilter.value;
    const year = yearFilter.value;
    const dl = dlFilter.value;

    try {
        const res = await fetch(`api/articles/ids?file_id=${currentFileId}&search=${encodeURIComponent(search)}&oa_status=${oa}&year=${year}&dl_status=${dl}`);
        const data = await res.json();
        
        data.ids.forEach(id => selectedArticleIds.add(id));
        
        // Update checkboxes on current page
        document.querySelectorAll('.card-select-cb').forEach(cb => {
            const id = parseInt(cb.dataset.id);
            if (selectedArticleIds.has(id)) {
                cb.checked = true;
            }
        });
        
        updateActionBar();
    } catch(err) {
        console.error(err);
        alert("Erro ao selecionar todos.");
    }
    
    btn.innerHTML = origHtml;
    btn.disabled = false;
});


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
                
                loadArticles(currentPage);
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
