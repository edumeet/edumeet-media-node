import EventEmitter from 'events';
import { Logger } from './common/logger';
import MediaService from './MediaService';
import { Router } from 'mediasoup/node/lib/Router';
import { skipIfClosed } from './common/decorators';
import {
	RoomServerConnection,
	RoomServerConnectionContext
} from './RoomServerConnection';
import { Middleware } from './common/middleware';
import { createRouterMiddleware } from './middlewares/routerMiddleware';
import { MiddlewareOptions } from './common/types';
import { createTransportMiddleware } from './middlewares/transportMiddleware';
import { createProducerMiddleware } from './middlewares/producerMiddleware';
import { createConsumerMiddleware } from './middlewares/consumerMiddleware';

const logger = new Logger('RoomServer');

interface RoomServerOptions {
	mediaService: MediaService;
	roomServerConnection: RoomServerConnection;
}

export default class RoomServer extends EventEmitter {
	public closed = false;
	public mediaService: MediaService;
	public routers = new Map<string, Router>();
	public roomServerConnection: RoomServerConnection;

	private routerMiddleware: Middleware<RoomServerConnectionContext>;
	private transportMiddleware: Middleware<RoomServerConnectionContext>;
	private producerMiddleware: Middleware<RoomServerConnectionContext>;
	private consumerMiddleware: Middleware<RoomServerConnectionContext>;

	constructor({
		mediaService,
		roomServerConnection
	}: RoomServerOptions) {
		logger.debug('constructor()');

		super();

		this.mediaService = mediaService;
		this.roomServerConnection = roomServerConnection;

		const middlewareOptions = {
			roomServer: this,
			mediaService,
		} as MiddlewareOptions;

		this.routerMiddleware = createRouterMiddleware(middlewareOptions);
		this.transportMiddleware = createTransportMiddleware(middlewareOptions);
		this.producerMiddleware = createProducerMiddleware(middlewareOptions);
		this.consumerMiddleware = createConsumerMiddleware(middlewareOptions);

		this.handleConnection();
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.roomServerConnection.close();
		this.routers.forEach((router) => router.close());
		this.routers.clear();

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection(): void {
		logger.debug('handleConnection()');

		this.roomServerConnection.once('close', () => this.close());

		this.roomServerConnection.pipeline.use(
			this.routerMiddleware,
			this.transportMiddleware,
			this.producerMiddleware,
			this.consumerMiddleware
		);

		this.roomServerConnection.notify({
			method: 'mediaNodeReady',
			data: {
				workers: this.mediaService.workers.items.length
			}
		});
	}
}