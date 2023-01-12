import EventEmitter from 'events';

export default class BaseConnectionMock extends EventEmitter {
	close = jest.fn();
	notify = jest.fn();
	request = jest.fn();
}