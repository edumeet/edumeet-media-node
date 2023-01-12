import { Router } from 'mediasoup/node/lib/Router';
import MediaService from '../src/MediaService';
import RoomServer, { RoomServerOptions } from '../src/RoomServer';
import { RoomServerConnection } from '../src/RoomServerConnection';
import MediaServiceMock from './__mocks__/MediaServiceMock';
import RoomServerConnectionMock from './__mocks__/RoomServerConnectionMock';
import RouterMock from './__mocks__/RouterMock';

test('Constructor - should call notify on roomServerConnection', () => {
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const mockConn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const spyNotify = jest.spyOn(mockConn, 'notify');
	const options: RoomServerOptions = {
		mediaService: mockMediaService,
		roomServerConnection: mockConn
	};

	const sut = new RoomServer(options);

	expect(spyNotify).toHaveBeenCalled();
	expect(sut.closed).toBe(false);
});

test('close() - should close routers, connection and emit close', () => {
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const mockConn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const options: RoomServerOptions = {
		mediaService: mockMediaService,
		roomServerConnection: mockConn
	};

	const sut = new RoomServer(options);
	const spyEmit = jest.spyOn(sut, 'emit');
	const router1 = new RouterMock() as unknown as Router;
	const spyRouterClose = jest.spyOn(router1, 'close');
	const spyRoutersClear = jest.spyOn(sut.routers, 'clear');
	const spyConnClose = jest.spyOn(mockConn, 'close');

	sut.routers.set('r1', router1);

	sut.close();

	expect(spyRouterClose).toHaveBeenCalled();
	expect(spyRoutersClear).toHaveBeenCalled();
	expect(spyConnClose).toHaveBeenCalled();
	expect(spyEmit).toHaveBeenCalledWith('close');
});

test('should close when RoomServerConnection closes', () => {
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const mockConn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const options: RoomServerOptions = {
		mediaService: mockMediaService,
		roomServerConnection: mockConn
	};
	const sut = new RoomServer(options);
	const spyClose = jest.spyOn(sut, 'close');

	mockConn.emit('close');

	expect(spyClose).toHaveBeenCalled();
});