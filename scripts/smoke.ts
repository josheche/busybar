// Smoke test: proves USB connectivity, then draws hello-world for 10 seconds.
// Run with: npm run smoke
import { bar } from '../src/lib/bar.js'
import { AMBIENT } from '../src/lib/priorities.js'

const status = await bar.SystemStatusGet()
console.info('device status:', JSON.stringify(status, null, 2))

await bar.DisplayDraw({
  application_name: 'smoke_test',
  priority: AMBIENT,
  elements: [
    {
      id: 'hello',
      type: 'text',
      display: 'front',
      align: 'center',
      x: 36,
      y: 8,
      font: 'normal',
      color: '#00FF88FF',
      text: 'HELLO JOSH',
      timeout: 10
    }
  ]
})
console.info('drew "HELLO JOSH" on the front screen (clears in 10s)')
