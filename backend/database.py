import sqlite3
import os

DB_PATH = 'metadata.db'

def get_connection():
    return sqlite3.connect(DB_PATH)

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS csv_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER,
            authors TEXT,
            title TEXT,
            year TEXT,
            source_title TEXT,
            doi TEXT,
            link TEXT,
            abstract TEXT,
            document_type TEXT,
            open_access TEXT,
            pdf_path TEXT,
            download_status TEXT, 
            download_error TEXT,
            raw_metadata TEXT,
            FOREIGN KEY(file_id) REFERENCES csv_files(id) ON DELETE CASCADE
        )
    ''')
    
    # Create indexes for faster queries
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_file_id ON articles(file_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_year ON articles(year)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_oa ON articles(open_access)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_doi ON articles(doi)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_dl_status ON articles(download_status)')
    
    conn.commit()
    conn.close()

def clear_db():
    # Only for total reset, but normally we just insert new files.
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    init_db()

def delete_file(file_id):
    conn = get_connection()
    cursor = conn.cursor()
    # Enable foreign keys for cascade delete
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("DELETE FROM csv_files WHERE id = ?", (file_id,))
    conn.commit()
    conn.close()
