import { Producer } from 'mediasoup/node/lib/Producer';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { MiddlewareOptions } from '../../../../src/common/types';
import { createTransportMiddleware } from '../../../../src/middlewares/transportMiddleware';
import RoomServer from '../../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../../src/RoomServerConnection';
import ProducerMock from '../../../../__mocks__/ProducerMock';
import RoomServerConnectionMock from '../../../../__mocks__/RoomServerConnectionMock';
import RoomServerMock from '../../../../__mocks__/RoomServerMock';
import RouterMock from '../../../../__mocks__/RouterMock';
import TransportMock from '../../../../__mocks__/TransportMock';

const next = jest.fn();

test.each([
	'createPipeTransport',
	'connectPipeTransport',
	'closePipeTransport',
	'createWebRtcTransport',
	'connectWebRtcTransport',
	'closeWebRtcTransport',
	'restartIce',
	'setMaxIncomingBitrate'
])('Should throw on missing router', async (methodToTest) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createTransportMiddleware(options);
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
	'connectPipeTransport',
	'closePipeTransport',
	'connectWebRtcTransport',
	'closeWebRtcTransport',
	'restartIce',
	'setMaxIncomingBitrate'

])('Should throw on missing transport', async (methodToTest) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createTransportMiddleware(options);
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
	[ 'connectPipeTransport', 'connect' ],
	[ 'closePipeTransport', 'close' ],
	[ 'connectWebRtcTransport', 'connect' ],
	[ 'closeWebRtcTransport', 'close' ],
	[ 'setMaxIncomingBitrate', 'setMaxIncomingBitrate' ],
	[ 'restartIce', 'restartIce' ],
])('Connect, close, restartIce, and setIncomingBitrate should work', async (methodToTest: string, methodCall: string) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const options = {
		roomServer: roomServer
	} as unknown as MiddlewareOptions;

	const sut = createTransportMiddleware(options);
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		message: {
			method: methodToTest,
			data: {
				routerId: 'id',
				transportId: 'id',
				pipeTransportId: 'id'
			}
		},
		response: {}
	} as unknown as RoomServerConnectionContext; 

	const transport = new TransportMock();
	const router = new RouterMock(
		undefined,
		transport as unknown as Transport
	) as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});

	const methodToSpy = methodCall as unknown as 'connect' | 'close' | 'setMaxIncomingBitrate' | 'restartIce';
	const spyTransport = jest.spyOn(transport, methodToSpy);

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(spyTransport).toHaveBeenCalled();
});