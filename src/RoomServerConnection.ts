/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import EventEmitter from 'events';
import {
	BaseConnection,
	InboundNotification,
	InboundRequest,
	Logger,
	Pipeline,
	skipIfClosed,
	SocketMessage
} from 'edumeet-common';
import LoadManager from './LoadManager';

const logger = new Logger('RoomServerConnection');

export interface RoomServerConnectionOptions {
	connection: BaseConnection;
	loadManager: LoadManager;
}

export interface RoomServerConnectionContext {
	roomServerConnection: RoomServerConnection;
	message: SocketMessage;
	response: Record<string, unknown>;
	handled: boolean;
}

/* eslint-disable no-unused-vars */
export declare interface RoomServerConnection {
	on(event: 'close', listener: () => void): this;
	on(event: 'notification', listener: InboundNotification): this;
	on(event: 'request', listener: InboundRequest): this;
}
/* eslint-enable no-unused-vars */

export class RoomServerConnection extends EventEmitter {
	public closed = false;
	public connection: BaseConnection;
	private loadManager: LoadManager;
	public pipeline = Pipeline<RoomServerConnectionContext>();

	constructor({
		connection,
		loadManager
	}: RoomServerConnectionOptions) {
		logger.debug('constructor()');

		super();

		this.connection = connection;
		this.loadManager = loadManager;
		this.handleConnection();
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close()');

		this.closed = true;

		this.connection.close();

		this.emit('close');
	}

	@skipIfClosed
	public drain(timeout: number): void {
		logger.debug('drain()');

		this.notify({ method: 'mediaNodeDrain', data: { timeout } });
	}

	@skipIfClosed
	public handleConnection(): void {
		logger.debug('addConnection()');

		this.connection.on('notification', async (notification) => {
			try {
				const context = {
					roomServerConnection: this,
					message: notification,
					response: {},
					handled: false,
				} as RoomServerConnectionContext;

				await this.pipeline.execute(context);

				if (!context.handled)
					throw new Error(`no middleware handled the notification [method: ${notification.method}]`);
			} catch (error) {
				logger.error({ err: error }, 'notification() [error: %o]');
			}
		});

		this.connection.on('request', async (request, respond, reject) => {
			try {
				const context = {
					roomServerConnection: this,
					message: request,
					response: {},
					handled: false,
				} as RoomServerConnectionContext;

				await this.pipeline.execute(context);

				if (context.handled) {
					context.response.load = this.loadManager.load;
					respond(context.response);
				} else {
					logger.debug('request() unhandled request [method: %s]', request.method);

					reject('Server error');
				}
			} catch (error) {
				logger.error({ err: error }, 'request() [error: %o]');

				reject('Server error');
			}
		});

		this.connection.once('close', () => this.close());
	}

	@skipIfClosed
	public notify(notification: SocketMessage): void {
		logger.debug('notify() [method: %s]', notification.method);

		if (!notification.data) notification.data = {};

		notification.data.load = this.loadManager.load;

		try {
			this.connection.notify(notification);
		} catch (error) {
			logger.error({ err: error }, 'notify() [error: %o]');
		}
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('request() [method: %s]', request.method);

		if (!request.data) request.data = {};

		request.data.load = this.loadManager.load;
	
		try {
			return await this.connection.request(request);
		} catch (error) {
			logger.error({ err: error }, 'request() [error: %o]');
		}
	}
}
