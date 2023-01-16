import { Router } from 'mediasoup/node/lib/Router';
import { MiddlewareOptions } from '../../../src/common/types';
import { createConsumerMiddleware } from '../../../src/middlewares/consumerMiddleware';
import RoomServer from '../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../src/RoomServerConnection';
import RoomServerMock from '../../../__mocks__/RoomServerMock';
import RouterMock from '../../../__mocks__/RouterMock';
import ConsumerMock from '../../../__mocks__/ConsumerMock';
import { Consumer, ConsumerScore } from 'mediasoup/node/lib/Consumer';
import EventEmitter from 'events';
import { Next } from 'edumeet-common';
import RoomServerConnectionMock from '../../../__mocks__/RoomServerConnectionMock';
import TransportMock from '../../../__mocks__/TransportMock';
import ProducerMock from '../../../__mocks__/ProducerMock';
import { Producer } from 'mediasoup/node/lib/Producer';
import { Transport } from 'mediasoup/node/lib/Transport';

test('Should close consumer', async () => {
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: 'closeConsumer',
			data: {
				routerId: 'id',
				consumerId: 'id',
			}
		}
	} as unknown as RoomServerConnectionContext;

	const next = jest.fn();
	const observer = new EventEmitter();
	const consumer = new ConsumerMock(observer) as unknown as Consumer;
	const spyCloseConsumer = jest.spyOn(consumer, 'close');
	const router = new RouterMock(undefined, undefined, consumer) as unknown as Router;

	const roomServer = new RoomServerMock() as unknown as RoomServer;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});
	const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

	const sut = createConsumerMiddleware(options);

	await sut(context, next);

	expect(spyCloseConsumer).toHaveBeenCalled();
	expect(consumer.appData.remoteClosed).toBe(true);
	expect(context.handled).toBe(true);
});

test('Should throw on missing router', async () => {
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: 'closeConsumer',
			data: {
				routerId: 'id',
				consumerId: 'id',
			}
		}
	} as unknown as RoomServerConnectionContext;

	const next = jest.fn();

	const roomServer = new RoomServerMock() as unknown as RoomServer;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return undefined;
	});
	const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

	const sut = createConsumerMiddleware(options);

	expect(async () => sut(context, next)).rejects.toThrow();
});

test('Should throw on missing consumer', async () => {
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: 'closeConsumer',
			data: {
				routerId: 'id',
				consumerId: 'id',
			}
		}
	} as unknown as RoomServerConnectionContext;

	const next = jest.fn();
	const router = new RouterMock() as unknown as Router;

	const roomServer = new RoomServerMock() as unknown as RoomServer;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});
	const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

	const sut = createConsumerMiddleware(options);

	expect(async () => sut(context, next)).rejects.toThrow();
});