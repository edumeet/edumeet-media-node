import { Router } from 'mediasoup/node/lib/Router';
import { MiddlewareOptions } from '../../../../src/common/types';
import { createConsumerMiddleware } from '../../../../src/middlewares/consumerMiddleware';
import RoomServer from '../../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../../src/RoomServerConnection';
import RoomServerMock from '../../../../__mocks__/RoomServerMock';
import RouterMock from '../../../../__mocks__/RouterMock';
import ConsumerMock from '../../../../__mocks__/ConsumerMock';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import EventEmitter from 'events';
import RoomServerConnectionMock from '../../../../__mocks__/RoomServerConnectionMock';

test.each([
	[ 'closeConsumer', 'close' ],
	[ 'pauseConsumer', 'pause' ],
	[ 'resumeConsumer', 'resume' ],
	[ 'setConsumerPreferredLayers', 'setPreferredLayers' ],
	[ 'requestConsumerKeyFrame', 'requestKeyFrame' ],
	[ 'closePipeDataConsumer', 'close', ],
	[ 'setConsumerPriority', 'setPriority' ],
	[ 'closeDataConsumer', 'close' ],
	[ 'closePipeConsumer', 'close' ]
]

)('Should close consumer', async (methodToTest: string, methodToSpy: string) => {
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;

	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: methodToTest,
			data: {
				pipeConsumerId: 'id',
				dataConsumerId: 'id',
				pipeDataConsumerId: 'id',
				routerId: 'id',
				consumerId: 'id',
				priority: 1
			}
		}
	} as unknown as RoomServerConnectionContext;

	const next = jest.fn();
	const observer = new EventEmitter();
	const consumer = new ConsumerMock(observer) as unknown as Consumer;

	const spyMethod = methodToSpy as unknown as 'close' | 'pause' | 'setPreferredLayers' | 'resume';
	const spy = jest.spyOn(consumer, spyMethod);
	const router = new RouterMock(undefined, undefined, consumer) as unknown as Router;

	const roomServer = new RoomServerMock() as unknown as RoomServer;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});
	const options = { roomServer: roomServer } as unknown as MiddlewareOptions;

	const sut = createConsumerMiddleware(options);

	await sut(context, next);

	expect(spy).toHaveBeenCalled();
	expect(context.handled).toBe(true);
});

test.each([
	'closeConsumer',
	'pauseConsumer',
	'resumeConsumer',
	'setConsumerPreferredLayers',
	'requestConsumerKeyFrame',
	'closePipeDataConsumer',
	'setConsumerPriority',
	'closeDataConsumer',
	'closePipeConsumer'
])('Should throw on missing router', async (methodToTest: string) => {
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: methodToTest,
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

test.each([
	'closeConsumer',
	'pauseConsumer',
	'resumeConsumer',
	'setConsumerPreferredLayers',
	'requestConsumerKeyFrame',
	'closePipeDataConsumer',
	'setConsumerPriority',
	'closeDataConsumer',
	'closePipeConsumer'
])('Should throw on missing router', async (methodToTest: string) => {
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: methodToTest,
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