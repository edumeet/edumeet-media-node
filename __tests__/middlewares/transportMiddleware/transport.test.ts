import EventEmitter from 'events';
import { PipeTransport } from 'mediasoup/node/lib/PipeTransport';
import { Router } from 'mediasoup/node/lib/Router';
import { WebRtcTransport } from 'mediasoup/node/lib/WebRtcTransport';
import { MiddlewareOptions } from '../../../src/common/types';
import MediaService from '../../../src/MediaService';
import { createTransportMiddleware } from '../../../src/middlewares/transportMiddleware';
import RoomServer from '../../../src/RoomServer';
import { RoomServerConnection, RoomServerConnectionContext } from '../../../src/RoomServerConnection';
import MediaServiceMock from '../../../__mocks__/MediaServiceMock';
import RoomServerConnectionMock from '../../../__mocks__/RoomServerConnectionMock';
import RoomServerMock from '../../../__mocks__/RoomServerMock';
import RouterMock from '../../../__mocks__/RouterMock';
import TransportMock from '../../../__mocks__/TransportMock';

const next = jest.fn();

test.each([ true, false ])('createPipeTransport - internal and external', async (isInternal: boolean) => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const mediaService = new MediaServiceMock() as unknown as MediaService;
	const options = {
		roomServer: roomServer,
		mediaService: mediaService
	} as unknown as MiddlewareOptions;

	const sut = createTransportMiddleware(options);
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		message: {
			method: 'createPipeTransport',
			data: {
				routerId: 'id',
				pipeTransportId: 'id',
				internal: isInternal
			}
		},
		response: {}
	} as unknown as RoomServerConnectionContext; 

	const observer = new EventEmitter();
	const transport = new TransportMock(
		undefined,
		undefined,
		observer
	) as unknown as PipeTransport;
	const router = new RouterMock(undefined, transport) as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});
	const spyCreateTransport = jest.spyOn(router, 'createPipeTransport').mockImplementation(async () => {
		return transport;
	});

	await sut(context, next);

	expect(context.response.id).toBe(transport.id);
	expect(context.response.ip).toBe(transport.tuple.localIp);
	expect(context.response.port).toBe(transport.tuple.localPort);
	expect(context.handled).toBeTruthy();

	if (isInternal) {
		expect(spyCreateTransport.mock.calls[0][0].listenIp).toEqual({
			announcedIp: undefined,
			ip: transport.tuple.localIp
		});
	}
	if (!isInternal) {
		expect(spyCreateTransport.mock.calls[0][0].listenIp).toEqual({
			announcedIp: mediaService.announcedIp,
			ip: mediaService.ip
		});
	}
	
	const spyNotify = jest.spyOn(conn, 'notify');

	observer.emit('close');
	expect(spyNotify.mock.calls[0][0].method).toBe('pipeTransportClosed');
});

test('createWebrtcTransport', async () => {
	const roomServer = new RoomServerMock() as unknown as RoomServer;
	const mediaService = new MediaServiceMock() as unknown as MediaService;
	const options = {
		roomServer: roomServer,
		mediaService: mediaService
	} as unknown as MiddlewareOptions;

	const sut = createTransportMiddleware(options);
	const conn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const context = {
		roomServerConnection: conn,
		message: {
			method: 'createWebRtcTransport',
			data: {
				routerId: 'id',
				pipeTransportId: 'id'
			}
		},
		response: {}
	} as unknown as RoomServerConnectionContext; 

	const observer = new EventEmitter();
	const transport = new TransportMock(
		undefined,
		undefined,
		observer
	) as unknown as WebRtcTransport;
	const router = new RouterMock(undefined, transport) as unknown as Router;

	jest.spyOn(roomServer.routers, 'get').mockImplementation(() => {
		return router;
	});
	const spyCreateTransport = jest.spyOn(router, 'createWebRtcTransport').mockImplementation(async () => {
		return transport;
	});
	const spyMaxOutgoing = jest.spyOn(transport, 'setMaxOutgoingBitrate');
	const spyMaxIncoming = jest.spyOn(transport, 'setMaxIncomingBitrate');

	await sut(context, next);

	expect(spyCreateTransport).toHaveBeenCalled();
	expect(spyMaxOutgoing).toHaveBeenCalledWith(mediaService.maxOutgoingBitrate);
	expect(spyMaxIncoming).toHaveBeenCalledWith(mediaService.maxIncomingBitrate);
	expect(context.response.id).toBe(transport.id);
	expect(context.response.iceParameters).toBe(transport.iceParameters);
	expect(context.response.iceCandidates).toBe(transport.iceCandidates);
	expect(context.response.dtlsParameters).toBe(transport.dtlsParameters);
	expect(context.response.sctpParameters).toBe(transport.sctpParameters);
	expect(context.handled).toBeTruthy();
	
	const spyNotify = jest.spyOn(conn, 'notify');

	observer.emit('close');
	expect(spyNotify.mock.calls[0][0].method).toBe('webRtcTransportClosed');
});
