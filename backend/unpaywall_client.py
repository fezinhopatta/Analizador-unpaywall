import httpx
import os
import asyncio

EMAIL = "infovendas014@gmail.com"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTICLES_DIR = os.path.join(BASE_DIR, "artigos")

if not os.path.exists(ARTICLES_DIR):
    os.makedirs(ARTICLES_DIR)

async def check_open_access(doi: str):
    if not doi:
        return {"is_oa": False, "url": None}
    
    url = f"https://api.unpaywall.org/v2/{doi}?email={EMAIL}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.get(url)
            if response.status_code == 200:
                data = response.json()
                is_oa = data.get("is_oa", False)
                best_oa = data.get("best_oa_location", {})
                pdf_url = best_oa.get("url_for_pdf") if best_oa else None
                return {"is_oa": is_oa, "url": pdf_url}
        except Exception as e:
            print(f"Erro ao consultar DOI {doi}: {e}")
            
    return {"is_oa": False, "url": None}

async def download_pdf(doi: str, url: str):
    if not url:
        return {"path": "", "error": "URL não disponível"}
    
    safe_doi = doi.replace("/", "_")
    filename = f"{safe_doi}.pdf"
    filepath = os.path.join(ARTICLES_DIR, filename)
    
    if os.path.exists(filepath):
        return {"path": filepath, "error": ""}
        
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        try:
            response = await client.get(url)
            if response.status_code == 200:
                with open(filepath, 'wb') as f:
                    f.write(response.content)
                return {"path": filepath, "error": ""}
            else:
                return {"path": "", "error": f"Erro HTTP {response.status_code}"}
        except httpx.ReadTimeout:
            return {"path": "", "error": "Timeout na leitura"}
        except httpx.ConnectTimeout:
            return {"path": "", "error": "Timeout na conexão"}
        except Exception as e:
            return {"path": "", "error": f"Erro de conexão: {str(e)[:50]}"}

async def test_pdf_download(url: str):
    if not url:
        return False
        
    async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
        try:
            # First try a HEAD request
            response = await client.head(url)
            if response.status_code == 200:
                # Some servers return 200 for HEAD but it's an HTML page, we ideally check content-type
                ctype = response.headers.get("content-type", "").lower()
                if "pdf" in ctype:
                    return True
                    
            # If HEAD fails or gives inconclusive content-type, do a GET stream and check first chunk
            async with client.stream("GET", url) as stream_response:
                if stream_response.status_code == 200:
                    return True
            return False
        except Exception:
            return False
