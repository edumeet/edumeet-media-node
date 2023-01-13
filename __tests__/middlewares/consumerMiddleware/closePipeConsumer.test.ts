import { Router } from 'mediasoup/node/lib/Router';
import { MiddlewareOptions } from '../../../src/common/types';
import { createConsumerMiddleware } from '../../../src/middlewares/consumerMiddleware';
import RoomServer from '../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../src/RoomServerConnection';
import RoomServerMock from '../../../__mocks__/RoomServerMock';
import RouterMock from '../../../__mocks__/RouterMock';
import ConsumerMock from '../../../__mocks__/ConsumerMock';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import EventEmitter from 'events';
import { Next } from 'edumeet-common';
import RoomServerConnectionMock from '../../../__mocks__/RoomServerConnectionMock';

describe('closePipeConsumer', () => {
	let context: RoomServerConnectionContext;
	let next: Next;
	let conn: RoomServerConnection;

	beforeEach(() => {
		conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
		context = {
			roomServerConnection: conn,
			response: {},
			message: {
				method: 'closePipeConsumer',
				data: {
					routerId: 'id',
					pipeConsumerId: 'id',
				}
			}
		} as unknown as RoomServerConnectionContext;
		next = jest.fn();

	});

	test('Should close pipeconsumer', async () => {
		const observer = new EventEmitter();
		const consumer = new ConsumerMock(observer) as unknown as Consumer;
		const router = new RouterMock(undefined, undefined, consumer) as unknown as Router;
		const roomServer = new RoomServerMock() as unknown as RoomServer;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return router;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);
		const spyClose = jest.spyOn(consumer, 'close');

		await sut(context, next);

		expect(spyClose).toHaveBeenCalled();
		expect(context.handled).toBe(true);
		expect(consumer.appData.remoteClosed).toBe(true);
	});

	test('Should throw on missing router', async () => {
		const roomServer = new RoomServerMock() as unknown as RoomServer;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return undefined;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);

		expect(async () => sut(context, next)).rejects.toThrow();
	});

	test('Should throw on missing consumer', async () => {
		const router = new RouterMock() as unknown as Router;
		const roomServer = new RoomServerMock() as unknown as RoomServer;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return router;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);

		expect(async () => sut(context, next)).rejects.toThrow();
	});
});
