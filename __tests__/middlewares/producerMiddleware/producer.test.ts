import EventEmitter from 'events';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import { Producer } from 'mediasoup/node/lib/Producer';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { MiddlewareOptions } from '../../../src/common/types';
import { createProducerMiddleware } from '../../../src/middlewares/producerMiddleware';
import RoomServer from '../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../src/RoomServerConnection';
import ConsumerMock from '../../../__mocks__/ConsumerMock';
import ProducerMock from '../../../__mocks__/ProducerMock';
import RoomServerConnectionMock from '../../../__mocks__/RoomServerConnectionMock';
import RoomServerMock from '../../../__mocks__/RoomServerMock';
import RouterMock from '../../../__mocks__/RouterMock';
import TransportMock from '../../../__mocks__/TransportMock';

const next = jest.fn();

test('createPipeProducer() should create producer', async () => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createProducerMiddleware(options);
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		message: {
			method: 'createPipeProducer',
			data: {
				routerId: 'id',
				pipeTransportId: 'id'
			}
		},
		response: {}
	} as unknown as RoomServerConnectionContext; 

	const observer = new EventEmitter();
	const producer = new ProducerMock(observer) as unknown as Producer;
	const transport = new TransportMock(undefined, producer) as unknown as Transport;
	const router = new RouterMock(undefined, transport) as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});

	await sut(context, next);

	expect(context.response.id).toBe(producer.id);
	expect(context.handled).toBeTruthy();

	const spyNotify = jest.spyOn(conn, 'notify');

	observer.emit('close');
	expect(spyNotify.mock.calls[0][0].method).toBe('pipeProducerClosed');
});

test('closePipeProducer() should close producer', async () => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createProducerMiddleware(options);
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		message: {
			method: 'closePipeProducer',
			data: {
				routerId: 'id',
				pipeProducerId: 'id'
			}
		},
		response: {}
	} as unknown as RoomServerConnectionContext; 

	const observer = new EventEmitter();
	const producer = new ProducerMock(observer) as unknown as Producer;
	const transport = new TransportMock(undefined, producer) as unknown as Transport;
	const router = new RouterMock(producer, transport) as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});

	const spyProducerClose = jest.spyOn(producer, 'close');

	await sut(context, next);

	expect(producer.appData.remoteClosed).toBeTruthy();
	expect(context.handled).toBeTruthy();
	expect(spyProducerClose).toHaveBeenCalled();
});
