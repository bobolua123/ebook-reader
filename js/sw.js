/* ================================================================
   Service Worker — 离线缓存与 PWA 支持
   ================================================================ */

const CACHE_NAME = 'ebook-reader-v1.0.0';

// 需要预缓存的静态资源（相对于 SW 所在目录的上级，即应用根目录）
const APP_ROOT = new URL('..', self.location).href;

const PRE_CACHE_URLS = [
    new URL('./', APP_ROOT).href,             // 根路径
    new URL('index.html', APP_ROOT).href,
    new URL('css/style.css', APP_ROOT).href,
    new URL('js/app.js', APP_ROOT).href,
    new URL('js/storage.js', APP_ROOT).href,
    new URL('js/reader.js', APP_ROOT).href,
    new URL('manifest.json', APP_ROOT).href,
    new URL('icons/icon-192.png', APP_ROOT).href,
    new URL('icons/icon-512.png', APP_ROOT).href,
];

// PDF.js CDN 资源（运行时缓存）
const PDF_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

/* ================================================================
   安装事件 — 预缓存静态资源
   ================================================================ */
self.addEventListener('install', (event) => {
    console.log('[SW] 安装中...');

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] 预缓存静态资源');
            // 逐个缓存，单个失败不影响整体
            return Promise.allSettled(
                PRE_CACHE_URLS.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`[SW] 缓存失败: ${url}`, err)
                    )
                )
            );
        }).then(() => {
            // 立即激活，不等待旧 SW
            return self.skipWaiting();
        })
    );
});

/* ================================================================
   激活事件 — 清理旧缓存
   ================================================================ */
self.addEventListener('activate', (event) => {
    console.log('[SW] 激活');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] 删除旧缓存:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            // 接管所有页面
            return self.clients.claim();
        })
    );
});

/* ================================================================
   请求拦截 — 缓存策略
   ================================================================ */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 跳过非 GET 请求
    if (event.request.method !== 'GET') return;

    // 跳过 chrome-extension 等非 http(s) 请求
    if (!url.protocol.startsWith('http')) return;

    // PDF.js CDN 资源 — 缓存优先
    if (url.href.startsWith(PDF_JS_CDN)) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // 本地静态资源 — 缓存优先
    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // 其他外部资源 — 仅网络
    event.respondWith(fetch(event.request));
});

/* ================================================================
   缓存策略实现
   ================================================================ */

/**
 * 缓存优先策略：先查缓存，缓存未命中则请求网络并缓存
 */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(request);

        // 只缓存成功的响应
        if (response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        console.warn('[SW] 网络请求失败:', request.url);
        // 对于非 HTML 请求返回错误
        // HTML 请求无法返回离线页面（本应用是 SPA）
        throw error;
    }
}
