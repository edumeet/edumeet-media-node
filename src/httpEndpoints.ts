import { IncomingMessage, ServerResponse } from 'http';
import os from 'os';
import MediaService from './MediaService';

export const createHttpEndpoints = (mediaService: MediaService) => {
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

				return res.end(String(os.loadavg()[0] / os.cpus().length));
			}

			default: {
				res.writeHead(404, { 'Content-Type': 'text/plain' });

				return res.end('Not found');
			}
		}
	};
};