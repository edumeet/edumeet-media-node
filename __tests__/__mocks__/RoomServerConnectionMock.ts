import { Pipeline } from 'edumeet-common';
import EventEmitter from 'events';
import { RoomServerConnectionContext } from '../../src/RoomServerConnection';

export default class RoomServerConnectionMock extends EventEmitter {
	pipeline = {
		use: jest.fn()
	} as unknown as Pipeline<RoomServerConnectionContext>;
	notify = jest.fn();
	close = jest.fn();
}