import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const proxyOnly = process.argv.includes('--proxy-only')
const port = Number(process.env.PORT || (proxyOnly ? 8787 : 8087))
const host = process.env.HOST || '127.0.0.1'
const maxBodyBytes = 40 * 1024 * 1024

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) throw Object.assign(new Error('请求图片总大小超过 40 MB'), { status: 413 })
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function validateAzureUrl(value) {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  const allowed = hostname.endsWith('.openai.azure.com') || hostname.endsWith('.cognitiveservices.azure.com') || hostname.endsWith('.services.ai.azure.com')
  if (url.protocol !== 'https:' || !allowed || (url.port && url.port !== '443')) throw Object.assign(new Error('只允许转发到 Azure OpenAI HTTPS Endpoint'), { status: 400 })
  if (!url.pathname.includes('/openai/')) throw Object.assign(new Error('Azure OpenAI 请求路径无效'), { status: 400 })
  return url.toString()
}

async function proxyAzure(request, response) {
  const apiKey = request.headers['x-azure-api-key']
  if (typeof apiKey !== 'string' || !apiKey.trim()) return sendJson(response, 400, { error: { message: '缺少 Azure API Key' } })
  try {
    const body = await readJson(request)
    const target = validateAzureUrl(body.url)
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify(body.payload),
      signal: AbortSignal.timeout(125000),
    })
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8'
    const data = Buffer.from(await upstream.arrayBuffer())
    response.writeHead(upstream.status, { 'Content-Type': contentType, 'Content-Length': data.length, 'Cache-Control': 'no-store' })
    response.end(data)
  } catch (error) {
    const status = Number(error?.status) || 502
    sendJson(response, status, { error: { message: error instanceof Error ? error.message : 'Azure 转发失败' } })
  }
}

async function serveStatic(request, response) {
  if (proxyOnly) return sendJson(response, 404, { error: { message: 'Not found' } })
  const requestedPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const relativePath = requestedPath === '/' ? 'index.html' : normalize(requestedPath).replace(/^[/\\]+/, '')
  let filePath = resolve(join(root, relativePath))
  if (!filePath.startsWith(root)) return sendJson(response, 403, { error: { message: 'Forbidden' } })
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not a file')
  } catch {
    filePath = join(root, 'index.html')
  }
  const data = await readFile(filePath)
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  response.end(data)
}

const server = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/azure-openai') return proxyAzure(request, response)
  if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(request, response)
  sendJson(response, 405, { error: { message: 'Method not allowed' } })
})

server.listen(port, host, () => {
  console.log(`CareJournal Web 服务已启动：http://${host}:${port}`)
})
