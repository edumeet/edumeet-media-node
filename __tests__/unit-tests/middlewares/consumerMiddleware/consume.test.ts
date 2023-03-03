import { Router } from 'mediasoup/node/lib/Router';
import { MiddlewareOptions } from '../../../../src/common/types';
import { createConsumerMiddleware } from '../../../../src/middlewares/consumerMiddleware';
import RoomServer from '../../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../../src/RoomServerConnection';
import RoomServerMock from '../../../../__mocks__/RoomServerMock';
import RouterMock from '../../../../__mocks__/RouterMock';
import ConsumerMock from '../../../../__mocks__/ConsumerMock';
import { Consumer, ConsumerScore } from 'mediasoup/node/lib/Consumer';
import EventEmitter from 'events';
import { Next } from 'edumeet-common';
import RoomServerConnectionMock from '../../../../__mocks__/RoomServerConnectionMock';
import TransportMock from '../../../../__mocks__/TransportMock';
import ProducerMock from '../../../../__mocks__/ProducerMock';
import { Producer } from 'mediasoup/node/lib/Producer';
import { Transport } from 'mediasoup/node/lib/Transport';

describe('consume', () => {
	let context: RoomServerConnectionContext;
	let next: Next;
	let conn: RoomServerConnection;

	beforeEach(() => {
		conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
		context = {
			roomServerConnection: conn,
			response: {},
			message: {
				method: 'consume',
				data: {
					routerId: 'id',
					producerId: 'id',
					transportId: 'id',
					rtpCapabilities: 'rtp'
				}
			}
		} as unknown as RoomServerConnectionContext;
		next = jest.fn();

	});

	test('Should consume client', async () => {
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

		expect(context.response.id).toBe(consumer.id);
		expect(context.response.kind).toBe(consumer.kind);
		expect(context.response.paused).toBe(false);
		expect(context.response.producerPaused).toBe(false);
		expect(context.response.rtpParameters).toBe(consumer.rtpParameters);
	});
	
	test('Should throw on no router', async () => {
		const roomServer = new RoomServerMock() as unknown as RoomServer;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return undefined;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);

		expect(async () => sut(context, next)).rejects.toThrow();
	});
	
	test('Should throw on no transport', async () => {
		const roomServer = new RoomServerMock() as unknown as RoomServer;
		const router = new RouterMock() as unknown as Router;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return router;
		});
		const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

		const sut = createConsumerMiddleware(options);

		expect(async () => sut(context, next)).rejects.toThrow();
	});
	
	test('Should throw on no producer', async () => {
		const roomServer = new RoomServerMock() as unknown as RoomServer;
		const transport = new TransportMock() as unknown as Transport;
		const router = new RouterMock(undefined, transport) as unknown as Router;

		jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
			return router;
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

		consumer.emit('producerpause');
		expect(spyNotify.mock.calls[0][0].method).toBe('consumerProducerPaused');
		consumer.emit('producerresume');
		expect(spyNotify.mock.calls[1][0].method).toBe('consumerProducerResumed');
		consumer.emit('layerschange');
		expect(spyNotify.mock.calls[2][0].method).toBe('consumerLayersChanged');
		consumer.emit('score', {} as unknown as ConsumerScore);
		expect(spyNotify.mock.calls[3][0].method).toBe('consumerScore');
		observer.emit('close');
		expect(spyNotify.mock.calls[4][0].method).toBe('consumerClosed');
	});
});