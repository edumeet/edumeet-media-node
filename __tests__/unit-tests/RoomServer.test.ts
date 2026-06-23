import MediaService from '../../src/MediaService';
import RoomServer, { RoomServerOptions } from '../../src/RoomServer';
import { RoomServerConnection } from '../../src/RoomServerConnection';
import { ObserverService } from '../../src/ObserverService';
import MediaServiceMock from '../../__mocks__/MediaServiceMock';
import RoomServerConnectionMock from '../../__mocks__/RoomServerConnectionMock';

jest.mock('../../src/ObserverService');

test('Constructor - should call notify on roomServerConnection', () => {
	const mockMediaService = new MediaServiceMock() as unknown as MediaService;
	const mockConn = new RoomServerConnectionMock() as unknown as RoomServerConnection;
	const mockObserverService = new ObserverService() as unknown as ObserverService;
	const spyNotify = jest.spyOn(mockConn, 'notify');
	const options: RoomServerOptions = {
		mediaService: mockMediaService,
		observerService: mockObserverService,
		roomServerConnection: mockConn
	};

	const sut = new RoomServer(options);

	expect(spyNotify).toHaveBeenCalled();
	expect(sut.closed).toBe(false);
});