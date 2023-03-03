import EventEmitter from 'events';
import { Producer } from 'mediasoup/node/lib/Producer';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { MiddlewareOptions } from '../../../../src/common/types';
import { createProducerMiddleware } from '../../../../src/middlewares/producerMiddleware';
import RoomServer from '../../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../../src/RoomServerConnection';
import ProducerMock from '../../../../__mocks__/ProducerMock';
import RoomServerConnectionMock from '../../../../__mocks__/RoomServerConnectionMock';
import RoomServerMock from '../../../../__mocks__/RoomServerMock';
import RouterMock from '../../../../__mocks__/RouterMock';
import TransportMock from '../../../../__mocks__/TransportMock';

const next = jest.fn();

test.each([
	'createPipeProducer',
	'closePipeProducer',
	'pausePipeProducer',
	'resumePipeProducer',
	'produce',
	'closeProducer',
	'pauseProducer',
	'resumeProducer',
	'createPipeDataProducer',
	'closePipeDataProducer',
	'produceData',
	'closeDataProducer'
])('Should throw on missing router', async (methodToTest) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createProducerMiddleware(options);
	const context = {
		message: {
			method: methodToTest,
			data: {
				routerId: 'id',
				pipeTransportId: 'id'
			}
		},
		response: {}
	} as unknown as RoomServerConnectionContext; 

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return undefined;
	});

	expect(async () => sut(context, next)).rejects.toThrow();
});

test.each([
	'createPipeProducer',
	'closePipeProducer',
	'pausePipeProducer',
	'resumePipeProducer',
	'closeProducer',
	'pauseProducer',
	'resumeProducer',
	'closePipeDataProducer',
	'closeDataProducer'
])('Should throw on missing producer', async (methodToTest) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createProducerMiddleware(options);
	const context = {
		message: {
			method: methodToTest,
			data: {
				routerId: 'id',
				pipeTransportId: 'id'
			}
		},
		response: {}
	} as unknown as RoomServerConnectionContext; 

	const router = new RouterMock() as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});

	expect(async () => sut(context, next)).rejects.toThrow();
});

test.each([
	'createPipeProducer',
	'produce',
	'createPipeDataProducer',
	'produceData'
])('Should throw on missing transport', async (methodToTest) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createProducerMiddleware(options);
	const context = {
		message: {
			method: methodToTest,
			data: {
				routerId: 'id',
				pipeTransportId: 'id'
			}
		},
		response: {}
	} as unknown as RoomServerConnectionContext; 

	const producer = new ProducerMock() as unknown as Producer;
	const router = new RouterMock(producer, undefined) as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});

	expect(async () => sut(context, next)).rejects.toThrow();
});

test.each([
	[ 'pausePipeProducer', 'pause' ],
	[ 'resumePipeProducer', 'resume' ],
	[ 'closeProducer', 'close' ],
	[ 'pauseProducer', 'pause' ],
	[ 'resumeProducer', 'resume' ],
	[ 'closeDataProducer', 'close' ],
	[ 'closePipeDataProducer', 'close' ]
])('Pause, resume and close producer should work', async (methodToTest: string, methodCall: string) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createProducerMiddleware(options);
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		message: {
			method: methodToTest,
			data: {
				routerId: 'id',
				producerId: 'id',
				pipeProducerId: 'id',
				dataProducerId: 'id',
				pipeDataProducerId: 'id'
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

	const methodToSpy = methodCall as unknown as 'pause' | 'resume' | 'close';
	const spyProducer = jest.spyOn(producer, methodToSpy);

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(spyProducer).toHaveBeenCalled();
});