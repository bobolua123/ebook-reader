/* ================================================================
   PDF 阅读器模块 — 渲染、翻页、手势、进度管理
   ================================================================ */

// 设置 PDF.js Worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/**
 * PDF 阅读器类
 * 封装 PDF 加载、渲染、翻页、手势等全部逻辑
 */
class PDFReader {
    constructor() {
        /** @type {pdfjsLib.PDFDocumentProxy|null} PDF 文档实例 */
        this.pdfDoc = null;

        /** @type {string} 当前书籍 ID */
        this.bookId = null;

        /** @type {number} 当前页码（1-based） */
        this.currentPage = 1;

        /** @type {number} 总页数 */
        this.totalPages = 0;

        /** @type {number} 当前渲染缩放比例 */
        this.currentScale = 1;

        /** @type {boolean} 是否正在渲染 */
        this.isRendering = false;

        /** @type {number|null} 进度保存定时器 */
        this.saveTimer = null;

        /** @type {Function|null} 进度变化回调 */
        this.onProgressChange = null;

        /* ---------- DOM 元素引用 ---------- */
        this.canvas = document.getElementById('pdf-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container = document.getElementById('reader-canvas-container');
        this.pageInfo = document.getElementById('reader-page-info');
        this.pageSlider = document.getElementById('page-slider');
        this.bookTitleEl = document.getElementById('reader-book-title');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.btnPrev = document.getElementById('btn-prev');
        this.btnNext = document.getElementById('btn-next');
        this.touchZoneLeft = document.getElementById('touch-zone-left');
        this.touchZoneRight = document.getElementById('touch-zone-right');
        this.readerTopbar = document.getElementById('reader-topbar');
        this.readerBottombar = document.getElementById('reader-bottombar');

        this._bindEvents();
    }

    /* ================================================================
       事件绑定
       ================================================================ */

    _bindEvents() {
        // 底部按钮
        this.btnPrev.addEventListener('click', () => this.prevPage());
        this.btnNext.addEventListener('click', () => this.nextPage());

        // 触摸区域（点击）
        this.touchZoneLeft.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prevPage();
        });
        this.touchZoneRight.addEventListener('click', (e) => {
            e.stopPropagation();
            this.nextPage();
        });

        // 滑动检测
        this._bindSwipe();

        // 页码滑块
        this.pageSlider.addEventListener('input', () => {
            const page = parseInt(this.pageSlider.value);
            this.pageInfo.textContent = `${page} / ${this.totalPages}`;
        });
        this.pageSlider.addEventListener('change', () => {
            const page = parseInt(this.pageSlider.value);
            this.goToPage(page);
        });

