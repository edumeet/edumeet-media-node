import { IncomingMessage, ServerResponse } from 'http';
import MediaService from './MediaService';
import LoadManager from './LoadManager';

export const createHttpEndpoints = (mediaService: MediaService, loadManager: LoadManager) => {
	return (
		req: IncomingMessage,
		res: ServerResponse<IncomingMessage> & { req: IncomingMessage; }
	) => {
		const { method, url } = req;

		if (method !== 'GET') {
			res.writeHead(405, { Allow: 'GET' });

			return res.end();
		}

		switch (url) {
			case '/health': {
				res.writeHead(200, { 'Content-Type': 'text/plain' });

				return res.end('OK');
			}

			case '/metrics': {
				res.writeHead(200, { 'Content-Type': 'application/json' });

				return res.end(JSON.stringify(mediaService.getMetrics()));
			}

			case '/load': {
				res.writeHead(200, { 'Content-Type': 'text/plain' });

				return res.end(loadManager.getLoadJson());
			}

			default: {
				res.writeHead(404, { 'Content-Type': 'text/plain' });

				return res.end('Not found');
			}
		}
	};
};
