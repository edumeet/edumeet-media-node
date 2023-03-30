import EventEmitter from 'events';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import { Producer } from 'mediasoup/node/lib/Producer';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { MiddlewareOptions } from '../../../../src/common/types';
import MediaService from '../../../../src/MediaService';
import { createRouterMiddleware } from '../../../../src/middlewares/routerMiddleware';
import RoomServer from '../../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../../src/RoomServerConnection';
import ConsumerMock from '../../../../__mocks__/ConsumerMock';
import MediaServiceMock from '../../../../__mocks__/MediaServiceMock';
import ProducerMock from '../../../../__mocks__/ProducerMock';
import RoomServerConnectionMock from '../../../../__mocks__/RoomServerConnectionMock';
import RoomServerMock from '../../../../__mocks__/RoomServerMock';
import RouterMock from '../../../../__mocks__/RouterMock';
import TransportMock from '../../../../__mocks__/TransportMock';

test('getRouter() should get router', async () => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const mediaService = new MediaServiceMock() as unknown as MediaService;
	const options = {
		roomServer: roomServer,
		mediaService: mediaService
	} as unknown as MiddlewareOptions;
	const sut = createRouterMiddleware(options);

	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: 'getRouter',
			data: {
				roomId: 'id'
			}
		}
	} as unknown as RoomServerConnectionContext;

	const observer1 = new EventEmitter();
	const observer2 = new EventEmitter();
	const consumer = new ConsumerMock(observer1) as unknown as Consumer;
	const producer = new ProducerMock() as unknown as Producer;
	const transport = new TransportMock(consumer) as unknown as Transport;
	const router = new RouterMock(
		producer, 
		transport, 
		undefined, 
		observer2
	) as unknown as Router;

	jest.spyOn(mediaService, 'getRouter').mockImplementation(async () => {
		return router;
	});

	const next = jest.fn();

	await sut(context, next);

	expect(context.response.id).toBe(router.id);
	expect(context.response.rtpCapabilities).toBe(router.rtpCapabilities);
	expect(context.handled).toBe(true);
});

test('getRouter() emit close event should delete router', async () => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const mediaService = new MediaServiceMock() as unknown as MediaService;
	const options = {
		roomServer: roomServer,
		mediaService: mediaService
	} as unknown as MiddlewareOptions;
	const sut = createRouterMiddleware(options);

	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: 'getRouter',
			data: {
				roomId: 'id'
			}
		}
	} as unknown as RoomServerConnectionContext;

	const observer1 = new EventEmitter();
	const observer2 = new EventEmitter();
	const consumer = new ConsumerMock(observer1) as unknown as Consumer;
	const producer = new ProducerMock() as unknown as Producer;
	const transport = new TransportMock(consumer) as unknown as Transport;
	const router = new RouterMock(
		producer, 
		transport, 
		undefined, 
		observer2
	) as unknown as Router;

	jest.spyOn(mediaService, 'getRouter').mockImplementation(async () => {
		return router;
	});

	const next = jest.fn();

	await sut(context, next);
	const spyDeleteRouter = jest.spyOn(roomServer.routers, 'delete');
	const spyNotify = jest.spyOn(conn, 'notify');

	observer2.emit('close');
	expect(spyDeleteRouter).toHaveBeenCalledWith(router.id);
	expect(spyNotify.mock.calls[0][0].method).toBe('routerClosed');
});

test('closeRouter() should be closed', async () => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer,
	} as unknown as MiddlewareOptions;
	const sut = createRouterMiddleware(options);

	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: 'closeRouter',
			data: {
				roomId: 'id'
			}
		}
	} as unknown as RoomServerConnectionContext;

	const observer1 = new EventEmitter();
	const observer2 = new EventEmitter();
	const consumer = new ConsumerMock(observer1) as unknown as Consumer;
	const producer = new ProducerMock() as unknown as Producer;
	const transport = new TransportMock(consumer) as unknown as Transport;
	const router = new RouterMock(
		producer, 
		transport, 
		undefined, 
		observer2
	) as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});
	const spyClose = jest.spyOn(router, 'close');

	const next = jest.fn();

	await sut(context, next);

	expect(router.appData.remoteClosed).toBe(true);
	expect(context.handled).toBe(true);
	expect(spyClose).toHaveBeenCalled();
});

test.each([ 'closeRouter', 'canConsume' ])('should throw on no router', async (methodToTest) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer,
	} as unknown as MiddlewareOptions;
	const sut = createRouterMiddleware(options);

	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: methodToTest,
			data: {
				routerId: 'id'
			}
		}
	} as unknown as RoomServerConnectionContext;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return undefined;
	});

	const next = jest.fn();

	expect(async () => sut(context, next)).rejects.toThrow();
});

test('canConsume()', async () => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer,
	} as unknown as MiddlewareOptions;
	const sut = createRouterMiddleware(options);

	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		response: {},
		message: {
			method: 'canConsume',
			data: {
				routerId: 'id',
				rtpCapabilities: 'rtp',
				producerId: 'id'
			}
		}
	} as unknown as RoomServerConnectionContext;

	const observer1 = new EventEmitter();
	const observer2 = new EventEmitter();
	const consumer = new ConsumerMock(observer1) as unknown as Consumer;
	const producer = new ProducerMock() as unknown as Producer;
	const transport = new TransportMock(consumer) as unknown as Transport;
	const router = new RouterMock(
		producer, 
		transport, 
		undefined, 
		observer2
	) as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});
	const spyCanConsume = jest.spyOn(router, 'canConsume').mockImplementation(() => {
		return true;
	});

	const next = jest.fn();

	await sut(context, next);

	expect(spyCanConsume).toHaveBeenCalled();
	expect(context.handled).toBe(true);
	expect(context.response.canConsume).toBe(true);
});
