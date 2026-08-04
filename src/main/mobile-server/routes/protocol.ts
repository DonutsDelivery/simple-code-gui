import type { Express, Request, Response } from 'express'
import type { ServerProtocolDescriptor } from '../../../common/server-protocol'

export function setupProtocolRoutes(app: Express, getDescriptor: () => ServerProtocolDescriptor): void {
  app.get('/api/protocol', (_req: Request, res: Response) => {
    res.json(getDescriptor())
  })
}
