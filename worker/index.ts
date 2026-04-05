/**
 * MikuMod Proxy Worker
 *
 * 为被 GFW SNI 过滤且 CDN 强制要求 SNI 的域名提供 Cloudflare 边缘中转。
 * 对静态资源启用边缘缓存，大幅提升二次加载速度。
 */

interface Env {
  PROXY_SECRET: string;
}

const ALLOWED_HOSTS = new Set([
  'github.com', 'github.dev', 'api.github.com', 'github.githubassets.com',
  'education.github.com', 'resources.github.com', 'uploads.github.com',
  'archiveprogram.github.com', 'raw.githubusercontent.com', 'avatars.githubusercontent.com',
  'objects.githubusercontent.com', 'desktop.githubusercontent.com', 'media.githubusercontent.com',
  'camo.githubusercontent.com', 'github.io', 'gist.github.com', 'copilot.github.com',
  'alive.github.com',
  'twitch.tv', 'www.twitch.tv', 'api.twitch.tv', 'ttvnw.net',
  'www.recaptcha.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
]);

// 可以长期缓存的静态资源域名
const CACHEABLE_HOSTS = new Set([
  'github.githubassets.com',   // JS/CSS/图标
  'avatars.githubusercontent.com', // 头像
  'media.githubusercontent.com',
  'camo.githubusercontent.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

// 静态资源文件扩展名
const CACHEABLE_EXTS = /\.(js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|webm)(\?|$)/i;

const HOP_HEADERS = new Set([
  'host', 'x-proxy-host', 'x-proxy-secret',
  'connection', 'keep-alive', 'transfer-encoding',
  'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate',
]);

/**
 * 判断请求是否可以缓存
 */
function isCacheable(method: string, host: string, pathname: string): boolean {
  if (method !== 'GET') return false;
  // 静态资源域名全部缓存
  if (CACHEABLE_HOSTS.has(host)) return true;
  // 其他域名只缓存静态文件扩展名
  if (CACHEABLE_EXTS.test(pathname)) return true;
  return false;
}

/**
 * 根据资源类型决定缓存时长
 */
function getCacheTTL(host: string, pathname: string): number {
  // 字体/头像等长期不变的资源：7天
  if (host === 'fonts.gstatic.com' || host === 'fonts.googleapis.com') return 604800;
  if (host === 'avatars.githubusercontent.com') return 86400; // 头像1天
  // 带 hash 的静态资源（如 github.githubassets.com/assets/xxx-abc123.js）：30天
  if (host === 'github.githubassets.com') return 2592000;
  // 其他静态文件：1小时
  return 3600;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 鉴权
    const secret = request.headers.get('X-Proxy-Secret');
    if (!secret || secret !== env.PROXY_SECRET) {
      return new Response('Unauthorized', { status: 403 });
    }

    const targetHost = request.headers.get('X-Proxy-Host');
    if (!targetHost) {
      return new Response('Missing X-Proxy-Host', { status: 400 });
    }

    // 白名单
    const hostLower = targetHost.toLowerCase();
    const isAllowed = ALLOWED_HOSTS.has(hostLower) ||
      [...ALLOWED_HOSTS].some(h => hostLower.endsWith('.' + h));
    if (!isAllowed) {
      return new Response(`Host not allowed: ${targetHost}`, { status: 403 });
    }

    const url = new URL(request.url);
    const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
    const shouldCache = isCacheable(request.method, hostLower, url.pathname);

    // 如果可缓存，先查 CF 边缘缓存
    if (shouldCache) {
      const cacheKey = new Request(targetUrl, { method: 'GET' });
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) {
        // 命中缓存，直接返回（添加标记头）
        const resp = new Response(cached.body, cached);
        resp.headers.set('X-Cache', 'HIT');
        return resp;
      }
    }

    // 构建上游请求头
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (!HOP_HEADERS.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
    headers.set('Host', targetHost);
    // 允许压缩，减少传输体积
    headers.set('Accept-Encoding', 'gzip, br');

    // 转发请求
    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    });

    // 构建响应
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('X-Cache', 'MISS');

    const response = new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });

    // 写入边缘缓存（异步，不阻塞响应）
    if (shouldCache && upstreamResponse.status === 200) {
      const ttl = getCacheTTL(hostLower, url.pathname);
      const cacheKey = new Request(targetUrl, { method: 'GET' });
      const cacheResponse = new Response(response.clone().body, response);
      cacheResponse.headers.set('Cache-Control', `public, max-age=${ttl}`);
      // waitUntil 不存在于类型定义中，但 CF Workers 运行时支持
      // 使用 ctx.waitUntil 需要 ExecutionContext，这里用 cache.put 直接调用即可
      caches.default.put(cacheKey, cacheResponse);
    }

    return response;
  },
};
