import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const proxyOnly = process.argv.includes('--proxy-only')
const port = Number(process.env.PORT || (proxyOnly ? 8787 : 8087))
const host = process.env.HOST || '127.0.0.1'
const maxBodyBytes = 40 * 1024 * 1024
const maxLanBodyBytes = 300 * 1024 * 1024
const lanPort = 53318
const multicastAddress = '224.0.0.167'
const peerTtlMs = 16000

const lanState = {
  active: false,
  alias: 'CareJournal 网页',
  fingerprint: randomUUID(),
  publicKey: '',
  peers: new Map(),
  incoming: new Map(),
  results: new Map(),
  udp: null,
  server: null,
  announceTimer: null,
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
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

async function readJson(request, limit = maxBodyBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('请求内容过大'), { status: 413 })
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function lanAdvertisement(announce = false) {
  return Buffer.from(JSON.stringify({
    app: 'carejournal',
    version: 2,
    alias: lanState.alias,
    deviceType: 'web',
    fingerprint: lanState.fingerprint,
    publicKey: lanState.publicKey,
    port: lanPort,
    announce,
  }))
}

function currentPeers() {
  const cutoff = Date.now() - peerTtlMs
  for (const [fingerprint, peer] of lanState.peers) {
    if (peer.lastSeen < cutoff) lanState.peers.delete(fingerprint)
  }
  return [...lanState.peers.values()].sort((a, b) => b.lastSeen - a.lastSeen)
}

function announceLan(announce = false) {
  if (!lanState.udp) return
  const payload = lanAdvertisement(announce)
  lanState.udp.send(payload, 0, payload.length, lanPort, multicastAddress)
}

async function startLan(alias, publicKey) {
  lanState.alias = String(alias || 'CareJournal 网页').slice(0, 48)
  lanState.publicKey = String(publicKey || '')
  if (!lanState.publicKey) throw Object.assign(new Error('设备加密密钥无效'), { status: 400 })
  if (lanState.active) {
    announceLan(true)
    return
  }
  lanState.active = true

  lanState.server = createServer(handleLanRequest)
  await new Promise((resolvePromise, reject) => {
    lanState.server.once('error', reject)
    lanState.server.listen(lanPort, '0.0.0.0', resolvePromise)
  })

  lanState.udp = createSocket({ type: 'udp4', reuseAddr: true })
  lanState.udp.on('message', (message, remote) => {
    try {
      const advertisement = JSON.parse(message.toString('utf8'))
      if (advertisement.app !== 'carejournal' || advertisement.version !== 2 || !advertisement.publicKey || advertisement.fingerprint === lanState.fingerprint) return
      lanState.peers.set(advertisement.fingerprint, {
        fingerprint: advertisement.fingerprint,
        alias: String(advertisement.alias || 'CareJournal 设备'),
        deviceType: advertisement.deviceType === 'web' ? 'web' : 'mobile',
        publicKey: String(advertisement.publicKey),
        host: remote.address,
        port: Number(advertisement.port) || lanPort,
        lastSeen: Date.now(),
      })
      if (advertisement.announce) announceLan(false)
    } catch {
      // Ignore unrelated multicast traffic.
    }
  })
  await new Promise((resolvePromise, reject) => {
    lanState.udp.once('error', reject)
    lanState.udp.bind(lanPort, () => {
      lanState.udp.addMembership(multicastAddress)
      lanState.udp.setMulticastTTL(1)
      resolvePromise()
    })
  })
  announceLan(true)
  lanState.announceTimer = setInterval(() => announceLan(false), 5000)
}

async function stopLan() {
  lanState.active = false
  if (lanState.announceTimer) clearInterval(lanState.announceTimer)
  lanState.announceTimer = null
  if (lanState.udp) lanState.udp.close()
  lanState.udp = null
  if (lanState.server) await new Promise((resolvePromise) => lanState.server.close(resolvePromise))
  lanState.server = null
  lanState.peers.clear()
  lanState.incoming.clear()
  lanState.results.clear()
}

async function handleLanRequest(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    return response.end()
  }
  try {
    if (request.method === 'POST' && request.url === '/carejournal/v1/sync') {
      const envelope = await readJson(request, maxLanBodyBytes)
      const requestId = randomUUID()
      lanState.incoming.set(requestId, { requestId, envelope, peerAddress: request.socket.remoteAddress, delivered: false, createdAt: Date.now() })
      return sendJson(response, 202, { requestId })
    }
    const match = request.method === 'GET' && request.url?.match(/^\/carejournal\/v1\/result\/([a-f0-9-]+)$/i)
    if (match) {
      const result = lanState.results.get(match[1])
      if (!result) return sendJson(response, 202, { status: 'pending' })
      lanState.results.delete(match[1])
      lanState.incoming.delete(match[1])
      if (result.error) return sendJson(response, 409, { error: result.error })
      return sendJson(response, 200, { envelope: result.envelope })
    }
    return sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    return sendJson(response, Number(error?.status) || 400, { error: error instanceof Error ? error.message : '局域网请求失败' })
  }
}

