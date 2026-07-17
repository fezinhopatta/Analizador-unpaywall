let currentPage = 1;
const limit = 24;

const uploadZone = document.getElementById('uploadZone');
const csvFile = document.getElementById('csvFile');
const uploadStatus = document.getElementById('uploadStatus');
const articlesGrid = document.getElementById('articlesGrid');
const searchInput = document.getElementById('searchInput');
const oaFilter = document.getElementById('oaFilter');
const yearFilter = document.getElementById('yearFilter');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const totalArticlesSpan = document.getElementById('totalArticles');

uploadZone.addEventListener('click', () => csvFile.click());

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = '#2563eb';
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.style.borderColor = '#3b82f6';
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = '#3b82f6';
    if (e.dataTransfer.files.length) {
        handleUpload(e.dataTransfer.files[0]);
    }
});

csvFile.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleUpload(e.target.files[0]);
    }
});

async function handleUpload(file) {
    if (!file.name.endsWith('.csv')) {
        alert('Por favor, selecione um arquivo CSV.');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    uploadZone.classList.add('hidden');
    uploadStatus.classList.remove('hidden');

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        setTimeout(() => {
            uploadStatus.textContent = "Processamento concluído. Carregando artigos...";
            loadFilters();
            loadArticles(1);
        }, 5000);
        
    } catch (error) {
        alert('Erro ao enviar arquivo.');
        uploadZone.classList.remove('hidden');
        uploadStatus.classList.add('hidden');
    }
}

const loadHardcodedBtn = document.getElementById('loadHardcodedBtn');
const hardcodedPathInput = document.getElementById('hardcodedPath');

if(loadHardcodedBtn) {
    loadHardcodedBtn.addEventListener('click', async () => {
        const filepath = hardcodedPathInput.value.trim();
        if(!filepath) {
            alert('Digite o caminho do arquivo.');
            return;
        }

        uploadZone.classList.add('hidden');
        uploadStatus.classList.remove('hidden');
        uploadStatus.textContent = "Carregando arquivo de teste...";

        try {
            const response = await fetch('/api/load-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filepath })
            });
            const data = await response.json();
            
            if(data.error) {
                alert(data.error);
                uploadZone.classList.remove('hidden');
                uploadStatus.classList.add('hidden');
                return;
            }

            setTimeout(() => {
                uploadStatus.textContent = "Processamento concluído. Carregando artigos...";
                loadFilters();
                loadArticles(1);
            }, 3000);
        } catch (error) {
            alert('Erro ao carregar arquivo de teste.');
            uploadZone.classList.remove('hidden');
            uploadStatus.classList.add('hidden');
        }
    });
}

async function loadFilters() {
    try {
        const response = await fetch('/api/filters');
        const data = await response.json();
        
        yearFilter.innerHTML = '<option value="all">Todos os Anos</option>';
        data.years.forEach(year => {
            if (year) {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                yearFilter.appendChild(option);
            }
        });
    } catch (e) {
        console.error("Erro ao carregar filtros", e);
    }
}

async function loadArticles(page = 1) {
    currentPage = page;
    const search = searchInput.value;
    const oa = oaFilter.value;
    const year = yearFilter.value;

    try {
        articlesGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem;"><i class="fas fa-spinner spin fa-2x"></i> Carregando...</div>';
        
        const response = await fetch(`/api/articles?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&oa_status=${oa}&year=${year}`);
        const data = await response.json();
        
        renderArticles(data.data);
        updatePagination(data.page, data.total_pages, data.total);
    } catch (error) {
        articlesGrid.innerHTML = '<div style="color: #ef4444; grid-column: 1/-1;">Erro ao carregar artigos. Verifique a conexão.</div>';
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
        
        let oaClass = 'badge-unknown';
        let oaText = 'Não Verificado';
        if (article.open_access === 'Sim') { oaClass = 'badge-oa'; oaText = 'Livre (OA)'; }
        if (article.open_access === 'Não') { oaClass = 'badge-closed'; oaText = 'Fechado'; }

        let actionButtons = '';
        
        if (article.pdf_path) {
            actionButtons = `<button class="btn-icon open" onclick="window.open('/${article.pdf_path}', '_blank')"><i class="fas fa-file-pdf"></i> Abrir PDF</button>`;
        } else if (article.open_access === 'Sim') {
            actionButtons = `<button class="btn-icon download" onclick="downloadPdf(${article.id}, this)"><i class="fas fa-download"></i> Baixar PDF</button>`;
        } else if (article.doi) {
            actionButtons = `<button class="btn-icon check" onclick="checkOA(${article.id}, this)"><i class="fas fa-search-dollar"></i> Verificar Acesso</button>`;
        } else {
            actionButtons = `<span style="color: #64748b; font-size: 0.8rem; padding: 0.6rem;">Sem DOI para verificar</span>`;
        }

        card.innerHTML = `
            <div class="card-title" title="${article.title}">${article.title || 'Título Indisponível'}</div>
            <div class="card-authors">${article.authors || 'Autores desconhecidos'}</div>
            <div class="card-meta">
                <span><i class="far fa-calendar"></i> ${article.year || 'N/D'}</span>
                <span class="badge ${oaClass}">${oaText}</span>
            </div>
            <div class="card-actions">
                ${actionButtons}
                ${article.link ? `<a href="${article.link}" target="_blank" class="btn-icon"><i class="fas fa-external-link-alt"></i></a>` : ''}
            </div>
        `;
        
        articlesGrid.appendChild(card);
    });
}

function updatePagination(page, totalPages, total) {
    pageInfo.textContent = `Página ${page} de ${totalPages || 1}`;
    totalArticlesSpan.textContent = `${total} artigos encontrados`;
    
    prevPageBtn.disabled = page <= 1;
    nextPageBtn.disabled = page >= totalPages || totalPages === 0;
}

window.checkOA = async function(id, btnElement) {
    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fas fa-spinner spin"></i> Verificando...';
    btnElement.disabled = true;
    
    try {
        const response = await fetch(`/api/check_oa/${id}`, { method: 'POST' });
        await response.json();
        loadArticles(currentPage);
    } catch (e) {
        console.error(e);
        btnElement.innerHTML = originalHtml;
        btnElement.disabled = false;
        alert('Erro ao verificar.');
    }
}

window.downloadPdf = async function(id, btnElement) {
    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fas fa-spinner spin"></i> Baixando...';
    btnElement.disabled = true;
    
    try {
        const response = await fetch(`/api/download/${id}`, { method: 'POST' });
        const data = await response.json();
        if (data.path) {
            loadArticles(currentPage);
        } else {
            alert('Não foi possível baixar o arquivo.');
            btnElement.innerHTML = originalHtml;
            btnElement.disabled = false;
        }
    } catch (e) {
        console.error(e);
        btnElement.innerHTML = originalHtml;
        btnElement.disabled = false;
        alert('Erro ao realizar download.');
    }
}

applyFiltersBtn.addEventListener('click', () => loadArticles(1));
searchInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') loadArticles(1); });
prevPageBtn.addEventListener('click', () => loadArticles(currentPage - 1));
nextPageBtn.addEventListener('click', () => loadArticles(currentPage + 1));

loadFilters();
loadArticles();
