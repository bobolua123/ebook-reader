/* ================================================================
   IndexedDB 存储层 — PDF 文件与阅读进度管理
   ================================================================ */

const DB_NAME = 'EBookReaderDB';
const DB_VERSION = 1;

/**
 * 数据库实例（懒加载单例）
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function(event) {
            const db = event.target.result;

            // 书籍元数据存储
            if (!db.objectStoreNames.contains('books')) {
                const bookStore = db.createObjectStore('books', { keyPath: 'id' });
                bookStore.createIndex('title', 'title', { unique: false });
                bookStore.createIndex('addedAt', 'addedAt', { unique: false });
            }

            // PDF 文件数据存储（大文件单独存）
            if (!db.objectStoreNames.contains('files')) {
                db.createObjectStore('files', { keyPath: 'bookId' });
            }

            // 封面缩略图存储
            if (!db.objectStoreNames.contains('covers')) {
                db.createObjectStore('covers', { keyPath: 'bookId' });
            }
        };

        request.onsuccess = function(event) {
            resolve(event.target.result);
        };

        request.onerror = function(event) {
            console.error('[存储] 数据库打开失败:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * 生成唯一 ID
 */
function generateId() {
    return 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/* ================================================================
   书籍元数据操作
   ================================================================ */

/**
 * 保存书籍信息
 * @param {Object} book - { id, title, fileName, totalPages, currentPage, addedAt, fileSize }
 */
async function saveBook(book) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        const store = tx.objectStore('books');
        store.put(book);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 获取所有书籍列表（按添加时间倒序）
 */
async function getAllBooks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readonly');
        const store = tx.objectStore('books');
        const request = store.getAll();

        request.onsuccess = () => {
            const books = request.result || [];
            // 按添加时间倒序排列
            books.sort((a, b) => b.addedAt - a.addedAt);
            resolve(books);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 获取单本书籍信息
 * @param {string} bookId
 */
async function getBook(bookId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readonly');
        const store = tx.objectStore('books');
        const request = store.get(bookId);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 更新阅读进度
 * @param {string} bookId
 * @param {number} currentPage
 */
async function updateProgress(bookId, currentPage) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        const store = tx.objectStore('books');
        const getReq = store.get(bookId);

        getReq.onsuccess = () => {
            const book = getReq.result;
            if (book) {
                book.currentPage = currentPage;
                book.lastReadAt = Date.now();
                store.put(book);
            }
        };
        getReq.onerror = (e) => reject(e.target.error);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
};

/**
 * 删除书籍（包括文件、封面和元数据）
 * @param {string} bookId
 */
async function deleteBook(bookId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['books', 'files', 'covers'], 'readwrite');

        tx.objectStore('books').delete(bookId);
        tx.objectStore('files').delete(bookId);
        tx.objectStore('covers').delete(bookId);

        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
};

/* ================================================================
   PDF 文件存储操作
   ================================================================ */

/**
 * 保存 PDF 文件数据
 * @param {string} bookId
 * @param {ArrayBuffer} fileData
 */
async function saveFile(bookId, fileData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        store.put({ bookId, data: fileData });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 获取 PDF 文件数据
 * @param {string} bookId
 * @returns {Promise<ArrayBuffer|null>}
 */
async function getFile(bookId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const store = tx.objectStore('files');
        const request = store.get(bookId);

        request.onsuccess = () => {
            const result = request.result;
            resolve(result ? result.data : null);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

/* ================================================================
   封面缩略图操作
   ================================================================ */

/**
 * 保存封面缩略图（base64 或 blob URL）
 * @param {string} bookId
 * @param {string} coverDataUrl
 */
async function saveCover(bookId, coverDataUrl) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('covers', 'readwrite');
        const store = tx.objectStore('covers');
        store.put({ bookId, data: coverDataUrl });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

/**
 * 获取封面缩略图
 * @param {string} bookId
 * @returns {Promise<string|null>}
 */
async function getCover(bookId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('covers', 'readonly');
        const store = tx.objectStore('covers');
        const request = store.get(bookId);

        request.onsuccess = () => {
            const result = request.result;
            resolve(result ? result.data : null);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

/* ================================================================
   存储空间估算
   ================================================================ */

/**
 * 获取已用存储空间估算（字节）
 */
async function getStorageEstimate() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
            usage: estimate.usage || 0,
            quota: estimate.quota || 0
        };
    }
    return { usage: 0, quota: 0 };
}

/**
 * 格式化文件大小
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}
