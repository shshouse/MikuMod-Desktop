/**
 * MikuMod Proxy Worker
 * 
 * 为被 GFW SNI 过滤且 CDN 强制要求 SNI 的域名（GitHub、Twitch 等）
 * 提供 Cloudflare 边缘中转服务。
 * 
 * 协议：
 * 客户端发送请求到 Worker，通过请求头携带真实目标信息：
 *   X-Proxy-Host:   目标域名（如 github.com）
 *   X-Proxy-Secret: 鉴权密钥（防止被滥用）
 * Worker 将请求转发到目标并原样返回响应。
 */

interface Env {
  PROXY_SECRET: string;
}

// 允许中转的域名白名单
const ALLOWED_HOSTS = new Set([
  // GitHub
  'github.com',
  'github.dev',
  'api.github.com',
  'github.githubassets.com',
  'education.github.com',
  'resources.github.com',
  'uploads.github.com',
  'archiveprogram.github.com',
  'raw.githubusercontent.com',
  'avatars.githubusercontent.com',
  'objects.githubusercontent.com',
  'desktop.githubusercontent.com',
  'media.githubusercontent.com',
  'camo.githubusercontent.com',
  'github.io',
  'gist.github.com',
  'copilot.github.com',
  'alive.github.com',
  // Twitch
  'twitch.tv',
  'www.twitch.tv',
  'api.twitch.tv',
  'ttvnw.net',
  // Google (reCAPTCHA / Fonts)
  'www.recaptcha.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

// 不应该转发给上游的请求头
const HOP_HEADERS = new Set([
  'host',
  'x-proxy-host',
  'x-proxy-secret',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
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

    // 1. 鉴权
    const secret = request.headers.get('X-Proxy-Secret');
    if (!secret || secret !== env.PROXY_SECRET) {
      return new Response('Unauthorized', { status: 403 });
    }

    // 2. 获取目标域名
    const targetHost = request.headers.get('X-Proxy-Host');
    if (!targetHost) {
      return new Response('Missing X-Proxy-Host', { status: 400 });
    }

    // 3. 白名单校验
    const hostLower = targetHost.toLowerCase();
    const isAllowed = ALLOWED_HOSTS.has(hostLower) ||
      [...ALLOWED_HOSTS].some(h => hostLower.endsWith('.' + h));
    if (!isAllowed) {
      return new Response(`Host not allowed: ${targetHost}`, { status: 403 });
    }

    // 4. 构建上游请求 URL
    const url = new URL(request.url);
    const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

    // 5. 清理请求头（移除 hop-by-hop 和自定义代理头）
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (!HOP_HEADERS.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
    headers.set('Host', targetHost);

    // 6. 转发请求
    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual', // 不自动跟随重定向，让客户端处理
    });

    // 7. 构建响应（清理 hop-by-hop 头）
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