        // 键盘导航
        document.addEventListener('keydown', (e) => {
            if (!this.pdfDoc) return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
                e.preventDefault();
                this.nextPage();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.prevPage();
            }
        });

        // 窗口大小变化时重新渲染
        window.addEventListener('resize', () => {
            if (this.pdfDoc) {
                clearTimeout(this._resizeTimer);
                this._resizeTimer = setTimeout(() => this._renderPage(), 300);
            }
        });

        // 点击中间区域切换顶栏/底栏显示
        this.container.addEventListener('click', (e) => {
            // 只在点击 canvas 本身（非触摸区）时切换
            if (e.target === this.canvas) {
                this._toggleBars();
            }
        });
    }

    /**
     * 绑定滑动手势
     */
    _bindSwipe() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;

        const onTouchStart = (e) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchStartTime = Date.now();
            }
        };

        const onTouchEnd = (e) => {
            if (!this.pdfDoc) return;

            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const dx = touchEndX - touchStartX;
            const dy = touchEndY - touchStartY;
            const dt = Date.now() - touchStartTime;

            // 滑动距离阈值（px）
            const SWIPE_THRESHOLD = 50;
            // 滑动时间阈值（ms）
            const SWIPE_TIME_THRESHOLD = 500;

            // 只处理水平滑动（水平位移 > 垂直位移）
            if (Math.abs(dx) > Math.abs(dy) &&
                Math.abs(dx) > SWIPE_THRESHOLD &&
                dt < SWIPE_TIME_THRESHOLD) {

                if (dx < 0) {
                    // 向左滑动 → 下一页
                    this.nextPage();
                } else {
                    // 向右滑动 → 上一页
                    this.prevPage();
                }
            }
        };

        this.container.addEventListener('touchstart', onTouchStart, { passive: true });
        this.container.addEventListener('touchend', onTouchEnd, { passive: true });
    }

    /**
     * 切换顶部/底部栏的显示
     */
    _toggleBars() {
        const bars = [this.readerTopbar, this.readerBottombar];
        bars.forEach(bar => {
            const currentOpacity = window.getComputedStyle(bar).opacity;
            if (parseFloat(currentOpacity) > 0.5) {
                bar.style.opacity = '0';
                bar.style.pointerEvents = 'none';
            } else {
                bar.style.opacity = '1';
                bar.style.pointerEvents = 'auto';
            }
        });
    }

    /* ================================================================
       PDF 加载与渲染
       ================================================================ */

    /**
     * 从 ArrayBuffer 加载 PDF 并跳转到指定页
     * @param {string} bookId - 书籍 ID
     * @param {ArrayBuffer} fileData - PDF 文件数据
     * @param {string} title - 书名
     * @param {number} targetPage - 目标页码（1-based）
     */
    async loadPDF(bookId, fileData, title, targetPage = 1) {
        this.bookId = bookId;
        this.showLoading(true);

        try {
            // 加载 PDF 文档
            const loadingTask = pdfjsLib.getDocument({ data: fileData.slice(0) });
            this.pdfDoc = await loadingTask.promise;
            this.totalPages = this.pdfDoc.numPages;

            // 设置书名
            this.bookTitleEl.textContent = title;

            // 更新滑块范围
            this.pageSlider.min = 1;
            this.pageSlider.max = this.totalPages;
            this.pageSlider.value = targetPage;

            // 更新页面信息
            this.pageInfo.textContent = `${targetPage} / ${this.totalPages}`;

            // 更新按钮状态
            this._updateButtonStates(targetPage);

            // 跳转到目标页
            await this.goToPage(targetPage);

            this.showLoading(false);
        } catch (error) {
            console.error('[阅读器] PDF 加载失败:', error);
            this.showLoading(false);
            throw error;
        }
    }

    /**
     * 渲染指定页
     */
    async _renderPage() {
        if (!this.pdfDoc || this.isRendering) return;

        this.isRendering = true;

        try {
            const page = await this.pdfDoc.getPage(this.currentPage);

            // 计算适合容器的缩放比例
            const containerWidth = this.container.clientWidth;
            const containerHeight = this.container.clientHeight;
            const viewport = page.getViewport({ scale: 1 });

            // 计算缩放比例，使页面完整显示在容器内
            const scaleX = containerWidth / viewport.width;
            const scaleY = containerHeight / viewport.height;
            const scale = Math.min(scaleX, scaleY) * 0.95; // 留 5% 边距

            this.currentScale = scale;

            const scaledViewport = page.getViewport({ scale });

            // 设置 Canvas 尺寸（考虑设备像素比以保证清晰度）
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2); // 限制最大像素比
            this.canvas.width = scaledViewport.width * pixelRatio;
            this.canvas.height = scaledViewport.height * pixelRatio;
            this.canvas.style.width = scaledViewport.width + 'px';
            this.canvas.style.height = scaledViewport.height + 'px';

            // 缩放上下文
            this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

            // 渲染页面
            const renderContext = {
                canvasContext: this.ctx,
                viewport: scaledViewport,
                background: '#ffffff',
            };

            await page.render(renderContext).promise;

            // 更新 UI
            this.pageInfo.textContent = `${this.currentPage} / ${this.totalPages}`;
            this.pageSlider.value = this.currentPage;
            this._updateButtonStates(this.currentPage);

        } catch (error) {
            console.error('[阅读器] 渲染失败:', error);
        } finally {
            this.isRendering = false;
        }
    }

    /* ================================================================
       翻页控制
       ================================================================ */

    /**
     * 跳转到指定页
     * @param {number} page - 目标页码（1-based）
     */
    async goToPage(page) {
        if (!this.pdfDoc) return;

        // 页码范围检查
        const targetPage = Math.max(1, Math.min(page, this.totalPages));

        if (targetPage === this.currentPage) return;

        this.currentPage = targetPage;
        await this._renderPage();
        this._scheduleProgressSave();
    }

    /**
     * 下一页
     */
    async nextPage() {
        if (this.currentPage >= this.totalPages) return;
        await this.goToPage(this.currentPage + 1);
    }

    /**
     * 上一页
     */
    async prevPage() {
        if (this.currentPage <= 1) return;
        await this.goToPage(this.currentPage - 1);
    }

    /**
     * 更新翻页按钮状态
     */
    _updateButtonStates(page) {
        this.btnPrev.disabled = (page <= 1);
        this.btnNext.disabled = (page >= this.totalPages);
    }

    /* ================================================================
       进度保存
       ================================================================ */

    /**
     * 延迟保存阅读进度（防抖 1 秒）
     */
    _scheduleProgressSave() {
        if (this.saveTimer) clearTimeout(this.saveTimer);

        this.saveTimer = setTimeout(async () => {
            if (!this.bookId) return;

            try {
                await updateProgress(this.bookId, this.currentPage);
                console.log(`[阅读器] 进度已保存: 第 ${this.currentPage} 页`);

                if (this.onProgressChange) {
                    this.onProgressChange(this.bookId, this.currentPage);
                }
            } catch (error) {
                console.error('[阅读器] 进度保存失败:', error);
            }
        }, 1000);
    }

    /**
     * 立即保存进度（关闭阅读器时调用）
     */
    async saveProgressNow() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        if (!this.bookId) return;

        try {
            await updateProgress(this.bookId, this.currentPage);
            console.log(`[阅读器] 进度已立即保存: 第 ${this.currentPage} 页`);

            if (this.onProgressChange) {
                this.onProgressChange(this.bookId, this.currentPage);
            }
        } catch (error) {
            console.error('[阅读器] 进度保存失败:', error);
        }
    }

    /* ================================================================
       工具方法
       ================================================================ */

    /**
     * 显示/隐藏加载遮罩
     */
    showLoading(show) {
        this.loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    /**
     * 获取当前阅读状态
     */
    getStatus() {
        return {
            bookId: this.bookId,
            currentPage: this.currentPage,
            totalPages: this.totalPages,
        };
    }

    /**
     * 重置阅读器状态
     */
    reset() {
        this.pdfDoc = null;
        this.bookId = null;
        this.currentPage = 1;
        this.totalPages = 0;
        this.currentScale = 1;
        this.isRendering = false;

        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        // 清空画布
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.width = 0;
        this.canvas.height = 0;
        this.canvas.style.width = '';
        this.canvas.style.height = '';

        // 重置 UI
        this.bookTitleEl.textContent = '';
        this.pageInfo.textContent = '';
        this.pageSlider.value = 1;
        this.btnPrev.disabled = true;
        this.btnNext.disabled = true;

        // 显示顶栏和底栏
        this.readerTopbar.style.opacity = '1';
        this.readerTopbar.style.pointerEvents = 'auto';
        this.readerBottombar.style.opacity = '1';
        this.readerBottombar.style.pointerEvents = 'auto';
    }

    /**
     * 销毁阅读器
     */
    async destroy() {
        await this.saveProgressNow();

        if (this.pdfDoc) {
            await this.pdfDoc.destroy();
        }

        this.reset();
    }
}

// 创建全局阅读器实例
const reader = new PDFReader();