async function sendLanEnvelope(peer, envelope) {
  const known = currentPeers().some((item) => item.host === peer.host && item.port === Number(peer.port))
  if (!known) throw Object.assign(new Error('目标设备不在当前发现列表中，请刷新后重试'), { status: 400 })
  const base = `http://${peer.host}:${Number(peer.port)}`
  const created = await fetch(`${base}/carejournal/v1/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: envelope,
    signal: AbortSignal.timeout(30000),
  })
  if (!created.ok) throw new Error(`对方设备拒绝了同步请求（${created.status}）`)
  const { requestId } = await created.json()
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 850))
    const result = await fetch(`${base}/carejournal/v1/result/${requestId}`, { signal: AbortSignal.timeout(10000) })
    const body = await result.json()
    if (result.status === 202) continue
    if (!result.ok) throw new Error(body.error || '对方设备未能完成同步')
    return body.envelope
  }
  throw new Error('等待对方完成同步超时')
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
  if (request.url?.startsWith('/api/lan/')) {
    try {
      if (request.method === 'POST' && request.url === '/api/lan/start') {
        const body = await readJson(request)
        await startLan(body.alias, body.publicKey)
        return sendJson(response, 200, {
          alias: lanState.alias,
          fingerprint: lanState.fingerprint,
          publicKey: lanState.publicKey,
          port: lanPort,
          transport: 'web',
        })
      }
      if (request.method === 'POST' && request.url === '/api/lan/stop') {
        await stopLan()
        return sendJson(response, 200, { ok: true })
      }
      if (request.method === 'POST' && request.url === '/api/lan/refresh') {
        if (!lanState.active) throw Object.assign(new Error('局域网同步尚未开启'), { status: 409 })
        announceLan(true)
        return sendJson(response, 200, { ok: true })
      }
      if (request.method === 'GET' && request.url === '/api/lan/peers') {
        return sendJson(response, 200, { peers: currentPeers() })
      }
      if (request.method === 'GET' && request.url === '/api/lan/incoming') {
        const requests = [...lanState.incoming.values()]
          .filter((item) => !item.delivered && Date.now() - item.createdAt < 120000)
          .map((item) => {
            item.delivered = true
            return { requestId: item.requestId, envelope: item.envelope, peerAddress: item.peerAddress }
          })
        return sendJson(response, 200, { requests })
      }
      if (request.method === 'POST' && request.url === '/api/lan/send') {
        const body = await readJson(request, maxLanBodyBytes)
        const envelope = await sendLanEnvelope(body, body.envelope)
        return sendJson(response, 200, { envelope })
      }
      if (request.method === 'POST' && request.url === '/api/lan/complete') {
        const body = await readJson(request, maxLanBodyBytes)
        if (!lanState.incoming.has(body.requestId)) throw Object.assign(new Error('同步请求已失效'), { status: 404 })
        lanState.results.set(body.requestId, { envelope: body.envelope })
        return sendJson(response, 200, { ok: true })
      }
      if (request.method === 'POST' && request.url === '/api/lan/reject') {
        const body = await readJson(request)
        if (!lanState.incoming.has(body.requestId)) throw Object.assign(new Error('同步请求已失效'), { status: 404 })
        lanState.results.set(body.requestId, { error: String(body.error || '接收方拒绝了同步') })
        return sendJson(response, 200, { ok: true })
      }
      return sendJson(response, 404, { error: 'Not found' })
    } catch (error) {
      return sendJson(response, Number(error?.status) || 500, { error: error instanceof Error ? error.message : '局域网服务失败' })
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(request, response)
  sendJson(response, 405, { error: { message: 'Method not allowed' } })
})

server.listen(port, host, () => {
  console.log(`CareJournal Web 服务已启动：http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void stopLan().finally(() => process.exit(0))
  })
}
