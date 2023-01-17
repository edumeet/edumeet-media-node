import EventEmitter from 'events';

export default class ProducerMock extends EventEmitter {
	id = 'id';
	kind = 'video';
	observer;
	appData = { remoteclosed: false };

	constructor(observer?: EventEmitter) {
		super();
		if (observer) {
			this.observer = observer;
		}
	}

	close = jest.fn();
	pause = jest.fn();
	resume = jest.fn();
}