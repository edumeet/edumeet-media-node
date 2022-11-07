import EventEmitter from 'events';
import { Logger } from './common/logger';
import { BaseConnection, InboundRequest } from './signaling/BaseConnection';
import { SocketMessage } from './signaling/SignalingInterface';
import { Pipeline } from './common/middleware';
import { skipIfClosed } from './common/decorators';
import { List } from './common/list';

const logger = new Logger('RoomServerConnection');

interface RoomServerConnectionOptions {
	roomId: string;
	connection: BaseConnection;
}

export interface RoomServerConnectionContext {
	roomServerConnection: RoomServerConnection;
	connectionId: string;
	message: SocketMessage;
	response: Record<string, unknown>;
	handled: boolean;
}

/* eslint-disable no-unused-vars */
export declare interface RoomServerConnection {
	on(event: 'close', listener: () => void): this;
	on(event: 'notification', listener: (notification: SocketMessage) => void): this;
	on(event: 'request', listener: InboundRequest): this;
}
/* eslint-enable no-unused-vars */

export class RoomServerConnection extends EventEmitter {
	public closed = false;
	public roomId: string;
	public ready = false;
	public connections = List<BaseConnection>();
	public pipeline = Pipeline<RoomServerConnectionContext>();

	constructor({
		roomId,
		connection,
	}: RoomServerConnectionOptions) {
		logger.debug('constructor()');

		super();

		this.roomId = roomId;
		this.addConnection(connection);
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close()');

		this.closed = true;

		this.connections.items.forEach((c) => c.close());
		this.connections.clear();

		this.emit('close');
	}

	@skipIfClosed
	public addConnection(connection: BaseConnection): void {
		logger.debug('addConnection() [roomId: %s]', this.roomId);

		this.connections.add(connection);

		connection.on('notification', async (notification) => {
			try {
				const context = {
					roomServerConnection: this,
					connectionId: connection.id,
					message: notification,
					response: {},
					handled: false,
				} as RoomServerConnectionContext;

				await this.pipeline.execute(context);

				if (!context.handled)
					throw new Error('no middleware handled the notification');
			} catch (error) {
				logger.error('notification() [roomId: %s, error: %o]', this.roomId, error);
			}
		});

		connection.on('request', async (request, respond, reject) => {
			try {
				const context = {
					roomServerConnection: this,
					connectionId: connection.id,
					message: request,
					response: {},
					handled: false,
				} as RoomServerConnectionContext;

				await this.pipeline.execute(context);

				if (context.handled)
					respond(context.response);
				else {
					logger.debug('request() unhandled request [method: %s]', request.method);

					reject('Server error');
				}
			} catch (error) {
				logger.error('request() [roomId: %s, error: %o]', this.roomId, error);

				reject('Server error');
			}
		});

		connection.once('close', () => {
			this.connections.remove(connection);

			if (this.connections.length === 0)
				this.close();
		});

		if (this.ready)
			connection.notify({ method: 'mediaNodeReady', data: {} });
	}

	@skipIfClosed
	public notify(
		notification: SocketMessage,
		excludeConnectionId?: string
	): void {
		logger.debug('notify() [roomId: %s, method: %s]', this.roomId, notification.method);

		this.connections.items.forEach((c) => {
			if (c.id === excludeConnectionId) return;

			try {
				c.notify(notification);
			} catch (error) {
				logger.error('notify() [roomId: %s, error: %o]', this.roomId, error);
			}
		});
	}
}