import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import Tesseract from 'tesseract.js'
import { realpathSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { homedir } from 'node:os'

// L2: restrict OCR to real image files inside an allowed base directory so this
// tool can't be coaxed into probing arbitrary paths. Base defaults to the user's
// home; the host app may pin it tighter via CT_OCR_BASE.
const OCR_BASE = realpathSync(process.env.CT_OCR_BASE || homedir())
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.gif', '.pnm'])

function resolveImagePath(imagePath) {
  if (typeof imagePath !== 'string' || imagePath.includes('\0')) {
    throw new Error('Invalid image path')
  }
  if (!IMAGE_EXTS.has(extname(imagePath).toLowerCase())) {
    throw new Error('Unsupported file type: OCR only accepts image files')
  }
  let real
  try {
    real = realpathSync(imagePath)
  } catch {
    throw new Error('Image file not found')
  }
  if (real !== OCR_BASE && !real.startsWith(OCR_BASE + '/')) {
    throw new Error('Image path is outside the allowed directory')
  }
  if (!statSync(real).isFile()) {
    throw new Error('Image path is not a regular file')
  }
  return real
}

const server = new Server(
  { name: 'ocr-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'ocr_image',
    description: 'Extract text from an image file using OCR',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: 'Absolute path to the image file'
        },
        language: {
          type: 'string',
          description: 'Language code for OCR (default: eng)',
          default: 'eng'
        }
      },
      required: ['imagePath']
    }
  }]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'ocr_image') {
    const { imagePath, language = 'eng' } = request.params.arguments
    const safePath = resolveImagePath(imagePath)
    const { data } = await Tesseract.recognize(safePath, language)
    return { content: [{ type: 'text', text: data.text }] }
  }
  throw new Error(`Unknown tool: ${request.params.name}`)
})

const transport = new StdioServerTransport()
await server.connect(transport)
