import { Producer } from 'mediasoup/node/lib/Producer';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { MiddlewareOptions } from '../../../src/common/types';
import { createConsumerMiddleware } from '../../../src/middlewares/consumerMiddleware';
import RoomServer from '../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../src/RoomServerConnection';
import RoomServerMock from '../../../__mocks__/RoomServerMock';
import RouterMock from '../../../__mocks__/RouterMock';
import TransportMock from '../../../__mocks__/TransportMock';
import ProducerMock from '../../../__mocks__/ProducerMock';
import ConsumerMock from '../../../__mocks__/ConsumerMock';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import EventEmitter from 'events';
import { Next } from 'edumeet-common';
import RoomServerConnectionMock from '../../../__mocks__/RoomServerConnectionMock';

test('Factory method should not throw', () => {
	const options = {} as unknown as MiddlewareOptions;

	expect(() => createConsumerMiddleware(options)).not.toThrow();

});

describe('createPipeConsumer', () => {
	let context: RoomServerConnectionContext;
	let next: Next;
	let conn: RoomServerConnection;

	beforeEach(() => {
		conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
		context = {
			roomServerConnection: conn,
			response: {},
			message: {
				method: 'createPipeConsumer',
				data: {
					routerId: 'id',
					pipeTransportId: 'id',
					producerId: 'id'
				}
			}
		} as unknown as RoomServerConnectionContext;
		next = jest.fn();

	});

	test('createPipeConsumer', async () => {
		const observer = new EventEmitter();
		const consumer = new ConsumerMock(observer) as unknown as Consumer;
		const producer = new ProducerMock() as unknown as Producer;
		const transport = new TransportMock(consumer) as unknown as Transport;
		const router = new RouterMock(producer, transport) as unknown as Router;
		const roomServer = new RoomServerMock() as unknown as RoomServer;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return router;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);
		const spyConsume = jest.spyOn(transport, 'consume');
		const spyObserverOnce = jest.spyOn(observer, 'once');

		await sut(context, next);

		expect(spyConsume).toHaveBeenCalled();
		expect(spyObserverOnce).toHaveBeenCalled();
		expect(context.handled).toBe(true);
		expect(context.response.id).toBe('id');
		expect(context.response.kind).toBe('video');
		expect(context.response.producerPaused).toBe(false);
		expect(context.response.rtpParameters).toBe('rtp');
	});
	test('Should throw on missing producer', async () => {
		const observer = new EventEmitter();
		const consumer = new ConsumerMock(observer) as unknown as Consumer;
		const transport = new TransportMock(consumer) as unknown as Transport;
		const router = new RouterMock(undefined, transport) as unknown as Router;
		const roomServer = new RoomServerMock() as unknown as RoomServer;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return router;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);

		expect(async () => sut(context, next)).rejects.toThrow();
	});

	test('Should throw on missing transport', async () => {
		const router = new RouterMock() as unknown as Router;
		const roomServer = new RoomServerMock() as unknown as RoomServer;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return router;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);

		expect(async () => sut(context, next)).rejects.toThrow();
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
	test('emit events', async () => {
		const observer = new EventEmitter();
		const consumer = new ConsumerMock(observer) as unknown as Consumer;
		const producer = new ProducerMock() as unknown as Producer;
		const transport = new TransportMock(consumer) as unknown as Transport;
		const router = new RouterMock(producer, transport) as unknown as Router;
		const roomServer = new RoomServerMock() as unknown as RoomServer;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return router;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);

		await sut(context, next);

		const spyNotify = jest.spyOn(conn, 'notify');

		observer.emit('pause');
		expect(spyNotify.mock.calls[0][0].method).toBe('pipeConsumerPaused');
		observer.emit('resume');
		expect(spyNotify.mock.calls[1][0].method).toBe('pipeConsumerResumed');
		observer.emit('close');
		expect(spyNotify.mock.calls[2][0].method).toBe('pipeConsumerClosed');
	});

});
