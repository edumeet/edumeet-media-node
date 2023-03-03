import { Producer } from 'mediasoup/node/lib/Producer';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { MiddlewareOptions } from '../../../../src/common/types';
import { createConsumerMiddleware } from '../../../../src/middlewares/consumerMiddleware';
import RoomServer from '../../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../../src/RoomServerConnection';
import RoomServerMock from '../../../../__mocks__/RoomServerMock';
import RouterMock from '../../../../__mocks__/RouterMock';
import TransportMock from '../../../../__mocks__/TransportMock';
import ProducerMock from '../../../../__mocks__/ProducerMock';
import ConsumerMock from '../../../../__mocks__/ConsumerMock';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import EventEmitter from 'events';
import { Next } from 'edumeet-common';
import RoomServerConnectionMock from '../../../../__mocks__/RoomServerConnectionMock';

describe('createPipeDataConsumer', () => {
	let context: RoomServerConnectionContext;
	let next: Next;
	let conn: RoomServerConnection;

	beforeEach(() => {
		conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
		context = {
			roomServerConnection: conn,
			response: {},
			message: {
				method: 'createPipeDataConsumer',
				data: {
					routerId: 'id',
					pipeTransportId: 'id',
					dataProducerId: 'id'
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
		const spyConsume = jest.spyOn(transport, 'consumeData');
		const spyObserverOnce = jest.spyOn(observer, 'once');

		await sut(context, next);

		expect(spyConsume).toHaveBeenCalled();
		expect(spyObserverOnce).toHaveBeenCalled();
		expect(context.handled).toBe(true);
		expect(context.response.id).toBe('id');
		expect(context.response.label).toBe('label');
		expect(context.response.protocol).toBe('protocol');
		expect(context.response.sctpStreamParameters).toBe('sctp');
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

		observer.emit('close');
		expect(spyNotify.mock.calls[0][0].method).toBe('pipeDataConsumerClosed');
	});

});
