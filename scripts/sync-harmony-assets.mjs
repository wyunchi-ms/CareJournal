import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const source = resolve(projectRoot, 'dist')
const target = resolve(projectRoot, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www')

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })
console.log(`HarmonyOS web assets synced to ${target}`)
