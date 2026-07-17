import httpx
import os
import asyncio

EMAIL = "infovendas014@gmail.com"
ARTICLES_DIR = "artigos"

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

async def download_pdf(doi: str, url: str) -> str:
    if not url:
        return ""
    
    safe_doi = doi.replace("/", "_")
    filename = f"{safe_doi}.pdf"
    filepath = os.path.join(ARTICLES_DIR, filename)
    
    if os.path.exists(filepath):
        return filepath
        
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        try:
            response = await client.get(url)
            if response.status_code == 200:
                with open(filepath, 'wb') as f:
                    f.write(response.content)
                return filepath
        except Exception as e:
            print(f"Erro ao baixar {url}: {e}")
            
    return ""
