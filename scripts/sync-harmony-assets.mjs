import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const source = resolve(projectRoot, 'dist')
const target = resolve(projectRoot, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www')
const sourceIndex = resolve(source, 'index.html')
const targetIndex = resolve(target, 'index.html')

await access(sourceIndex)

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })
await access(targetIndex)

let html = await readFile(targetIndex, 'utf8')
html = await inlineStyles(html)
html = await inlineModuleScripts(html)
await writeFile(targetIndex, html)
console.log(`HarmonyOS web assets synced to ${target}`)

async function inlineStyles(html) {
  return replaceAsync(
    html,
    /<link rel="stylesheet" crossorigin href="\.\/(assets\/[^">]+\.css)">/g,
    async (_match, href) => `<style>${await readFile(resolve(target, href), 'utf8')}</style>`,
  )
}

async function inlineModuleScripts(html) {
  return replaceAsync(
    html,
    /<script type="module" crossorigin src="\.\/(assets\/[^">]+\.js)"><\/script>/g,
    async (_match, src) => `<script type="module">${await readFile(resolve(target, src), 'utf8')}</script>`,
  )
}

async function replaceAsync(value, regex, replacer) {
  const replacements = await Promise.all([...value.matchAll(regex)].map((match) => replacer(...match)))
  let index = 0
  return value.replace(regex, () => replacements[index++])
}
