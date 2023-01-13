import EventEmitter from 'events';

type appData = {
    remoteClosed: boolean
}

export default class ConsumerMock extends EventEmitter {
	id = 'id';
	kind = 'video';
	rtpParameters = 'rtp';
	producerPaused = false;
	observer: EventEmitter;
	appData: appData = { remoteClosed: false };
	paused = false;

	constructor(observer: EventEmitter) {
		super();
		this.observer = observer;
	}

	close = jest.fn();
}