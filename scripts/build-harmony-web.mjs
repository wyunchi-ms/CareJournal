import { spawn } from 'node:child_process'

const child = spawn('npm run build', {
  env: {
    ...process.env,
    CAREJOURNAL_HARMONY_BUILD: '1',
  },
  shell: true,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
