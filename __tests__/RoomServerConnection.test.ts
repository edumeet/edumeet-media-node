import { BaseConnection, Middleware, Pipeline, SocketMessage } from 'edumeet-common';
import { RoomServerConnection, RoomServerConnectionContext, RoomServerConnectionOptions } from '../src/RoomServerConnection';
import TestUtils from './TestUtils';
import BaseConnectionMock from './__mocks__/BaseConnectionMock';

const createExecuteSpyAndMock = (handled: boolean) => {
	const pipelineMock = {
		use: jest.fn(),
		execute: jest.fn()
	} as unknown as Pipeline<RoomServerConnectionContext>;

	const spyExecute = jest.spyOn(pipelineMock, 'execute').mockImplementation(async (context: RoomServerConnectionContext) => {
		context.handled = handled;
	});

	return { pipelineMock, spyExecute };
};

test('Constructor - should not throw', () => {
	const options: RoomServerConnectionOptions = {
		connection: new BaseConnectionMock() as unknown as BaseConnection
	};
	const sut = new RoomServerConnection(options);

	expect(sut.closed).toBe(false);
});

test('Request event - not handled should call reject', async () => {
	const mockConn = new BaseConnectionMock() as unknown as BaseConnection;
	const options: RoomServerConnectionOptions = {
		connection: mockConn
	};
	const sut = new RoomServerConnection(options);

	const request = jest.fn();
	const respond = jest.fn();
	const reject = jest.fn();

	const { pipelineMock, spyExecute } = createExecuteSpyAndMock(false);

	sut.pipeline = pipelineMock;

	await mockConn.emit('request', request, respond, reject);
	TestUtils.sleep(100);
	expect(spyExecute).toHaveBeenCalled();
	expect(respond).not.toHaveBeenCalledWith();
	expect(reject).toHaveBeenCalled();
});

test('Request event - handled should call respond', async () => {
	const mockConn = new BaseConnectionMock() as unknown as BaseConnection;
	const options: RoomServerConnectionOptions = {
		connection: mockConn
	};
	const sut = new RoomServerConnection(options);

	const request = jest.fn();
	const respond = jest.fn();
	const reject = jest.fn();

	const { pipelineMock, spyExecute } = createExecuteSpyAndMock(true);

	sut.pipeline = pipelineMock;

	await mockConn.emit('request', request, respond, reject);
	expect(spyExecute).toHaveBeenCalled();
	expect(respond).toHaveBeenCalled();
	expect(reject).not.toHaveBeenCalled();
});

test('Notification event - handled', async () => {
	const mockConn = new BaseConnectionMock() as unknown as BaseConnection;
	const options: RoomServerConnectionOptions = {
		connection: mockConn
	};

	const sut = new RoomServerConnection(options);

	const { pipelineMock, spyExecute } = createExecuteSpyAndMock(true);

	sut.pipeline = pipelineMock;

	await mockConn.emit('notification', jest.fn());
	expect(spyExecute).toHaveBeenCalled();
});

test('Notification event - not handled', async () => {
	const mockConn = new BaseConnectionMock() as unknown as BaseConnection;
	const options: RoomServerConnectionOptions = {
		connection: mockConn
	};

	const sut = new RoomServerConnection(options);

	const { pipelineMock, spyExecute } = createExecuteSpyAndMock(false);

	sut.pipeline = pipelineMock;

	await mockConn.emit('notification', jest.fn());
	expect(spyExecute).toHaveBeenCalled();
});

test('close()', async () => {
	const mockConn = new BaseConnectionMock() as unknown as BaseConnection;
	const options: RoomServerConnectionOptions = {
		connection: mockConn
	};
	const closeConnSpy = jest.spyOn(mockConn, 'close');

	const sut = new RoomServerConnection(options);
	const emitSpy = jest.spyOn(sut, 'emit');

	sut.close();
	expect(closeConnSpy).toHaveBeenCalled();
	expect(emitSpy).toHaveBeenCalledWith('close');
	expect(sut.closed).toBe(true);

});

test('notify() - should call notify on connection', async () => {
	const mockConn = new BaseConnectionMock() as unknown as BaseConnection;
	const options: RoomServerConnectionOptions = {
		connection: mockConn
	};
	const notifySpy = jest.spyOn(mockConn, 'notify');
	const fakeMessage = 'msg' as unknown as SocketMessage; 

	const sut = new RoomServerConnection(options);

	sut.notify(fakeMessage);

	expect(notifySpy).toHaveBeenCalledWith(fakeMessage);
});

test('request() - should ', async () => {
	const mockConn = new BaseConnectionMock() as unknown as BaseConnection;
	const options: RoomServerConnectionOptions = {
		connection: mockConn
	};
	const requestSpy = jest.spyOn(mockConn, 'request');
	const fakeMessage = 'msg' as unknown as SocketMessage; 

	const sut = new RoomServerConnection(options);

	sut.request(fakeMessage);

	expect(requestSpy).toHaveBeenCalledWith(fakeMessage);
});