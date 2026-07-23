/* ================================================================
   应用主逻辑 — 书架管理、导入、视图切换
   ================================================================ */

const App = {
    // 当前选中的书籍 ID（用于删除确认）
    _pendingDeleteBookId: null,

    /**
     * 初始化应用
     */
    async init() {
        this._cacheDom();
        this._bindEvents();
        await this._loadLibrary();

        // 监听阅读器进度变化（用于更新书架显示）
        reader.onProgressChange = (bookId, page) => {
            this._updateBookCardProgress(bookId, page);
        };
    },

    /**
     * 缓存 DOM 元素引用
     */
    _cacheDom() {
        // 视图
        this.libraryView = document.getElementById('library-view');
        this.readerView = document.getElementById('reader-view');

        // 书架元素
        this.bookGrid = document.getElementById('book-grid');
        this.emptyState = document.getElementById('empty-state');
        this.libraryContent = document.getElementById('library-content');

        // 按钮
        this.btnImport = document.getElementById('btn-import');
        this.btnImportEmpty = document.getElementById('btn-import-empty');
        this.btnBack = document.getElementById('btn-back');

        // 导入弹窗
        this.importModal = document.getElementById('import-modal');
        this.btnCloseModal = document.getElementById('btn-close-modal');
        this.uploadArea = document.getElementById('upload-area');
        this.fileInput = document.getElementById('file-input');

        // 删除弹窗
        this.deleteModal = document.getElementById('delete-modal');
        this.btnCancelDelete = document.getElementById('btn-cancel-delete');
        this.btnConfirmDelete = document.getElementById('btn-confirm-delete');
        this.deleteBookName = document.getElementById('delete-book-name');

        // Toast
        this.toast = document.getElementById('toast');
        this.toastMessage = document.getElementById('toast-message');
    },

    /**
     * 绑定全局事件
     */
    _bindEvents() {
        // 导入按钮
        this.btnImport.addEventListener('click', () => this._showImportModal());
        this.btnImportEmpty.addEventListener('click', () => this._showImportModal());

        // 导入弹窗
        this.btnCloseModal.addEventListener('click', () => this._hideImportModal());
        this.importModal.addEventListener('click', (e) => {
            if (e.target === this.importModal) this._hideImportModal();
        });
        this.uploadArea.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this._handleFileSelect(e));

        // 返回按钮（从阅读器回到书架）
        this.btnBack.addEventListener('click', () => this._closeReader());

        // 删除弹窗
        this.btnCancelDelete.addEventListener('click', () => this._hideDeleteModal());
        this.btnConfirmDelete.addEventListener('click', () => this._confirmDelete());
        this.deleteModal.addEventListener('click', (e) => {
            if (e.target === this.deleteModal) this._hideDeleteModal();
        });

        // 浏览器/手机返回键处理
        window.addEventListener('popstate', (e) => {
            if (this.readerView.classList.contains('active')) {
                this._closeReader();
                e.preventDefault();
            }
        });
    },

    /* ================================================================
       书架管理
       ================================================================ */

    /**
     * 加载书架（从 IndexedDB 读取所有书籍）
     */
    async _loadLibrary() {
        try {
            const books = await getAllBooks();

            if (books.length === 0) {
                this._showEmptyState();
            } else {
                this._showBookGrid(books);
            }
        } catch (error) {
            console.error('[书架] 加载失败:', error);
            this._showToast('书架加载失败，请刷新页面');
        }
    },

    /**
     * 显示空状态
     */
    _showEmptyState() {
        this.emptyState.style.display = 'flex';
        this.bookGrid.style.display = 'none';
    },

    /**
     * 显示书籍网格
     * @param {Array} books
     */
    _showBookGrid(books) {
        this.emptyState.style.display = 'none';
        this.bookGrid.style.display = 'grid';
        this.bookGrid.innerHTML = '';

        books.forEach(book => {
            const card = this._createBookCard(book);
            this.bookGrid.appendChild(card);
        });
    },

    /**
     * 创建书籍卡片 DOM
     * @param {Object} book
     * @returns {HTMLElement}
     */
    _createBookCard(book) {
        const card = document.createElement('div');
        card.className = 'book-card';
        card.dataset.bookId = book.id;

        // 封面
        const cover = document.createElement('div');
        cover.className = 'book-card-cover';
        cover.innerHTML = '<span class="cover-placeholder">📖</span>';

        // 异步加载封面缩略图
        this._loadCoverImage(book.id, cover);

        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'book-card-delete';
        deleteBtn.innerHTML = '✕';
        deleteBtn.title = '删除此书';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._showDeleteModal(book);
        });

        // 信息区
        const info = document.createElement('div');
        info.className = 'book-card-info';

        const title = document.createElement('div');
        title.className = 'book-card-title';
        title.textContent = book.title;

        const meta = document.createElement('div');
        meta.className = 'book-card-meta';

        const pages = document.createElement('span');
        pages.textContent = `${book.totalPages || '?'} 页`;

        const progress = document.createElement('span');
        progress.className = 'book-card-progress';
        if (book.currentPage && book.currentPage > 1) {
            const percent = Math.round((book.currentPage / book.totalPages) * 100);
            progress.textContent = `${percent}%`;
        }

        meta.appendChild(pages);
        meta.appendChild(progress);
        info.appendChild(title);
        info.appendChild(meta);

        cover.appendChild(deleteBtn);
        card.appendChild(cover);
        card.appendChild(info);

        // 点击卡片打开阅读器
        card.addEventListener('click', () => this._openReader(book));

        return card;
    },

    /**
     * 异步加载封面图片
     */
    async _loadCoverImage(bookId, coverElement) {
        try {
            const coverData = await getCover(bookId);
            if (coverData) {
                const img = document.createElement('img');
                img.src = coverData;
                img.alt = '封面';
                // 移除占位符
                const placeholder = coverElement.querySelector('.cover-placeholder');
                if (placeholder) placeholder.remove();
                coverElement.appendChild(img);
            }
        } catch (error) {
            // 封面加载失败不阻塞，占位符保留
            console.log('[封面] 加载失败:', bookId);
        }
    },

    /**
     * 更新书籍卡片上的阅读进度
     */
    _updateBookCardProgress(bookId, page) {
        const card = this.bookGrid.querySelector(`[data-book-id="${bookId}"]`);
        if (!card) return;

        // 更新百分比，需要知道总页数
        const metaEl = card.querySelector('.book-card-meta span:last-child');
        if (metaEl) {
            // 从页面信息获取总页数
            const totalPages = reader.totalPages;
            if (totalPages > 0) {
                const percent = Math.round((page / totalPages) * 100);
                metaEl.textContent = `${percent}%`;
            }
        }
    },

    /* ================================================================
       书籍导入
       ================================================================ */

    /**
     * 显示导入弹窗
     */
    _showImportModal() {
        this.importModal.style.display = 'flex';
        this.fileInput.value = ''; // 清除之前的选择
    },

    /**
     * 隐藏导入弹窗
     */
    _hideImportModal() {
        this.importModal.style.display = 'none';
    },

    /**
     * 处理文件选择
     * @param {Event} event
     */
    async _handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // 验证文件类型
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            this._showToast('请选择 PDF 格式的文件');
            return;
        }

        // 验证文件大小（最大 100MB）
        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) {
            this._showToast('文件过大，请选择 100MB 以内的 PDF');
            return;
        }

        this._hideImportModal();

        try {
            await this._importBook(file);
            this._showToast('导入成功！');
            await this._loadLibrary();
        } catch (error) {
            console.error('[导入] 失败:', error);
            this._showToast('导入失败: ' + (error.message || '未知错误'));
        }
    },

    /**
     * 导入一本书（读取文件 → 保存到 IndexedDB → 生成封面）
     * @param {File} file
     */
    async _importBook(file) {
        // 读取文件为 ArrayBuffer
        const fileData = await this._readFileAsArrayBuffer(file);

        // 生成书籍 ID
        const bookId = generateId();

        // 解析 PDF 获取总页数并生成封面
        let totalPages = 0;
        let coverDataUrl = null;

        try {
            // 使用 PDF.js 解析（不渲染到屏幕）
            const loadingTask = pdfjsLib.getDocument({ data: fileData.slice(0) });
            const pdfDoc = await loadingTask.promise;
            totalPages = pdfDoc.numPages;

            // 生成第一页作为封面缩略图
            coverDataUrl = await this._generateCover(pdfDoc);
        } catch (error) {
            console.error('[导入] PDF 解析失败:', error);
            totalPages = 0;
        }

        // 书名：去掉 .pdf 后缀
        const title = file.name.replace(/\.pdf$/i, '');

        // 保存文件数据
        await saveFile(bookId, fileData);

        // 保存封面
        if (coverDataUrl) {
            await saveCover(bookId, coverDataUrl);
        }

        // 保存书籍元数据
        const book = {
            id: bookId,
            title: title,
            fileName: file.name,
            totalPages: totalPages,
            currentPage: 1,       // 初始为第 1 页
            addedAt: Date.now(),
            lastReadAt: Date.now(),
            fileSize: file.size,
        };
        await saveBook(book);
    },

    /**
     * 读取文件为 ArrayBuffer
     */
    _readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsArrayBuffer(file);
        });
    },

    /**
     * 生成封面缩略图（PDF 第一页的小尺寸渲染）
     */
    async _generateCover(pdfDoc) {
        try {
            const page = await pdfDoc.getPage(1);
            const viewport = page.getViewport({ scale: 0.3 }); // 小尺寸

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            await page.render({
                canvasContext: ctx,
                viewport: viewport,
                background: '#ffffff',
            }).promise;

            return canvas.toDataURL('image/jpeg', 0.7);
        } catch (error) {
            console.error('[封面] 生成失败:', error);
            return null;
        }
    },

    /* ================================================================
       阅读器打开与关闭
       ================================================================ */

    /**
     * 打开阅读器
     * @param {Object} book
     */
    async _openReader(book) {
        try {
            // 显示阅读器视图
            this._switchView('reader');

            // 加载 PDF 数据
            const fileData = await getFile(book.id);
            if (!fileData) {
                throw new Error('文件数据丢失，请重新导入');
            }

            // 更新阅读器的总页数（以防封面生成时未成功解析）
            if (book.totalPages === 0 && reader.totalPages > 0) {
                book.totalPages = reader.totalPages;
                await saveBook(book);
            }

            // 初始化阅读器，跳转到上次阅读位置
            const targetPage = book.currentPage || 1;
            await reader.loadPDF(book.id, fileData, book.title, targetPage);

            // 推送历史状态（支持返回键）
            history.pushState({ view: 'reader', bookId: book.id }, '', `#book=${book.id}`);

        } catch (error) {
            console.error('[阅读器] 打开失败:', error);
            this._showToast('打开失败: ' + (error.message || '未知错误'));
            this._switchView('library');
        }
    },

    /**
     * 关闭阅读器，返回书架
     */
    async _closeReader() {
        // 保存当前进度
        await reader.destroy();

        // 切换回书架视图
        this._switchView('library');

        // 刷新书架以更新进度显示
        await this._loadLibrary();

        // 清除历史状态
        if (history.state && history.state.view === 'reader') {
            history.back();
        }
    },

    /**
     * 切换视图
     * @param {'library'|'reader'} viewName
     */
    _switchView(viewName) {
        if (viewName === 'reader') {
            this.libraryView.classList.remove('active');
            this.readerView.classList.add('active');
        } else {
            this.readerView.classList.remove('active');
            this.libraryView.classList.add('active');
        }
    },

    /* ================================================================
       删除管理
       ================================================================ */

    /**
     * 显示删除确认弹窗
     */
    _showDeleteModal(book) {
        this._pendingDeleteBookId = book.id;
        this.deleteBookName.textContent = `确定要删除「${book.title}」吗？`;
        this.deleteModal.style.display = 'flex';
    },

    /**
     * 隐藏删除弹窗
     */
    _hideDeleteModal() {
        this.deleteModal.style.display = 'none';
        this._pendingDeleteBookId = null;
    },

    /**
     * 确认删除
     */
    async _confirmDelete() {
        if (!this._pendingDeleteBookId) return;

        const bookId = this._pendingDeleteBookId;
        this._hideDeleteModal();

        // 如果当前阅读器打开的是这本书，先关闭
        if (reader.bookId === bookId) {
            await reader.destroy();
            this._switchView('library');
        }

        try {
            await deleteBook(bookId);
            this._showToast('已删除');
            await this._loadLibrary();
        } catch (error) {
            console.error('[删除] 失败:', error);
            this._showToast('删除失败，请重试');
        }

        this._pendingDeleteBookId = null;
    },

    /* ================================================================
       Toast 消息
       ================================================================ */

    /**
     * 显示 Toast 消息
     * @param {string} message
     * @param {number} duration - 显示时长（毫秒）
     */
    _showToast(message, duration = 2000) {
        // 清除之前的定时器
        if (this._toastTimer) {
            clearTimeout(this._toastTimer);
        }

        this.toastMessage.textContent = message;
        this.toast.style.display = 'block';

        this._toastTimer = setTimeout(() => {
            this.toast.style.display = 'none';
        }, duration);
    },
};

/* ================================================================
   启动应用
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
    App.init().catch(error => {
        console.error('[应用] 初始化失败:', error);
    });
});
